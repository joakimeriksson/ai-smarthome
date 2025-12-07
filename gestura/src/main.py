#!/usr/bin/env python3
"""
Gestura - Hand-controlled MIDI interface.

Uses MediaPipe hand tracking to extract gesture features and map them to MIDI CC.
"""

import sys
import cv2
import numpy as np
import time
import argparse

from hand_tracker import HandTracker
from gesture_features import GestureExtractor, GestureFeatures
from smoothing import GestureSmoothing
from midi_output import MidiOutput, load_config, print_config_help


class GesturaApp:
    """Main application class."""

    def __init__(self, camera_id: int = 0, mirror: bool = True,
                 enable_midi: bool = True, midi_port: int = None, debug: bool = False):
        self.camera_id = camera_id
        self.mirror = mirror
        self.enable_midi = enable_midi
        self.midi_port = midi_port  # None = virtual port, int = hardware port
        self.debug = debug

        # Initialize components
        self.tracker = HandTracker(max_hands=2)
        self.extractor = GestureExtractor()
        # Separate smoothers for each hand
        self.smoothers = {
            "Left": GestureSmoothing(filter_type="one_euro", min_cutoff=1.0, beta=0.01),
            "Right": GestureSmoothing(filter_type="one_euro", min_cutoff=1.0, beta=0.01),
        }

        # Load MIDI config and create output
        self.midi_config = load_config() if enable_midi else None
        self.midi = None
        if enable_midi and self.midi_config:
            self.midi = MidiOutput(self.midi_config)

        # State
        self.cap = None
        self.running = False
        self.show_debug = True
        self.current_features: dict[str, GestureFeatures] = {}  # Per hand
        self.fps = 0

    def start(self):
        """Start the application."""
        # Open camera
        self.cap = cv2.VideoCapture(self.camera_id)
        if not self.cap.isOpened():
            print(f"Error: Could not open camera {self.camera_id}")
            return False

        # Set camera properties
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.cap.set(cv2.CAP_PROP_FPS, 30)

        # Open MIDI
        if self.midi:
            if self.midi_port is not None:
                ports = self.midi.list_ports()
                if self.midi_port < len(ports):
                    self.midi.open_port(self.midi_port)
                else:
                    print(f"Error: Port {self.midi_port} not found. Available: {len(ports)}")
                    return False
            else:
                self.midi.open_virtual_port()
            print(f"\nMIDI Mode: {self.midi_config.mode.upper()}")
            if self.midi_config.mode == "standard":
                print(f"\n  Left hand  -> Channel {self.midi_config.left_hand_channel + 1}")
                left_map = self.midi.get_mappings_for_hand("Left")
                for feature, cc in left_map.items():
                    print(f"    {feature:20s} -> CC {cc}")

                print(f"\n  Right hand -> Channel {self.midi_config.right_hand_channel + 1}")
                right_map = self.midi.get_mappings_for_hand("Right")
                for feature, cc in right_map.items():
                    print(f"    {feature:20s} -> CC {cc}")

                # Check for CC conflicts on same channel
                if self.midi_config.left_hand_channel == self.midi_config.right_hand_channel:
                    left_ccs = set(left_map.values())
                    right_ccs = set(right_map.values())
                    conflicts = left_ccs & right_ccs
                    if conflicts:
                        print(f"\n  ⚠️  WARNING: CC conflicts on Channel {self.midi_config.left_hand_channel + 1}!")
                        print(f"      Both hands use: CC {', '.join(map(str, sorted(conflicts)))}")
                        print(f"      Hands will override each other. Edit config/mappings.toml to fix.")
            else:
                print(f"  MPE Zone: {self.midi_config.mpe_zone}")
                print(f"  Pitch Bend Range: ±{self.midi_config.mpe_pitch_bend_range} semitones")
                print(f"  Pitch Bend: {self.midi_config.mpe_pitch_bend}")
                print(f"  Slide (CC74): {self.midi_config.mpe_slide}")
                print(f"  Pressure: {self.midi_config.mpe_pressure}")
            print("\nEdit config/mappings.toml to customize")

        self.running = True
        return True

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Process a single frame."""
        if self.mirror:
            frame = cv2.flip(frame, 1)

        # Detect hands
        hands = self.tracker.process(frame)
        self.current_features = {}

        if hands:
            for hand in hands:
                # Draw landmarks
                self.tracker.draw_landmarks(frame, hand)

                # Extract features
                features = self.extractor.extract(hand)
                handedness = hand.handedness
                self.current_features[handedness] = features

                # Get raw MIDI values
                raw_midi = features.to_midi()

                # Convert to float dict for smoothing
                raw_float = {k: v / 127.0 for k, v in raw_midi.items()}

                # Smooth values using hand-specific smoother
                smoother = self.smoothers.get(handedness, self.smoothers["Right"])
                smoothed = smoother.smooth(raw_float, time.time())

                # Convert back to MIDI range
                smoothed_midi = {k: int(v * 127) for k, v in smoothed.items()}

                # Send MIDI
                if self.midi:
                    self.midi.send_features(handedness, smoothed_midi, debug=self.debug)

                # Draw debug info
                if self.show_debug:
                    # Position based on handedness (left panel for Left hand, right for Right)
                    x_offset = 10 if handedness == "Right" else frame.shape[1] - 310
                    frame = self._draw_debug(frame, handedness, features, smoothed_midi, x_offset)
        else:
            # Draw "No hand detected" message
            cv2.putText(frame, "No hands detected - show your hand!", (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

        # Draw FPS prominently
        cv2.putText(frame, f"FPS: {self.fps}", (frame.shape[1] // 2 - 50, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        return frame

    def _draw_debug(self, frame: np.ndarray, handedness: str, features: GestureFeatures,
                    midi_values: dict[str, int], x_offset: int = 10) -> np.ndarray:
        """Draw debug information overlay."""
        h, w = frame.shape[:2]

        # Semi-transparent background for readability
        overlay = frame.copy()
        cv2.rectangle(overlay, (x_offset, 50), (x_offset + 300, 320), (0, 0, 0), -1)
        frame = cv2.addWeighted(overlay, 0.5, frame, 0.5, 0)

        # Title with hand indicator
        color = (255, 200, 100) if handedness == "Left" else (100, 200, 255)
        cv2.putText(frame, f"{handedness} Hand", (x_offset + 10, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        # Feature bars
        bar_width = 150
        bar_height = 18
        y_start = 100
        y_step = 28

        feature_names = [
            ("palm_x", "X Pos"),
            ("palm_y", "Y Pos"),
            ("palm_z", "Depth"),
            ("hand_openness", "Open"),
            ("pinch_amount", "Pinch"),
            ("finger_spread", "Spread"),
            ("wrist_rotation", "Rotate"),
        ]

        for i, (key, label) in enumerate(feature_names):
            y = y_start + i * y_step
            value = midi_values.get(key, 0)

            # Label
            cv2.putText(frame, f"{label}:", (x_offset + 10, y + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

            # Bar background
            bar_x = x_offset + 70
            cv2.rectangle(frame, (bar_x, y), (bar_x + bar_width, y + bar_height),
                          (50, 50, 50), -1)

            # Bar fill
            fill_width = int((value / 127) * bar_width)
            bar_color = self._value_to_color(value / 127)
            cv2.rectangle(frame, (bar_x, y), (bar_x + fill_width, y + bar_height),
                          bar_color, -1)

            # Value text
            cv2.putText(frame, str(value), (bar_x + bar_width + 5, y + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        return frame

    def _value_to_color(self, value: float) -> tuple[int, int, int]:
        """Convert 0-1 value to BGR color (blue to red gradient)."""
        # HSV: blue (120) to red (0)
        hue = int((1 - value) * 120)
        color = np.array([[[hue, 255, 255]]], dtype=np.uint8)
        bgr = cv2.cvtColor(color, cv2.COLOR_HSV2BGR)
        return tuple(int(c) for c in bgr[0, 0])

    def run(self):
        """Main loop."""
        if not self.start():
            return

        print("Gestura started. Press 'q' to quit.")

        fps_time = time.time()
        fps_count = 0

        try:
            while self.running:
                ret, frame = self.cap.read()
                if not ret:
                    print("Error: Failed to read frame")
                    break

                # Calculate FPS
                fps_count += 1
                if time.time() - fps_time >= 1.0:
                    self.fps = fps_count
                    fps_count = 0
                    fps_time = time.time()

                # Process frame (includes FPS display)
                frame = self.process_frame(frame)

                # Draw instructions at bottom
                h = frame.shape[0]
                cv2.putText(frame, "Press 'q' to quit, 'd' toggle debug",
                            (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

                # Show frame
                cv2.imshow("Gestura", frame)

                # Handle keys
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('d'):
                    self.show_debug = not self.show_debug

        finally:
            self.stop()

    def stop(self):
        """Stop the application."""
        self.running = False

        if self.cap:
            self.cap.release()
        cv2.destroyAllWindows()

        if self.tracker:
            self.tracker.close()

        if self.midi:
            self.midi.close()

        print("Gestura stopped.")


def main():
    parser = argparse.ArgumentParser(description="Gestura - Hand-controlled MIDI")
    parser.add_argument("--camera", type=int, default=0,
                        help="Camera ID (default: 0)")
    parser.add_argument("--no-mirror", action="store_true",
                        help="Disable mirror mode")
    parser.add_argument("--no-midi", action="store_true",
                        help="Disable MIDI output")
    parser.add_argument("--demo", action="store_true",
                        help="Demo mode (same as default)")
    parser.add_argument("--list-midi", action="store_true",
                        help="List available MIDI ports and exit")
    parser.add_argument("--midi-help", action="store_true",
                        help="Show MIDI configuration help and exit")
    parser.add_argument("--port", type=int, default=None,
                        help="MIDI output port number (use --list-midi to see available)")
    parser.add_argument("--debug", action="store_true",
                        help="Print MIDI messages being sent")

    args = parser.parse_args()

    if args.midi_help:
        print_config_help()
        return

    if args.list_midi:
        midi = MidiOutput()
        ports = midi.list_ports()
        print("Available MIDI output ports:")
        for i, port in enumerate(ports):
            print(f"  {i}: {port}")
        return

    app = GesturaApp(
        camera_id=args.camera,
        mirror=not args.no_mirror,
        enable_midi=not args.no_midi,
        midi_port=args.port,
        debug=args.debug
    )
    app.run()


if __name__ == "__main__":
    main()

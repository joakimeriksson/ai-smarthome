"""MediaPipe Hand Tracking wrapper."""

import cv2
import mediapipe as mp
from dataclasses import dataclass
import numpy as np


@dataclass
class HandLandmarks:
    """Container for hand landmark data."""
    landmarks: list  # 21 landmarks with x, y, z
    handedness: str  # "Left" or "Right"
    raw_landmarks: object = None  # Original MediaPipe landmark object for drawing

    def get_landmark(self, idx: int) -> tuple[float, float, float]:
        """Get a specific landmark by index."""
        lm = self.landmarks[idx]
        return (lm.x, lm.y, lm.z)

    def get_landmark_px(self, idx: int, frame_shape: tuple) -> tuple[int, int]:
        """Get landmark position in pixel coordinates."""
        lm = self.landmarks[idx]
        h, w = frame_shape[:2]
        return (int(lm.x * w), int(lm.y * h))


class HandTracker:
    """MediaPipe Hand Tracking wrapper."""

    # Landmark indices
    WRIST = 0
    THUMB_CMC = 1
    THUMB_MCP = 2
    THUMB_IP = 3
    THUMB_TIP = 4
    INDEX_MCP = 5
    INDEX_PIP = 6
    INDEX_DIP = 7
    INDEX_TIP = 8
    MIDDLE_MCP = 9
    MIDDLE_PIP = 10
    MIDDLE_DIP = 11
    MIDDLE_TIP = 12
    RING_MCP = 13
    RING_PIP = 14
    RING_DIP = 15
    RING_TIP = 16
    PINKY_MCP = 17
    PINKY_PIP = 18
    PINKY_DIP = 19
    PINKY_TIP = 20

    # Fingertip indices
    FINGERTIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]

    # Palm landmarks (for calculating palm center)
    PALM_LANDMARKS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]

    def __init__(self, max_hands: int = 1, min_detection_confidence: float = 0.7,
                 min_tracking_confidence: float = 0.5):
        self.mp_hands = mp.solutions.hands
        self.mp_draw = mp.solutions.drawing_utils
        self.mp_styles = mp.solutions.drawing_styles

        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=max_hands,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence
        )

    def process(self, frame: np.ndarray) -> list[HandLandmarks]:
        """Process a frame and return detected hands."""
        # Convert BGR to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_frame)

        hands = []
        if results.multi_hand_landmarks:
            for hand_landmarks, handedness in zip(
                results.multi_hand_landmarks,
                results.multi_handedness
            ):
                hands.append(HandLandmarks(
                    landmarks=hand_landmarks.landmark,
                    handedness=handedness.classification[0].label,
                    raw_landmarks=hand_landmarks
                ))

        return hands

    def draw_landmarks(self, frame: np.ndarray, hand: HandLandmarks) -> np.ndarray:
        """Draw hand landmarks on frame."""
        self.mp_draw.draw_landmarks(
            frame,
            hand.raw_landmarks,
            self.mp_hands.HAND_CONNECTIONS,
            self.mp_styles.get_default_hand_landmarks_style(),
            self.mp_styles.get_default_hand_connections_style()
        )
        return frame

    def close(self):
        """Release resources."""
        self.hands.close()

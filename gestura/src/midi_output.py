"""MIDI output handling with configurable CC mappings and MPE support."""

import rtmidi
from dataclasses import dataclass, field
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib


@dataclass
class CCMapping:
    """MIDI CC mapping configuration."""
    feature: str      # Gesture feature name
    cc_number: int    # MIDI CC number (0-127)
    channel: int = 0  # MIDI channel (0-15)


@dataclass
class MidiConfig:
    """MIDI configuration loaded from TOML."""
    port_name: str = "Gestura"
    mode: str = "standard"  # "standard" or "mpe"

    # Standard mode
    left_hand_channel: int = 0
    right_hand_channel: int = 1

    # MPE mode
    mpe_zone: str = "lower"
    mpe_master_channel: int = 0
    mpe_member_channels: int = 2
    mpe_pitch_bend_range: int = 48

    # Mappings per hand
    left_hand_mappings: dict = field(default_factory=dict)
    right_hand_mappings: dict = field(default_factory=dict)

    # MPE dimension mappings
    mpe_pitch_bend: str = "palm_x"
    mpe_slide: str = "palm_y"
    mpe_pressure: str = "hand_openness"
    mpe_extra_cc: list = field(default_factory=list)


def load_config(config_path: Path = None) -> MidiConfig:
    """Load MIDI configuration from TOML file."""
    if config_path is None:
        # Look for config in standard locations
        candidates = [
            Path("config/mappings.toml"),
            Path("mappings.toml"),
            Path(__file__).parent.parent / "config" / "mappings.toml",
        ]
        for p in candidates:
            if p.exists():
                config_path = p
                break

    config = MidiConfig()

    if config_path and config_path.exists():
        with open(config_path, "rb") as f:
            data = tomllib.load(f)

        midi = data.get("midi", {})
        config.port_name = midi.get("port_name", config.port_name)
        config.mode = midi.get("mode", config.mode)

        # Standard mode settings
        std = midi.get("standard", {})
        config.left_hand_channel = std.get("left_hand_channel", 0)
        config.right_hand_channel = std.get("right_hand_channel", 1)

        # MPE settings
        mpe = midi.get("mpe", {})
        config.mpe_zone = mpe.get("zone", "lower")
        config.mpe_master_channel = mpe.get("master_channel", 0)
        config.mpe_member_channels = mpe.get("member_channels", 2)
        config.mpe_pitch_bend_range = mpe.get("pitch_bend_range", 48)

        # CC mappings
        mappings = data.get("mappings", {})
        config.left_hand_mappings = mappings.get("left_hand", {})
        config.right_hand_mappings = mappings.get("right_hand", {})

        # MPE mappings
        mpe_map = mappings.get("mpe", {})
        config.mpe_pitch_bend = mpe_map.get("pitch_bend", "palm_x")
        config.mpe_slide = mpe_map.get("slide", "palm_y")
        config.mpe_pressure = mpe_map.get("pressure", "hand_openness")
        config.mpe_extra_cc = mpe_map.get("extra_cc", [])

        print(f"Loaded MIDI config from {config_path}")

    return config


# Default CC mappings (used if no config file)
DEFAULT_MAPPINGS = {
    "palm_x": 1,        # Mod wheel
    "palm_y": 11,       # Expression
    "palm_z": 2,        # Breath controller
    "hand_openness": 74,  # Filter cutoff
    "pinch_amount": 71,   # Resonance
    "finger_spread": 91,  # Reverb
    "wrist_rotation": 10, # Pan
}


class MidiOutput:
    """MIDI output handler with MPE support."""

    def __init__(self, config: MidiConfig = None):
        self.config = config or MidiConfig()
        self.midi_out = rtmidi.MidiOut()
        self.port_opened = False

        # Track last sent values to avoid redundant messages
        self._last_values: dict[str, int] = {}

        # MPE state: track which member channel each hand is using
        self._hand_channels: dict[str, int] = {}

    def open_virtual_port(self) -> bool:
        """Open a virtual MIDI port."""
        try:
            self.midi_out.open_virtual_port(self.config.port_name)
            self.port_opened = True
            print(f"Opened virtual MIDI port: {self.config.port_name}")

            if self.config.mode == "mpe":
                self._setup_mpe()

            return True
        except Exception as e:
            print(f"Failed to open virtual MIDI port: {e}")
            return False

    def _setup_mpe(self):
        """Send MPE configuration messages (MCM - MPE Configuration Message)."""
        # RPN 6 (MPE Configuration) on master channel
        master = self.config.mpe_master_channel
        member_count = self.config.mpe_member_channels

        # RPN MSB = 0, LSB = 6 (MPE Configuration)
        self.send_cc(master, 101, 0)   # RPN MSB
        self.send_cc(master, 100, 6)   # RPN LSB
        self.send_cc(master, 6, member_count)  # Data Entry MSB = number of member channels
        self.send_cc(master, 38, 0)    # Data Entry LSB

        # Set pitch bend range on member channels
        if self.config.mpe_zone == "lower":
            channels = range(1, member_count + 1)
        else:
            channels = range(15 - member_count, 15)

        for ch in channels:
            # RPN 0 (Pitch Bend Sensitivity)
            self.send_cc(ch, 101, 0)
            self.send_cc(ch, 100, 0)
            self.send_cc(ch, 6, self.config.mpe_pitch_bend_range)
            self.send_cc(ch, 38, 0)

        print(f"MPE configured: zone={self.config.mpe_zone}, "
              f"members={member_count}, PB range=±{self.config.mpe_pitch_bend_range} semitones")

    def open_port(self, port_index: int) -> bool:
        """Open an existing MIDI port by index."""
        try:
            self.midi_out.open_port(port_index)
            self.port_opened = True
            ports = self.midi_out.get_ports()
            print(f"Opened MIDI port: {ports[port_index]}")
            return True
        except Exception as e:
            print(f"Failed to open MIDI port: {e}")
            return False

    def list_ports(self) -> list[str]:
        """List available MIDI output ports."""
        return self.midi_out.get_ports()

    def get_channel_for_hand(self, handedness: str) -> int:
        """Get the MIDI channel for a specific hand."""
        if self.config.mode == "mpe":
            # In MPE mode, assign member channels to hands
            if handedness not in self._hand_channels:
                if self.config.mpe_zone == "lower":
                    # Lower zone: channels 2, 3, ... (1-indexed = 1, 2, ...)
                    used = len(self._hand_channels)
                    self._hand_channels[handedness] = 1 + (used % self.config.mpe_member_channels)
                else:
                    # Upper zone: channels 15, 14, ...
                    used = len(self._hand_channels)
                    self._hand_channels[handedness] = 14 - (used % self.config.mpe_member_channels)
            return self._hand_channels[handedness]
        else:
            # Standard mode: fixed channels per hand
            if handedness == "Left":
                return self.config.left_hand_channel
            else:
                return self.config.right_hand_channel

    def get_mappings_for_hand(self, handedness: str) -> dict:
        """Get CC mappings for a specific hand."""
        if handedness == "Left":
            return self.config.left_hand_mappings or DEFAULT_MAPPINGS
        else:
            return self.config.right_hand_mappings or DEFAULT_MAPPINGS

    def send_cc(self, channel: int, cc_number: int, value: int, debug: bool = False):
        """Send a MIDI Control Change message."""
        if not self.port_opened:
            return

        channel = max(0, min(15, channel))
        cc_number = max(0, min(127, cc_number))
        value = max(0, min(127, value))

        if debug:
            print(f"MIDI: Ch{channel+1} CC{cc_number}={value}")

        status = 0xB0 | channel
        self.midi_out.send_message([status, cc_number, value])

    def send_pitch_bend(self, channel: int, value: int):
        """
        Send pitch bend message.

        Args:
            channel: MIDI channel (0-15)
            value: -8192 to 8191 (center = 0)
        """
        if not self.port_opened:
            return

        # Convert to 14-bit unsigned (0-16383, center = 8192)
        unsigned = max(0, min(16383, value + 8192))
        lsb = unsigned & 0x7F
        msb = (unsigned >> 7) & 0x7F

        status = 0xE0 | (channel & 0x0F)
        self.midi_out.send_message([status, lsb, msb])

    def send_aftertouch(self, channel: int, value: int):
        """Send channel aftertouch (pressure) message."""
        if not self.port_opened:
            return

        status = 0xD0 | (channel & 0x0F)
        self.midi_out.send_message([status, max(0, min(127, value))])

    def send_features(self, handedness: str, midi_values: dict[str, int], force: bool = False, debug: bool = False):
        """
        Send MIDI messages for all mapped features.

        Args:
            handedness: "Left" or "Right"
            midi_values: Dict of feature name -> MIDI value (0-127)
            force: Send even if value hasn't changed
            debug: Print MIDI messages
        """
        channel = self.get_channel_for_hand(handedness)

        if self.config.mode == "mpe":
            self._send_mpe_features(channel, handedness, midi_values, force, debug)
        else:
            self._send_standard_features(channel, handedness, midi_values, force, debug)

    def _send_standard_features(self, channel: int, handedness: str,
                                 midi_values: dict[str, int], force: bool, debug: bool = False):
        """Send features in standard CC mode."""
        mappings = self.get_mappings_for_hand(handedness)

        for feature, cc_number in mappings.items():
            if feature in midi_values:
                value = midi_values[feature]
                key = f"{handedness}:{channel}:{cc_number}"

                if force or self._last_values.get(key) != value:
                    self.send_cc(channel, cc_number, value, debug=debug)
                    self._last_values[key] = value

    def _send_mpe_features(self, channel: int, handedness: str,
                           midi_values: dict[str, int], force: bool, debug: bool = False):
        """Send features in MPE mode."""
        # Pitch bend (14-bit)
        if self.config.mpe_pitch_bend in midi_values:
            value = midi_values[self.config.mpe_pitch_bend]
            # Map 0-127 to -8192 to 8191
            pb_value = int((value / 127.0) * 16383) - 8192
            key = f"{handedness}:pb"
            if force or self._last_values.get(key) != pb_value:
                self.send_pitch_bend(channel, pb_value)
                self._last_values[key] = pb_value

        # Slide (CC74)
        if self.config.mpe_slide in midi_values:
            value = midi_values[self.config.mpe_slide]
            key = f"{handedness}:slide"
            if force or self._last_values.get(key) != value:
                self.send_cc(channel, 74, value)
                self._last_values[key] = value

        # Pressure (channel aftertouch)
        if self.config.mpe_pressure in midi_values:
            value = midi_values[self.config.mpe_pressure]
            key = f"{handedness}:pressure"
            if force or self._last_values.get(key) != value:
                self.send_aftertouch(channel, value)
                self._last_values[key] = value

        # Extra CCs
        for extra in self.config.mpe_extra_cc:
            feature = extra.get("feature")
            cc = extra.get("cc")
            if feature and cc and feature in midi_values:
                value = midi_values[feature]
                key = f"{handedness}:cc:{cc}"
                if force or self._last_values.get(key) != value:
                    self.send_cc(channel, cc, value)
                    self._last_values[key] = value

    def send_note_on(self, channel: int, note: int, velocity: int = 100):
        """Send a Note On message."""
        if not self.port_opened:
            return
        status = 0x90 | (channel & 0x0F)
        self.midi_out.send_message([status, note & 0x7F, velocity & 0x7F])

    def send_note_off(self, channel: int, note: int):
        """Send a Note Off message."""
        if not self.port_opened:
            return
        status = 0x80 | (channel & 0x0F)
        self.midi_out.send_message([status, note & 0x7F, 0])

    def close(self):
        """Close the MIDI port."""
        if self.port_opened:
            self.midi_out.close_port()
            self.port_opened = False

    def __enter__(self):
        self.open_virtual_port()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def print_config_help():
    """Print help about configuration options."""
    print("""
Gestura MIDI Configuration
==========================

Edit config/mappings.toml to customize:

MODES:
  - standard: Each hand sends CCs on its own channel
  - mpe: MIDI Polyphonic Expression mode for expressive synths

STANDARD MODE:
  - left_hand_channel: MIDI channel for left hand (0-15)
  - right_hand_channel: MIDI channel for right hand (0-15)

MPE MODE:
  - zone: "lower" (ch 2-8) or "upper" (ch 9-15)
  - member_channels: How many channels per zone
  - pitch_bend_range: Semitones (typically 48 for MPE)

  MPE Dimensions:
  - Pitch Bend: palm_x (horizontal position)
  - Slide (CC74): palm_y (vertical position)
  - Pressure: hand_openness (aftertouch)

CC MAPPINGS:
  Common CCs:
    1  = Mod Wheel       74 = Filter Cutoff (Brightness)
    2  = Breath          71 = Resonance (Timbre)
    7  = Volume          91 = Reverb Send
    10 = Pan             93 = Chorus Send
    11 = Expression      64 = Sustain Pedal
""")

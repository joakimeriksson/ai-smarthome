# Gestura

Hand-controlled MIDI interface using MediaPipe hand tracking.

## Quick Start

```bash
# Install dependencies
pixi install

# Run with virtual MIDI port
pixi run start

# Connect directly to hardware (e.g., Roland Fantom)
pixi run start --port 0
```

## Features

- Real-time hand tracking (1-2 hands)
- 7 gesture features mapped to MIDI CC
- Configurable CC mappings per hand
- MPE (MIDI Polyphonic Expression) support
- One Euro filter smoothing for jitter-free control

## Gesture Mappings

| Gesture | Description |
|---------|-------------|
| palm_x | Horizontal hand position |
| palm_y | Vertical hand position |
| palm_z | Distance from camera |
| hand_openness | Fist (0) to open hand (1) |
| pinch_amount | Thumb to index distance |
| finger_spread | Spread between fingers |
| wrist_rotation | Hand rotation angle |

## Configuration

Edit `config/mappings.toml`:

```toml
[midi]
mode = "standard"  # or "mpe"

[midi.standard]
left_hand_channel = 0   # Channel 1
right_hand_channel = 0  # Same channel

[mappings.left_hand]
palm_x = 74         # Filter cutoff
hand_openness = 1   # Mod wheel

[mappings.right_hand]
palm_x = 10         # Pan
hand_openness = 91  # Reverb
```

## Commands

```bash
pixi run start              # Run app
pixi run start --port 0     # Use hardware MIDI port
pixi run start --debug      # Print MIDI messages
pixi run python list_midi.py  # List MIDI ports
```

## Requirements

- Python 3.10-3.12
- Webcam
- macOS (tested on Apple Silicon)

# Quick MIDI test

```bash
# List ports
uvx --from python-rtmidi python3 tools/compare/send_midi.py --list

# Send note (args: note duration port)
uvx --from python-rtmidi python3 tools/compare/send_midi.py 60 1.0 0
```

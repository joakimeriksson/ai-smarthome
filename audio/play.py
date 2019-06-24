#!/usr/bin/env python3
import sys
import sounddevice as sd
import soundfile as sf

print("Loading", sys.argv[1])
data, fs = sf.read(sys.argv[1], dtype='float32')

sd.play(data, fs, blocking=True)
status = sd.get_status()
if status:
    logging.warning(str(status))

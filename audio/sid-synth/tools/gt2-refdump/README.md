# gt2-refdump

Headless SID-register reference dumper built from the original GoatTracker2
source. It loads a GT2 `.sng` file, runs GT2's authoritative `playroutine()`
(compiled unmodified from `gt2-src/gplay.c`) once per 50Hz frame, and prints
the 25 SID register values per frame as JSON lines. Use it as ground truth
when verifying the web tracker's worklet playback.

## Build

```sh
cd tools/gt2-refdump
make
```

No SDL or other dependencies needed: `shim/` contains harmless replacements
for `bme.h` / `SDL_types.h` so the original `gplay.c`, `gsong.c` (the .sng
loader) and `bme/bme_end.c` compile untouched; `main.c` stubs the editor,
sound and display globals they reference.

## Run

```sh
tools/gt2-refdump/gt2dump sids/default-song.sng [--frames N] [--subtune N]
```

- `--frames N`: number of frames to dump (default 1500 = 30s PAL)
- `--subtune N`: subtune / song order set to play (default 0)

Output (stdout, diagnostics on stderr):

```
{"source":"ref","song":"default-song.sng","subtune":0}
{"f":0,"regs":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15]}
{"f":1,"regs":[...25 decimal values of sidreg $00-$18...]}
```

## Notes

- Defaults match GT2's `goattrk2.c`: hard-restart `adparam=0x0F00`,
  `multiplier=1` (1x/50Hz), `finevibrato=1`, `optimizepulse=1`,
  `optimizerealtime=1`, PAL.
- Playback starts via `initsong(subtune, PLAY_BEGINNING)`; the first
  `playroutine()` call only performs GT2's internal song init (no register
  writes) and is not counted — frame 0 is the first real playback frame.
- If the song stops (e.g. GT2's stopsong() safety checks), dumping ends
  early with a message on stderr.

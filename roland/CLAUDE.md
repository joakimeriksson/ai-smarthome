# ZenCore — a Roland ZEN-Core `.svz` editor

Read this before touching anything. It records what is **verified** about the
file format versus what is **guessed**, and the rules that keep the difference
from blurring.

## Goal

A tool that can **load, save, create and modify** Roland ZEN-Core `.svz` files —
the format Zenology and ZEN-Core hardware (Fantom, Jupiter-X/Xm, MC-707/101,
Juno-X, Verselab) use to exchange tones.

Plan of record:

1. **Core library** (`zencore/`) — done, tested, byte-exact. Do not regress it.
2. **Local web UI** — next. Python serves a small HTTP API over the core; the
   browser renders the editor. Not started.
3. MIDI/SysEx to talk to hardware directly — **out of scope for now.** Do not
   add a MIDI dependency without asking.

**`MDL` (model expansion) is out of scope for editing and generation** (decided
2026-07-29). We target PCM/ZEN-Core tones — the `PAT` chunk. Do not spend effort
decoding `MDLSYN0`, and do not emit an MDL chunk in files we create.

This is *not* permission to drop it. A file that arrives with an MDL chunk must
still round-trip byte for byte, because "preserve what you don't understand" is
what makes the whole model trustworthy. Skip means: do not decode, do not
generate. It never means: discard on read.

## The one rule

> **Any `.svz` this project reads must be reproducible byte for byte.**

Every code path is built around that. `parse()` → `build()` is the identity
function on real files, and JSON export → import is too. This is not a nicety —
it is the only evidence we have that the format is understood, because we cannot
ask Roland and we cannot easily ask the hardware. When a round-trip breaks, the
model of the format is wrong. Fix the model, never loosen the test.

Corollary: **preserve what you don't understand.** Unknown chunks, padding
bytes, and the opaque `meta` field in variable chunks are all carried through
verbatim rather than normalised or zeroed.

## Verified facts

Confirmed by inspection of real files across three products
(`KY019$` v2.2 and v5.4, `RC001` v3.3) and five chunk kinds. Full detail in
[`docs/FORMAT.md`](docs/FORMAT.md).

- The container is **plain, uncompressed, unencrypted**. No obfuscation anywhere.
- Chunk header is `{u32 count; u32 recordSize; u32 headerSize; u32 flags}`
  with the invariant `headerSize == 16 + 4*count`, followed by
  `u32 crc32[count]` and then the records.
- The per-record checksum is a **plain `zlib.crc32`** of the record bytes.
- `recordSize == 0` marks the variable-length variant (the sample payload
  chunk), whose table is 16 bytes per entry.
- A tone record starts with a **16-byte ASCII name at offset 0**.
- `zcformat.json` `pos` values are **absolute** offsets into the tone record.
  The groups tile it contiguously and end at exactly 1632 for a PCM tone.
- Multi-byte parameters are **little-endian**. Settled 2026-07-30 against
  `tests/data/ZENOLOGY_User2.svz`, three patches built by hand in Zenology: of
  591 multi-byte reads, **zero** fall outside the schema's min/max, and in 221
  of them the byte-swapped value would be out of range while the little-endian
  one is not. A wrong guess could not survive that. Round-trip alone can never
  show this — it took real values from a real editor.
- `MDL` = **Model expansion** — the modeled synth engines (JUPITER-8, JX-8P,
  JUNO-106, SH-101, JUNO-60, JD-800, Vocal Designer, JUPITER-X), as opposed to
  `PAT` which is the PCM engine. Settled by `JUPITERprmdb/db_bmc0_model.xml`,
  whose `MDLSYN0` block starts with `MODEL` = `---, JP8, JX8P, JUNO106, SH101,
  JUNO60`, and corroborated by a corpus record literally named `OscSync-JP8`.
- `EXTaZCOR` wraps a **zlib-compressed** `SVDx` image (Zenology's user bank:
  128 slots x 23168 bytes). `zlib.compress(raw, 6)` reproduces Roland's stream
  byte for byte, so the round-trip rule survives through the compression layer.
  See `zencore/svd.py` and `docs/FORMAT.md`.
- A user-bank **slot is 16 bytes of header followed by a complete 1632-byte
  `PAT` tone record**, byte-identical to that tone as exported to `.svz`.
  Verified 2026-07-30 by decoding slots 2 and 3 of a populated bank and
  comparing with `tests/data/ZENOLOGY_User2.svz` - both matched exactly. So the
  name at +16 is the tone record's own name at offset 0. Read them with
  `SvdImage.tone_bytes()`. The other 21520 bytes per slot are still unknown.

## Known unknowns

Do not write code that assumes an answer to any of these. If you resolve one,
move it up into "Verified facts" *with the evidence that settled it*.

- **Nothing has ever been loaded into hardware.** Zenology (the plugin) *has*
  now imported files we generated — see below — but that is Roland's software,
  not a synth. Hardware may be stricter. Treat hardware write support as
  unproven until a Fantom / Jupiter-X / MC actually accepts one.

  What was accepted, 2026-07-29: `probes/probe1..4.svz`, each built by editing
  `tests/data/ZENOLOGY_Test1.svz` (a real Zenology export) and rebuilding with
  `build()`. That exercises the directory offsets, the per-record CRC-32 and the
  16-byte name at offset 0 of both `PAT` and `MDL`. It does **not** exercise
  `ToneFile.create()`, which builds a file from scratch and whose init tone is
  known wrong.

  Multi-tone files (`PAT` x4, no `MDL`) imported too, and **produced sound** -
  so the engine is reading our parameter bytes, not just the container. That is
  the strongest evidence the absolute-offset model in `zcformat.json` is right.
- The 4th field of a variable-chunk table entry (`meta`) is a CRC-32 **on the
  `EXT` chunk** — `zlib.crc32(record[32:])`, i.e. skipping the record's 32-byte
  sub-header. The earlier whole-record test on `USD` sample data failed, which
  is consistent with USD records also having a leading sub-header rather than
  with `meta` not being a checksum. Retest USD with a skipped prefix; until
  then keep carrying `meta` through untouched for every kind except `EXT`.
- `MDLaZCOR` (2048-byte records, model-expansion data) has no schema entry, so
  it round-trips as opaque bytes. Its first 16 bytes look like a name.
- The `DIF` chunk's 32-byte record differs between products and is not decoded.
- `ToneFile.create()` synthesises an init tone from the schema's `init` values,
  and we now have evidence it is **wrong**. `tests/data/ZENOLOGY_Test1.svz` is a
  near-init tone exported by Zenology itself, and it disagrees with our
  synthesised record in 67 parameters — `PTL_PENV_n.L1/L2/L3` are 0 where the
  schema says 240, `WAV_GID`/`WAV_NUM_L` point at a real wave rather than 0, and
  `MCTL_n_SRC` defaults to 97-100 rather than 0. The schema's `init` attribute
  is the JUPITER-X editor's idea of a default, not Zenology's INIT TONE.
  Prefer copying the captured tone; do not trust `init_record()`.

## Gotchas that already cost time

- Parameter ids are **only unique within a group** — `LEVEL` and `PAN` repeat
  across partials. A global `{id: param}` lookup silently writes to the wrong
  offset. Always resolve group-first.
- `LFO_n_STEP` is a **16-byte signed array**, not a scalar and not a name.
  Anything discriminating on `size == 16` will corrupt it. Discriminate on the
  parameter id for text, and on `size > 4` for arrays.
- The record size is **1632 for PCM tones and 2048 for MDL**, and other models
  may differ again. Read it from the chunk header; never hardcode it.
- The legacy script `legacy/read-svz.py` reads the tone name at offset **8**,
  which is wrong — it is offset 0. Do not copy offsets from `legacy/`; that
  directory is history, not reference.
- Real factory tones contain values outside the schema's documented `min`/`max`.
  `Tone.out_of_range()` is informational — never reject a file over it.
- **A running Zenology overwrites `User.bin`.** It holds the user bank in memory
  and flushes it to disk periodically, silently reverting anything written
  underneath it — a slot written at 20:27 was gone by 21:25 with Logic still
  open. Quit every host before writing the bank, and re-read the file
  immediately before writing rather than trusting an earlier capture.
- Measurement noise floors, measured 2026-07-30, for anything comparing audio:
  BlackHole capture of the same patch twice differs by **2.57 dB**; an offline
  DawDreamer render of the same patch twice differs by **1.30 dB** (the plugin
  is not deterministic - Analog Feel, pitch drift, free-running LFOs). Any
  "improvement" smaller than those numbers is not a result.

## Layout

```
zencore/            the library — this is the product
  container.py      chunk directory: parse/build, CRCs, nothing semantic
  schema.py         zcformat.json: absolute byte-map, encode/decode
  tone.py           Tone and ToneFile — the API a UI should call
  svd.py            EXT chunk -> zlib -> SVD image (Zenology's user bank)
  va.py             virtual-analog view of a tone; the synth's contract
  jsonio.py         lossless .svz <-> JSON
  cli.py            python3 -m zencore ...
webui/server.py     stdlib HTTP API over the library (imports zencore, never
                    the reverse); webui/static/ is the browser UI
tests/              pytest; tests/data/ holds the real-file corpus
docs/FORMAT.md      the binary format spec
tools/              schema extraction from Roland's editor XML
legacy/             superseded exploratory scripts, kept for history
JUPITERprmdb/       Roland's editor XML — the source zcformat.json came from
zcformat.json       generated parameter schema (do not hand-edit)
```

## Working commands

```bash
python3 -m pytest tests -q            # must stay green, always
python3 -m zencore info    FILE.svz
python3 -m zencore dump    FILE.svz -t 0
python3 -m zencore export  FILE.svz -o out/     # edit out/svz.json
python3 -m zencore build   out/ -o new.svz
python3 -m zencore create  -o new.svz -n 4
python3 -m zencore verify  *.svz
```

Library use:

```python
from zencore import Schema, ToneFile

tf = ToneFile.open("User.svz", Schema.load())
tf.tones[0].name = "My Patch"
tf.tones[0].set("PCMT_CMN", "LEVEL", 100)
tf.save("out.svz")
```

## How to work on this

- **Add to the corpus before adding a feature.** `tests/data/*.svz` is picked up
  automatically; every new file immediately gets round-trip, CRC and header
  coverage. A new model or chunk kind is worth more than new code.
- **Never widen an exception to make a file parse.** If `SvzError` fires, the
  file is telling you the format model is incomplete. Investigate, then either
  extend the model or record a new known-unknown here.
- **Keep `container.py` semantic-free.** It must not know what a tone is. That
  separation is what lets unknown chunk kinds survive an edit untouched.
- **Regenerating the schema:** `zcformat.json` is generated from
  `JUPITERprmdb/*.xml` by `tools/xml_to_schema.py`, which uses paths relative to
  the repo root — run it as `python3 tools/xml_to_schema.py` from there. Do not
  hand-edit `zcformat.json`; fix the extractor and regenerate, or the next
  regeneration silently drops the edit.
- Prefer stdlib. The core has no third-party dependencies and should keep none;
  the web UI may add exactly one small server dependency.

## The web UI and the VA synth

**Started 2026-07-30.** `webui/server.py` is the thin HTTP layer; the browser
side is not written yet. Decided: an AudioWorklet synth that plays the *VA*
path only (no PCM samples), fed patch JSON by this API, and validated by
rendering the same patch in both it and Zenology and comparing spectra — the
same measure-don't-guess approach the rest of the project uses.

`zencore/va.py` is the contract between them: 86 parameters, all present in the
schema, covering oscillator / structure / filter / three envelopes / two LFOs /
unison. A partial with `OSC_TYPE` of VA, SuperSAW or Noise synthesises and needs
no wave data; `patch["playable"]` says whether a VA-only synth can play a tone.

Enum labels now come from `Param.values` (Roland's `desc_val`, added to the
extractor 2026-07-30 — 877 params gained it, 271 are real enums). **Do not
hardcode value lists in the UI or the synth**; they are in the schema.

Original intended shape, still accurate:

- A thin HTTP layer over `ToneFile` — the UI must not re-implement any format
  knowledge, and `zencore/` must not import anything web-related.
- Endpoints roughly: list tones in a loaded file, get one tone as grouped
  parameters (the `Schema.to_dict()` shape is already the right payload), patch
  a parameter, save.
- Render controls from the schema, not from hardcoded lists — `min`, `max`,
  `desc` and group names are all present, so the UI can be generated.
- Round-trip stays the acceptance test: load a file in the UI, save it without
  edits, and the bytes must be unchanged.

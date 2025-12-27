# GoatTracker Exporter (Data-Only)

This exporter generates compact assembly data tables (notes, instruments, orderlists) so you can assemble them with an existing GoatTracker 2 (GT2) playroutine. It avoids embedding a replayer binary in the browser and keeps us focused on exporting just the music parts.

What you get
- `INSTRUMENTS` table: ADSR, waveform flags, and pulse width per instrument.
- `PATTERN_V0..V2` tables: rows of `(note, instrument)` for each voice.
- `ORDER_V0..V2` tables: sequence of pattern indices (simple 1-pattern example by default).
- Helper constants and a tiny mapping for note numbers.

How to use with GT2 replayer
- Assemble your chosen GT2 replayer (e.g., at `$1000`) and adapt the data pointers to the labels provided by this export (`INSTRUMENTS`, `PATTERN_V*`, `ORDER_V*`).
- Map fields to GT2’s expected structures/macros (ADSR, wave, PW). Start simple (no per-row effects/commands), then extend with arps/slides as needed.
- Optionally convert these tables into GT2’s native data layout if you want to use an unmodified GT2 driver.

Notes
- This export is intentionally conservative: no effects yet (arpeggio/vibrato/slides). It’s a good baseline to prove playback and timing. Extend as your mapping matures.
- If you prefer, you can produce a PSID using your assembled replayer + these tables and test in sidplay2/Vice.

License
- GoatTracker 2 is distributed separately. Keep its license with any included replayer code.

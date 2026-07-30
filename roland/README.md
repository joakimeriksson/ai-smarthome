# zencore

Read, write, create and modify Roland ZEN-Core `.svz` files — the format
Zenology and ZEN-Core hardware (Fantom, Jupiter-X/Xm, MC-707/101, Juno-X,
Verselab) use to exchange tones.

Pure Python, no dependencies.

```bash
python3 -m zencore info    User.svz
python3 -m zencore dump    User.svz -t 0
python3 -m zencore export  User.svz -o out/    # then edit out/svz.json
python3 -m zencore build   out/ -o new.svz
python3 -m zencore create  -o blank.svz -n 4
python3 -m zencore verify  *.svz
```

```python
from zencore import Schema, ToneFile

tf = ToneFile.open("User.svz", Schema.load())
tf.tones[0].name = "My Patch"
tf.tones[0].set("PCMT_CMN", "LEVEL", 100)
tf.save("out.svz")
```

Reading a file and writing it back reproduces it byte for byte, including
chunks the library does not understand. That property is enforced by the test
suite and is the basis for trusting anything else here.

**Status: the write path has never been loaded into hardware.** It satisfies
this project's own parser and nothing more. See [CLAUDE.md](CLAUDE.md) for what
is verified versus assumed, and [docs/FORMAT.md](docs/FORMAT.md) for the format
itself.

```bash
python3 -m pytest tests -q
```

## Credits

Format reverse-engineered by Joakim Eriksson. The CRC-32 identification and the
`zcformat.json` extraction from Roland's editor XML came first and everything
else is built on them.

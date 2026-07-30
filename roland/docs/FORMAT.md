# The Roland `.svz` container

Derived by inspection of real files. Every claim below is marked **verified**
(reproduced across multiple files) or **unverified** (consistent with what we
have seen, but not independently confirmed).

All integers are little-endian. Nothing in the file is compressed, encrypted,
or obfuscated — **verified** across every file examined.

## Corpus this is based on

| File | Product | Version | Chunks | Size |
|---|---|---|---|---|
| `EXPORT_Z-Core.svz` | `KY019$` | 2.2 | DIF, PAT×3 | 5 024 B |
| `EXPORT_Z-Core2.svz` | `KY019$` | 2.2 | DIF, PAT×1 | 1 752 B |
| `User.svz` | `RC001\x01` | 3.3 | DIF, PAT×1, MDL×2 | 5 888 B |
| `UpRightPiano1.svz` (Fantom-0) | `KY019$` | 5.4 | DIF, PAT×2, USP×44, MSP×4, USD×44 | 94.7 MB |
| `ZENOLOGY_User.svz` | `RC001\x01` | 1.0 | EXT×1 | 6 184 B |

`ZENOLOGY_User.svz` is a capture of Zenology's live user bank, which the plugin
keeps at `~/Library/Application Support/Roland Cloud/ZENOLOGY/User.bin` and
rewrites as you work. It is an ordinary `.svz` despite the extension.

## File header

```
0x00  char magic[4]      "SVZa"                      verified
0x04  u8   version[2]    2.2 / 3.3 / 5.4 observed    verified
0x06  char product[6]    "KY019$", "RC001\x01"       verified
0x0C  u8   pad[4]        zero in every file          unverified (may not be pad)
0x10  DirEntry[]
```

The `product` field appears to identify the originating device or plugin. Its
exact meaning is **unverified** — treat it as an opaque tag and preserve it.

## Directory

```c
struct DirEntry {          // 16 bytes
    char id[8];            // e.g. "PATaZCOR"
    u32  offset;           // from start of file
    u32  length;
};
```

There is **no entry count**. The directory ends where the first chunk begins —
read entries until the next 8 bytes do not end in `ZCOR`, and cross-check
against `min(offset)`. **Verified.**

Chunks are contiguous and their lengths sum exactly to the file size in every
file examined. **Verified**, but do not rely on it — always use `offset`.

Observed chunk ids (`ZCOR` = ZEN-CORe):

| Id | Contents | Record size |
|---|---|---|
| `DIFaZCOR` | file/device info, not decoded | 32 |
| `PATaZCOR` | ZEN-Core tones | 1632 |
| `MDLaZCOR` | model expansion data | 2048 |
| `USPaZCOR` | user sample parameters | 64 |
| `MSPaZCOR` | multisample parameters | 1040 |
| `USDaZCOR` | raw sample payload | variable |
| `EXTaZCOR` | compressed SVD image (Zenology user bank) | variable |

## Chunk, fixed-size records

Used by DIF, PAT, MDL, USP, MSP.

```c
u32 count;
u32 recordSize;        // non-zero
u32 headerSize;        // == 16 + 4*count          verified
u32 flags;             // 0 in every file observed  unverified
u32 crc32[count];      // zlib.crc32 of each record verified
u8  record[count][recordSize];
```

Two invariants worth asserting on read, because they catch a misparse
immediately:

```
headerSize == 16 + 4*count
headerSize + count*recordSize == chunkLength
```

The checksum is a **plain `zlib.crc32`** over the record's bytes — no seed, no
masking, no Roland-specific variation. **Verified** on every record in the
corpus. It must be recomputed whenever a record changes.

## Chunk, variable-size records

Used by `USDaZCOR`, the raw sample payload.

```c
u32 count;
u32 recordSize;        // == 0, this is the marker  verified
u32 headerSize;        // == 16 + 16*count          verified
u32 flags;
struct { u32 index; u32 offset; u32 length; u32 meta; } entry[count];
u8  payload[];
```

`offset` is measured **from the start of the chunk** and the entries are
contiguous — **verified** (entry *n+1*'s offset equals entry *n*'s offset plus
its length, across all 44 records).

`meta` is **not** a CRC-32 of the whole record; that hypothesis was tested
against real sample data and rejected. But on the Zenology `EXT` record it is
exactly `zlib.crc32(record[32:])` — a CRC of the record *past its 32-byte
sub-header*. **Verified** on that one file.

That suggests the original USD test failed because it hashed the whole record
including a leading sub-header, not because `meta` is not a checksum. Retesting
USD with a skipped prefix is the obvious next experiment; the 94 MB Fantom file
is not in the corpus, so it has not been done. Until then, keep carrying `meta`
through unchanged for chunk kinds other than `EXT`.

## `EXTaZCOR` — the Zenology user bank

A single variable-length record wrapping a deflate-compressed SVD image:

```
[0:8]    char tag[8]      "RC001\x01\x00\x00"        verified (one file)
[8:12]   u32  rawSize     uncompressed byte count    verified
[12:32]  u8   pad[20]     zero                       unverified
[32:]    zlib stream, level 6
```

`zlib.compress(raw, 6)` reproduces Roland's stream **byte for byte** — verified,
and asserted by the test suite. That is what makes a byte-exact edit possible
through the compression layer. The container itself remains uncompressed; only
this payload is deflated.

The decompressed image:

```
0x00  char magic[4]      "SVDx"                      verified
0x04  u32  headerSize    32                          verified
0x08  u32  recordSize    23168                       verified
0x0C  u32  count         128                         verified
0x10  u8   unknown[16]   first u32 is 2              unverified, preserved
0x20  u8   slot[count][recordSize]
```

`headerSize + count*recordSize` equals the image length exactly. **Verified.**

Each 23 168-byte slot is:

```
0x0000  u8   header[16]     not decoded, preserved verbatim
0x0010  u8   tone[1632]     a complete PAT tone record
0x0670  u8   rest[21520]    not decoded, preserved verbatim
```

The tone record at **+16 is byte-identical to the same tone exported to
`.svz`** — **verified** by decoding slots 2 and 3 of a populated bank and
comparing against `ZENOLOGY_User2.svz`, where both matched exactly. That is
also why the slot name appears at +16: it is the tone record's own name field
at offset 0, not a separate slot field.

This makes user-bank tones readable with the ordinary `Schema`, via
`SvdImage.tone_bytes()` / `set_tone_bytes()`.

What the remaining 21 520 bytes hold is unknown. They may well relate to the
tone (model data, per-slot state), so a slot assembled by replacing only the
`PAT` record is **not known to be coherent** — writing one back and having
Zenology accept it has not yet been demonstrated.

`FANTOM.SVD` in the corpus begins `SVD5` rather than `SVDx`, so these are a
family, not one layout. Do not assume the header above generalises.

## Tone record (`PAT`)

```
0x00  char name[16]      ASCII, space padded        verified
0x10  u8   params[...]   to recordSize
```

The name is at offset **0**, not 8. **Verified** across all four files:
`"UPiano1"`, `"OSC-SyncLd 4"`, `"wave seq 1"`, `"OscSync-Thriller"`.

`MDL` records also begin with a 16-byte name — **verified** but not otherwise
decoded.

### Parameter layout

Comes from `zcformat.json`, extracted from Roland's own editor XML
(`JUPITERprmdb/`). Each entry is `{id, desc, pos, size, min, max, init}`, and
`pos` is an **absolute** offset into the record — not relative to its group.
**Verified**: the groups tile the record contiguously from `PCMT_CMN` at 0 to
`PCMS_PTL_4` ending at exactly 1632.

Group order: `PCMT_CMN`, `MFX`, `PCMT_PMT`, `PCMT_PTL_1..4`, `PTL_PENV_1..4`,
`PTL_FENV_1..4`, `PTL_AENV_1..4`, `PTL_LFO_1..4`, `PTL_EQ_1..4`, `PCMS_CMN`,
`PCMS_PMT`, `PCMS_PTL_1..4`.

Encoding rules:

- `id == "NAME"` → 16-byte ASCII, space padded.
- `size > 4` → a byte array, not a scalar. `LFO_n_STEP` is 16 signed bytes.
- `min < 0` → two's complement. **Verified** for `PAN` (stored `0xF6` = −10 in
  `User.svz`); **unverified** as a general rule, though it holds everywhere we
  can check.
- Multi-byte scalars are read little-endian. **Verified** against
  `ZENOLOGY_User2.svz`: across three hand-built patches, all 591 multi-byte
  parameters decode inside their documented range, and 221 of them would fall
  outside it if read big-endian.
- Entries without an `id` are padding. Preserve their bytes.

Parameter ids are unique only **within** a group. **Verified**, and a real
source of silent corruption if ignored.

## What this does not cover

- The meaning of `DIF` and `MDL` record contents.
- The `meta` field in variable chunks.
- `.SVD` files (`FANTOM.SVD` starts `^\x00SVD5`) — a different container.
- Whether hardware accepts a file we generated. **Nothing here has been
  round-tripped through a synth.**

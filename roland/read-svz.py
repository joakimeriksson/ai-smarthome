#
# Read one or two Roland SVZ files - Zen Core
#
# (c) Joakim Eriksson
#


import sys
import binascii

# Offset from start

startOffset = 128
# Should setup the different parts for simpler offset calculations...
# Check that the endian of word / long is correct also.



patch = {
    'name':{'offset':8, 'len':16, 'type':'string'},
    'level':{'offset':28, 'len':1, 'type':'uint'},
    'pan':{'offset':29, 'len':1, 'type':'int'},
    'structure1-2':{'offset':1460, 'len':1, 'type':'uint'},
    'structure3-4':{'offset':1461, 'len':1, 'type':'uint'},
    'ring-level1-2':{'offset':1464, 'len':1, 'type':'uint'},
    'ring-level3-4':{'offset':1465, 'len':1, 'type':'uint'},
    'ringosc1-level':{'offset':1466, 'len':1, 'type':'uint'},
    'ringosc2-level':{'offset':1467, 'len':1, 'type':'uint'},
    'ringosc3-level':{'offset':1468, 'len':1, 'type':'uint'},
    'ringosc4-level':{'offset':1469, 'len':1, 'type':'uint'},
    }

def get_data(name, bytes):
    global patch, startOffset
    if name in patch:
        t = patch[name]['type']
        offset = patch[name]['offset']
        len = patch[name]['len']
        if t == 'string':
            return str(bytes[startOffset + offset : startOffset + offset + len], "UTF-8")
        elif t == 'int' or t == 'uint':
            v = 0
            maxval = 2**(8*len)
            # MIDI might use other schemes for converting - might be similar here... (SysEx)
            for i in range(len):
                b = bytes[startOffset + offset + i]
                v = v * 256 + b
            if t == 'int' and v >= maxval / 2:
                v = v - maxval
            return v
    return "no-found."

def conv(b):
    if b > 30 and b < 127:
        c = chr(b)
    else:
        c = '.'
    return c

print("Loading", sys.argv[1])

with open(sys.argv[1], "rb") as f:
    bytes_read = f.read()

bytes_read2 = None
if len(sys.argv) > 2:
    with open(sys.argv[2], "rb") as f2:
        bytes_read2 = f2.read()


s = ""
s2 = ""
d2 = ""
diff = False
i = 0
for adr, b in enumerate(bytes_read):
    if i == 0:
        print("%04d " % adr, end='')
    s = s + conv(b)
    if bytes_read2:
        b2 = bytes_read2[adr]
        s2 = s2 + conv(b2)
        d2 = d2 + "%02x" % b2
        if b != b2:
            diff = True
    print("%02x" %b, end='')
    i = i + 1
    if (i == 16):
        print("   " + s)
        if diff: print("#    " + d2 + "   " + s2)
        i = 0
        s = ""
        s2 = ""
        d2 = ""
        diff = False


if bytes_read[0:3] == b'SVZ':
    mlen = 0
    plen = 0
    pstart = 116
    psize = 0
    mstart = 0
    print("")
    print("Roland SVZ file")
    if bytes_read[32:40] == b'PATaZCOR':
        pstart = bytes_read[40] + bytes_read[41] * 256
        plen = bytes_read[44] + bytes_read[45] * 256
        print("  Type: Zen Core Patch Data of len: " + str(plen) + " starting at: " + str(pstart))
    if bytes_read[48:56] == b'MDLaZCOR':
        mstart = bytes_read[56] + bytes_read[57] * 256
        mlen = bytes_read[60] + bytes_read[61] * 256
        print("  Type: Zen Core MDL Data of len: " + str(mlen) + " starting at: " + str(mstart))
    num_patches = bytes_read[pstart]
    size_patches = bytes_read[pstart + 4] + bytes_read[pstart + 5] * 256
    print("Number of patches in file:" + str(num_patches) + " size of patch: " + str(size_patches))
    print("Total len:" + str(mlen + plen) + " Total file:" + str(adr + 1)) 
    startOffset = 128 + num_patches * 4 - 4;
    print("First sound:", get_data('name', bytes_read))
    print("Level:" + str(get_data('level', bytes_read)))
    print("Pan:" + str(get_data('pan', bytes_read)))
    print("Osc-mode-1-2:" + str(get_data('structure1-2', bytes_read)))
    print("Osc-mode-3-4:" + str(get_data('structure3-4', bytes_read)))
    print("Ring-level1-2:" + str(get_data('ring-level1-2', bytes_read)))
    print("Ring-level3-4:" + str(get_data('ring-level3-4', bytes_read)))
    # Seems like the checksum is a plain CRC32 - which is great!
    crc32 = binascii.crc32(bytes_read[128+12:1632+(128+12)])
    checksum = bytes_read[128 + 4] + bytes_read[128 + 5] * 256 + bytes_read[128 + 6] * 65536 + bytes_read[128 + 7] * 16777216
    print("CRC32: " + "%08x" % crc32 + " vs " + "%08x" % checksum)


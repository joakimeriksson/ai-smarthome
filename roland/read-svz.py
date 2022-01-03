#
# Read one or two Roland SVZ files - Zen Core
#
# (c) Joakim Eriksson
#


import sys

# Offset from start

startOffset = 128
# Should setup the different parts for simpler offset calculations...
# Check that the endian of word / long is correct also.
patch = {
    'name':{'offset':8, 'len':16, 'type':'string'},
    'level':{'offset':8 + 16 + 5, 'len':1, 'type':'int'},
    'structure1-2':{'offset':1460, 'len':1, 'type':'int'},
    'structure3-4':{'offset':1461, 'len':1, 'type':'int'},
    'ring-level1-2':{'offset':1464, 'len':1, 'type':'int'},
    'ring-level3-4':{'offset':1465, 'len':1, 'type':'int'},
    'ringosc1-level':{'offset':1466, 'len':1, 'type':'int'},
    'ringosc2-level':{'offset':1467, 'len':1, 'type':'int'},
    'ringosc3-level':{'offset':1468, 'len':1, 'type':'int'},
    'ringosc4-level':{'offset':1469, 'len':1, 'type':'int'},
    }

def get_data(name, bytes):
    global patch, startOffset
    if name in patch:
        t = patch[name]['type']
        offset = patch[name]['offset']
        len = patch[name]['len']
        if t == 'string':
            return str(bytes[startOffset + offset : startOffset + offset + len], "UTF-8")
        elif t == 'int':
            v = 0
            # MIDI might use other schemes for converting - might be similar here... (SysEx)
            for i in range(len):
                b = bytes[startOffset + offset + i]
                v = v * 256 + b
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
    print("")
    print("Roland SVZ file")
    print("First sound:", get_data('name', bytes_read))
    print("Level:" + str(get_data('level', bytes_read)))
    print("Osc-mode-1-2:" + str(get_data('structure1-2', bytes_read)))
    print("Osc-mode-3-4:" + str(get_data('structure3-4', bytes_read)))
    print("Ring-level1-2:" + str(get_data('ring-level1-2', bytes_read)))
    print("Ring-level3-4:" + str(get_data('ring-level3-4', bytes_read)))


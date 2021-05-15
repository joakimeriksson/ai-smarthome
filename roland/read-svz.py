#
# Read one or two Roland SVZ files - Zen Core
#
# (c) Joakim Eriksson
#


import sys

# Offset from start

startOffset = 128
patch = {
    'name':{'offset':8, 'len':16, 'type':'string'}
    }

def get_data(name, bytes):
    global patch, startOffset
    if name in patch:
        t = patch[name]['type']
        offset = patch[name]['offset']
        len = patch[name]['len']
        if t == 'string':
            return str(bytes[startOffset + offset : startOffset + offset + len], "UTF-8")
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
        if b != bytes_read2[adr]:
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


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
sub_patches = {
    'keyboard': {
            'key-range-lower': {'offset':0, 'len':1, 'type':'uint'},
            'key-range-upper': {'offset':1, 'len':1, 'type':'uint'},
            'key-fade-lower': {'offset':2, 'len':1, 'type':'uint'},
            'key-fade-upper': {'offset':3, 'len':1, 'type':'uint'},
            'velocity-range-lower': {'offset':4, 'len':1, 'type':'uint'},
            'velocity-range-upper': {'offset':5, 'len':1, 'type':'uint'},
            'velocity-fade-lower': {'offset':6, 'len':1, 'type':'uint'},
            'velocity-fade-upper': {'offset':7, 'len':1, 'type':'uint'}
        },
    'oscillator' : {
        'oscillator-type': {'offset':0, 'len':1, 'type':'uint'},
        'wave-bank': {'offset':1, 'len':1, 'type':'uint'},
        'wave-left': {'offset':2, 'len':2, 'type':'uint'}, # correct
        'wave-right': {'offset':4, 'len':2, 'type':'uint'}, # correct
        'va-waveform': {'offset':1141, 'len':1, 'type':'uint'}, # this is at a completely different location
        'va-invert' : {'offset':7, 'len':1, 'type':'uint'},
        'pcm-sync-wave' : {'offset':8, 'len':1, 'type':'uint'},
        'gain' : {'offset':9, 'len':1, 'type':'uint'},
        'pulse-width' : {'offset':10, 'len':1, 'type':'uint'},
        'pwm-depth' : {'offset':11, 'len':1, 'type':'int'},
        'super-saw-detune' : {'offset':12, 'len':1, 'type':'uint'},
        'click-type' : {'offset':13, 'len':1, 'type':'uint'},
        'fat' : {'offset':14, 'len':1, 'type':'uint'},
        'osc-attenuation' : {'offset':15, 'len':1, 'type':'uint'},
        'fxm-sw' : {'offset':16, 'len':1, 'type':'uint'},
        'fxm-color' : {'offset':17, 'len':1, 'type':'uint'},
        'fxm-depth' : {'offset':18, 'len':1, 'type':'uint'},
        'delay-mode' : {'offset':19, 'len':1, 'type':'uint'},
        'delay-time-sync' : {'offset':20, 'len':1, 'type':'uint'},
        'delay-time-note' : {'offset':21, 'len':1, 'type':'uint'},
        'delay-time' : {'offset':22, 'len':1, 'type':'uint'},
        'wave-tempo-sync' : {'offset':23, 'len':1, 'type':'uint'}
    }
}

patch = {
    'name':{'offset':8, 'len':16, 'type':'string'},
    'category':{'offset':24, 'len':1, 'type':'uint'},
    'level':{'offset':28, 'len':1, 'type':'uint'},
    'pan':{'offset':29, 'len':1, 'type':'int'},
    'coarse-tune':{'offset':33, 'len':1, 'type':'int'},
    'fine-tune':{'offset':34, 'len':1, 'type':'int'},
    'octave-shift':{'offset':35, 'len':1, 'type':'int'},
    'stretch-depth':{'offset':36, 'len':1, 'type':'uint'},
    'analog-feel':{'offset':37, 'len':1, 'type':'uint'},

    # Structure configuration
    'structure1-2':{'offset':1460, 'len':1, 'type':'uint'},
    'structure3-4':{'offset':1461, 'len':1, 'type':'uint'},
    'ring-level1-2':{'offset':1464, 'len':1, 'type':'uint'},
    'ring-level3-4':{'offset':1465, 'len':1, 'type':'uint'},
    'ringosc1-level':{'offset':1466, 'len':1, 'type':'uint'},
    'ringosc2-level':{'offset':1467, 'len':1, 'type':'uint'},
    'ringosc3-level':{'offset':1468, 'len':1, 'type':'uint'},
    'ringosc4-level':{'offset':1469, 'len':1, 'type':'uint'},
    'xmod1-2-depth':{'offset':1472, 'len':2, 'type':'uint'},
    'xmod3-4-depth':{'offset':1474, 'len':2, 'type':'uint'},
    'xmodosc1-level':{'offset':1476, 'len':1, 'type':'uint'},
    'xmodosc2-level':{'offset':1477, 'len':1, 'type':'uint'},
    'xmodosc3-level':{'offset':1478, 'len':1, 'type':'uint'},
    'xmodosc4-level':{'offset':1479, 'len':1, 'type':'uint'},
    'phase-lock':{'offset':1480, 'len':1, 'type':'uint'},
    'xmod21-2-depth':{'offset':1481, 'len':1, 'type':'uint'},
    'xmod23-4-depth':{'offset':1482, 'len':1, 'type':'uint'},

    # Key
    # Oscillator 1.
    'osc1':{'offset':164, 'type':'map', 'name':'keyboard'},
    'osc2':{'offset':176, 'type':'map', 'name':'keyboard'},
    'osc3':{'offset':188, 'type':'map', 'name':'keyboard'},
    'osc4':{'offset':200, 'type':'map', 'name':'keyboard'},
    'osc1':{'offset':232, 'type':'map', 'name':'oscillator'},
#    'osc1':{'offset':1496, 'type':'map', 'name':'oscillator'},
}

def print_map(kv, spacing, read_data):
    global startOffset
    offset = kv['offset']
    name = kv['name']
    patch_data = sub_patches[name]
    for k in patch_data:
        print(spacing, k, ':', get_data_patch(k, startOffset + offset, patch_data, read_data))

def get_data_patch(name, startOffset, ppart, bytes):
    patch=ppart
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
                v = v + 2**(8*i) * b
            if t == 'int' and v >= maxval / 2:
                v = v - maxval
            return v
    return "no-found."


def get_data(name, bytes):
    global patch, startOffset
    return get_data_patch(name, startOffset, patch, bytes)

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
            diffStr = " diff at: %04d" % adr
    print("%02x" %b, end='')
    i = i + 1
    if (i == 16):
        print("   " + s)
        if diff: print("#    " + d2 + "   " + s2 + "   " + diffStr)
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
    space = ""
    for p in patch:
        if patch[p]['type'] == 'map':
            print(p + "-" + patch[p]['name'] + " ------")
            space = "  "
            print_map(patch[p], space, bytes_read)
        else:
            space = ""
            print(p, get_data(p, bytes_read))

    print("Level:" + str(get_data('level', bytes_read)))
    print("Pan:" + str(get_data('pan', bytes_read)))
    print("Category:" + str(get_data('category', bytes_read)))
    print("Osc-mode-1-2:" + str(get_data('structure1-2', bytes_read)))
    print("Osc-mode-3-4:" + str(get_data('structure3-4', bytes_read)))
    print("Ring-level1-2:" + str(get_data('ring-level1-2', bytes_read)))
    print("Ring-level3-4:" + str(get_data('ring-level3-4', bytes_read)))
    print("coarse-tune:" + str(get_data('coarse-tune', bytes_read)))
    print("fine-tune:" + str(get_data('fine-tune', bytes_read)))
    # Seems like the checksum is a plain CRC32 - which is great!
    crc32 = binascii.crc32(bytes_read[128+12:1632+(128+12)])
    checksum = bytes_read[128 + 4] + bytes_read[128 + 5] * 256 + bytes_read[128 + 6] * 65536 + bytes_read[128 + 7] * 16777216
    print("CRC32: " + "%08x" % crc32 + " vs " + "%08x" % checksum)


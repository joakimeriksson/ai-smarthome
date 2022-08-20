#
# Read one or two Roland SVZ files - Zen Core
#
# (c) Joakim Eriksson
#
import sys
import json, binascii

zendata = {}

def get_data(group, name, data, offset):
    global zendata
    gdata = zendata[group]
    for param in gdata:
        if param['id'] == name:
            print(param)
            offset = offset + param['pos']
            return data[offset:offset + param['size']]
    return 0

def show_all_data(data, offset):
    for group in zendata:
        if group == 'name':
            print("Name" + zendata[group])
            continue
        print("Group:", group)
        for param in zendata[group]:
            #print(param)
            voffset = offset + param['pos']
            val = data[voffset : voffset + param['size']]
            if param['size'] < 3:
                val = int.from_bytes(val, "little")
            print('  ' + param['id'], param['size'], "=", val)

# Offset from start
startOffset = 128

with open("zcformat.json", "rb") as f:
    zendata = json.loads(f.read())

print(zendata)

print("Loading", sys.argv[1])
with open(sys.argv[1], "rb") as f:
    bytes_read = f.read()

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
    print("Total len:" + str(mlen + plen))
    startOffset = 128 + num_patches * 4 - 4;

    print("Name of First sound:", get_data('PCMT_CMN', 'NAME', bytes_read, startOffset + 8))
    space = ""

    show_all_data(bytes_read, startOffset + 8)

    # Seems like the checksum is a plain CRC32 - which is great! NOTE - start offset includes the 0000 + CRC so name
    # starts at 8 + startOffset. The crcOFfset is taking the name and all the data after that - and calculate CRC.
    crcOffset = 8
    crc32 = binascii.crc32(bytes_read[startOffset + crcOffset : size_patches + startOffset + crcOffset])
    checksum = bytes_read[128 + 4] + bytes_read[128 + 5] * 256 + bytes_read[128 + 6] * 65536 + bytes_read[128 + 7] * 16777216
    print("CRC32: " + "%08x" % crc32 + " vs " + "%08x" % checksum)

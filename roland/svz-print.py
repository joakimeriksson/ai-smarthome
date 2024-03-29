#
# Read one or two Roland SVZ files - Zen Core
#
# (c) Joakim Eriksson
#
import sys
import json, binascii, yaml

zenconv = {'PCMT_CMN':{'NAME':lambda x : x.decode("utf-8")}}
zendata = {}

def get_data(group, name, data, offset):
    global zendata
    for param in zendata[group]:
        if param['id'] == name:
            offset = offset + param['pos']
            return data[offset:offset + param['size']]
    return 0

def show_all_data(data, offset):
    patch = {}
    yamlData = {'version':0.1,'patches':[patch]}
    for group in zendata:
        if group == 'name':
            print("Name" + zendata[group])
            continue
        print("Group:", group)
        paramlist = []
        for param in zendata[group]:
            voffset = offset + param['pos']
            val = data[voffset : voffset + param['size']]
            if param['size'] < 3:
                val = int.from_bytes(val, "little")
            # Padding can be ignored...
            if 'id' in param:
                id = param['id']
                # Autoconvert where explicitly stated
                if group in zenconv and id in zenconv[group]:
                    val = zenconv[group][id](val)
                    print("autoconv ", group, id, val)
                print('  ' + param['id'], param['size'], "=", val)
                paramlist = paramlist + [{param['id']:val}]
        patch[group] = paramlist
    return yamlData

# Offset from start
startOffset = 128

with open("zcformat.json", "rb") as f:
    zendata = json.loads(f.read())

#print(zendata)

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
    if bytes_read[16:24] == b'DIFaZCOR':
        pstart = bytes_read[24] + bytes_read[25] * 256
        plen = bytes_read[28] + bytes_read[29] * 256
        print("  Type: Zen Core DIF Data of len: " + str(plen) + " starting at: " + str(pstart))
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

    # patch start at pstart + 4 (num) + 4 (size) + 4 (?) + 4(?) + 32-bit CRC x num
    startOffset = pstart + 4 + 4 + 4 + 4 + num_patches * 4
    crcOffset = pstart + 4 + 4 + 4 + 4
    print("Start offset", startOffset, " CrcOffset:", crcOffset)
    print("Name of First sound:", get_data('PCMT_CMN', 'NAME', bytes_read, startOffset))
    space = ""

    for i in range(0, num_patches):
        print("Patch", i + 1, " Name", get_data('PCMT_CMN', 'NAME', bytes_read, startOffset + i * size_patches))
        crc32 = binascii.crc32(bytes_read[startOffset + i * size_patches: startOffset + size_patches * (i + 1)])
        checksum = bytes_read[i * 4 + crcOffset] + bytes_read[i * 4 + crcOffset + 1] * 256 + bytes_read[i * 4 + crcOffset + 2] * 65536 + bytes_read[i * 4 + crcOffset + 3] * 16777216
        print("CRC32: " + "%08x" % crc32 + " vs " + "%08x" % checksum)

    # Show first patch and generate data for it.
    patchdata = show_all_data(bytes_read, startOffset)
    # Write YAML file
    with open('data.yaml', 'w', encoding='utf8') as outfile:
        outfile.write("#\n# Autogenerated Zencore - YAML patch\n#\n")
        yaml.dump(patchdata, outfile, sort_keys=False, allow_unicode=True)

    # Seems like the checksum is a plain CRC32 - which is great! NOTE - start offset is from Name in the patch/tone
    crc32 = binascii.crc32(bytes_read[startOffset : size_patches + startOffset])
    checksum = bytes_read[crcOffset] + bytes_read[crcOffset + 1] * 256 + bytes_read[crcOffset + 2] * 65536 + bytes_read[crcOffset + 3] * 16777216
    print("CRC32: " + "%08x" % crc32 + " vs " + "%08x" % checksum)

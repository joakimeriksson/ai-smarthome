#
#
# Reader of XML files in rolands generic editor format (Jupiter-X or Juno-X)
# Can generate JSON data for reading / writing zencore data.
#
#  Author: Joakim Eriksson
#
import xml.etree.ElementTree as ET
import json, copy


numdef = {}
groups = {}
baseBlocks = {}

def get_num(str):
    try:
        return int(str)
    except:
        return numdef[str]

# define some attributes to get for params
attdefs = {'id':str, 'desc':str, 'init':get_num, 'min':get_num, 'max':get_num, 'array':get_num}

def fill_atts(data, elem):
    atts = elem.attrib
    for t in atts:
        if t in attdefs:
            data[t] = attdefs[t](atts[t])
    print("FILL ATTS:", data)

#<baseblock name="PCMT_CMN" desc="PCMTone Common">
#	<param id="NAME"			init="32"		min="32"	max="127"					array="16" 	desc="Name" 					desc_val="32 - 127 [ASCII]" 		/>
#   <param id="CATEGORY"		init="0" 		min="0" 	max="50" 								desc="Category"		 			desc_val="None, Ac.Piano, Pop-Piano, E.Grand Piano, E.Piano1, E.Piano2, E.Organ, Pipe Organ, Reed Organ, Harpsichord, Clav, Celesta, Accordion, Harmonica, Bell, Mallet, Ac.Guitar, E.Guitar, Dist.Guitar, Ac.Bass, E.Bass, Synth Bass, Plucked/Stroke, Solo Strings, Ensemble Strs, Orchestral, Solo Brass, Ensemble Brass, Wind, Flute, Sax, Recorder, Vox/Choir, Scat, Synth Lead, Synth Brass, Synth Pad/Str, Synth BellPad, Synth PolyKey, Synth FX, Synth Seq/Pop, Phrase, Pulsating, Beat&amp;Groove, Hit, Sound FX, Drums, Percussion, Stack, Zone, Vocoder"					/>
#...
def read_baseblock(bblock):
    bbData = []
    pos = 0
    for e in bblock:
        size = 1
        data = {'type':e.tag}
        fill_atts(data, e)
        if e.tag == 'sysex_end':
            continue
        if e.tag == 'subblock':
            num = get_num(e.attrib['array'])
            prefix = e.attrib['id']
            subblock = read_baseblock(e)
            for sbi in range (0, num):
                print("generating subblock ", prefix, sbi)
                for param in subblock:
                    d = copy.deepcopy(param)
                    if d['type'] == 'param':
                        d['id'] = prefix + '_' + str(sbi + 1) + '_' + param['id']
                    d['pos'] = pos
                    pos = pos + d['bytesize']
                    bbData.append(d)
            continue
        if e.tag == 'padding':
            size = int(e.attrib['bytesize'])
        # Use max to guess bytesize...
        if 'max' in e.attrib:
            max = get_num(e.attrib['max'])
            min = get_num(e.attrib['min'])
            if max > 255:
                size = 2
            if max - min > 255:
                size = 2
        if 'type' in e.attrib:
            if e.attrib['type'] == 'uint16':
                size = 2 
        data['bytesize'] = size
        data['pos'] = pos
        pos = pos + size
        bbData.append(data)
    return bbData

def read_unionbaseblock(bblock):
    bbData = []
    pos = 0
    for e in bblock:
        if e.tag == 'common':
            commonBlock = read_baseblock(e)
            print("GOT COMMON:", commonBlock)
            bbData = bbData + commonBlock
        if e.tag == 'share':
            shareBlock = read_baseblock(e)
            print("GOT SHARE", shareBlock)
            bbData = bbData + shareBlock
    return bbData

# <block id="ptl"				baseblock="PCMT_PTL"	array="partialSize" size="00.01.00" />
#
def read_block(block, offset = None):
    bData = {}
    attr = block.attrib
    if offset is not None:
        bData['offset'] = offset
    bData['id'] = attr['id']
    bData['baseblock'] = attr['baseblock']
    if 'array' in attr:
        cname = attr['array']
        bData['array'] = get_num(cname)
    if 'size' in attr:
        bData['size'] = attr['size']
    if 'desc' in attr:
        bData['desc'] = attr['desc']
    return bData

def read_group(group):
    gData = []
    offset = None
    for e in group:
        if e.tag == "block":
            # Use offset - and then "clear"
            gData.append(read_block(e, offset=offset))
            offset = None
        if e.tag == "offset":
            # Put in an offset adrs  <offset adrs="00.10.00.00"/>
            offset = e.attrib['adrs']
    return gData

def show_block(block, pos):
    bb = baseBlocks[block]
    data = []
    for e in bb:
        # Print all the parameters...
        arr = 1
        if 'array' in e: arr = e['array']
        size = arr * e['bytesize']
        if e['type'] == 'param':
            print("   ", e['id'], " ", pos, " ", size, e)
        # copy over some of the data in the param data
        newelem = {key: e[key] for key in e.keys() & {'id', 'init', 'min', 'max', 'desc'}}
        data = data + [{**newelem, 'pos': pos, 'size': size}]
        if e['type'] == 'padding':
            print("    <padding>", pos, size)
        pos = pos + size
    return pos, data

# Print data about a specific group - including all the positions, etc.
def show_group(gstr):
    groupData = groups[gstr]
    pos = 0
    grpjson = {'name': gstr}
    for e in groupData:
        arr = 1
        if 'array' in e:
            arr = e['array']
        for i in range(0, arr):
            print("BLOCK ", e['baseblock'], e['id'], i)
            pos, data = show_block(e['baseblock'], pos)
            name = e['baseblock']
            if arr > 1: name  = name + '_' + str(i + 1)
            grpjson[name] = data
    return grpjson

def read_file(f):
    print("** Reading file", f)
    tree = ET.parse(f)
    root = tree.getroot()
    for child in root:
        print(child.tag, child.attrib)
        # Numdef is some kind of constants.
        if child.tag == "numdef":
            numdef[child.attrib['name']] = int(child.attrib['num'])
        # group is a group with some structure - representing a "Tone"/Patch, performance, etc.
        if child.tag == "group":
            groupData = read_group(child)
            groups[child.attrib['name']] = groupData
        if child.tag == "baseblock":
            baseBlock = read_baseblock(child)
            baseBlocks[child.attrib['name']] = baseBlock
        if child.tag == "unionbaseblock":
            baseBlock = read_unionbaseblock(child)
            baseBlocks[child.attrib['name']] = baseBlock

# Read some files that will define the PCMEX (Tone/Patch data)
read_file('JUPITERprmdb/db_bmc0.xml')
read_file('JUPITERprmdb/db_muse_pcmex.xml')
read_file('JUPITERprmdb/db_muse_mfx.xml')

# Print the PCMEX that correspond to tone-data
data = show_group("PCMEX")
with open("zcformat.json", "w") as outfile:
    json.dump(data, outfile, indent=4)

print(json.dumps(data, indent=4, sort_keys=False))

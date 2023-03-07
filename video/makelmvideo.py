#!/usr/bin/env python3

import moviepy, sys, argparse, numpy as np, yaml
from moviepy.editor import *
from PIL import Image, ImageFont, ImageDraw, ImageOps

# Fonts for the texts on the intro slide
font1 = ImageFont.truetype("fonts/AvenirNext-Regular.ttf", 40)
font_title = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 80)
font2 = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 55)
font3 = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 40)
color = (255,255,255)

def draw_line(draw, pos, text, font):
    global color
    draw.text((pos[0], pos[1]), text, color,font=font)
    size = font.getsize(text)
    return (pos[0] + size[0], pos[1] + size[1])

def draw_multi_line(draw, pos, text, font, max_width):
    if font.getsize(text)[0] <= max_width:
        return draw_line(draw, pos, text, font)
    else:
        # split the line by spaces to get words
        words = text.split()
        i = 0
        # append every word to a line while its width is shorter than image width
        line = ''
        for word in words:
            if font.getsize(line + word)[0] <= max_width:
                line = line + word + " "
            else:
                (x, y) = draw_line(draw, pos, line, font)
                pos = (pos[0], y)
                line = word + " "
        if len(line) > 0:
            return draw_line(draw, pos, line, font)
        return pos

def clip_info(clip):
    print("FPS:", clip.fps)
    print("Size: ", clip.w, clip.h, clip.aspect_ratio)

args = sys.argv[1:]
p = argparse.ArgumentParser()
p.add_argument('-n', action='store_true', dest='test_only', default=False)
p.add_argument('input_file')
conopts = p.parse_args(args)

input_files = conopts.input_file
if os.path.isfile(input_files):
    input_movie = input_files
else:
    sys.exit(f"Could not find input file: {input_files}")

with open('config.yaml', 'r') as file:
    config = yaml.safe_load(file)

if 'color' in config['config']:
    h = config['config']['color']
    colorfooter = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
colortitle = colorfooter
if 'offset_footer' in config['config']:
    offset_footer = config['config']['offset_footer']
else:
    offset_footer = [0,0]

print("Offset:", offset_footer)
    
im = Image.open(config['intro']['image'])
w = 1920
h = im.height * 1920.0 / im.width
im = im.resize((int(w),int(h)), Image.ANTIALIAS)
draw = ImageDraw.Draw(im)
color = colorfooter
left = 120 + offset_footer[0]
draw_multi_line(draw, (left, 900 + offset_footer[1]), config['session']['footer1'], font2, 1800)
draw_multi_line(draw, (left, 970 + offset_footer[1]), config['session']['footer2'], font3, 1800)

left = 120
color = colortitle
draw_multi_line(draw, (left, 200), config['session']['date'], font3, 1800)
(x, by) = draw_multi_line(draw, (left, 280), config['session']['title'], font_title, 1800)

(x, y) = draw_multi_line(draw, (left, by + 80), "Speaker: ", font3, 1800)
draw_multi_line(draw, (x + 10, by + 80), config['session']['speaker'], font1, 1800)
if 'introby' in config['session']:
    (x, y) = draw_multi_line(draw, (left, by + 120), "Introduction: ", font3, 1800)
    draw_multi_line(draw, (x + 10, by + 120), config['session']['introby'], font1, 1800)

audioclip = AudioFileClip(config['intro']['audio'])
# Fade in / out audio.
newaudio = (audioclip.audio_fadein(1.0)
                     .audio_fadeout(1.0))

logo = ImageClip(np.array(im))
logo = logo.set_duration(7)
logo.audio = newaudio

# Setup the input clip
clip1 = VideoFileClip(input_movie)
print("-- Input clip:", input_movie)
path = input_movie.split('/')
name = path[-1].split(".")[0]
output_movie = "proc-" + path[-1]
clip_info(clip1)

logo = logo.resize(width = clip1.w)

start_time = (config['video']['start'][0], config['video']['start'][1])
print("Clip Start time:", start_time)
if "end" in config['video']:
    end_time = (config['video']['end'][0], config['video']['end'][1])
    final_clip = concatenate_videoclips([logo, clip1.subclip(start_time, end_time)], method='compose')
else:
    final_clip = concatenate_videoclips([logo, clip1.subclip(start_time)], method='compose')
print("-- Output clip:")
clip_info(final_clip)

final_clip.write_videofile(output_movie, temp_audiofile='temp-audio.m4a', threads=15, remove_temp=False, codec="libx264", audio_codec="aac")

import sys, os, argparse, numpy as np, yaml
from PIL import Image, ImageFont, ImageDraw, ImageOps
import cv2


# Fonts for the texts on the intro slide
font1 = ImageFont.truetype("fonts/Calibri.ttf", 35)
#font1 = ImageFont.truetype("fonts/AvenirNext-Regular.ttf", 40)
font_title = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 80)
font2 = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 55)
font3 = ImageFont.truetype("fonts/AvenirNext-Bold.ttf", 40)
color = (0,0,0)

image = None
positions = []

def draw_pos(n, x, y):
    center_coordinates = (x, y)  # Adjust these values based on your image dimensions       
    radius = 10
    color = (255, 168, 168)  # Blue in BGR
    thickness = 2  # Use -1 for a filled circle
    # Draw the circle
    cv2.circle(image, center_coordinates, radius, color, thickness)
    org = (x - 5, y)  # Bottom-left corner of the text string in the image
    font = cv2.FONT_HERSHEY_SIMPLEX  # Font type
    fontScale = 1  # Font scale (size of the font)
    color = (0, 0, 0)  # White color in BGR
    thickness = 2  # Thickness of the lines used to draw the text
    cv2.putText(image, str(n), org, font, fontScale, color, thickness, cv2.LINE_AA)


def mouse_callback(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN:
        positions.append({'x':x,'y':y})
        draw_pos(len(positions), x, y)

def draw_line(draw, pos, text, font):
    global color
    draw.text((pos[0], pos[1]), text, color,font=font)
    size = font.getsize(text)
    (xsize,ysize) = font.getsize("ABCDEFyglq")
    return (pos[0] + size[0], pos[1] + ysize)

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

args = sys.argv[1:]
p = argparse.ArgumentParser()
p.add_argument('-n', action='store_true', dest='test_only', default=False)
p.add_argument('-c', dest='config', default="config.yaml")
p.add_argument('input_file')
conopts = p.parse_args(args)

print("Arguments", conopts)

input_files = conopts.input_file
if os.path.isfile(input_files):
    input = input_files
else:
    sys.exit(f"Could not find input file: {input_files}")

with open(conopts.config, 'r') as file:
    config = yaml.safe_load(file)
    if 'positions' in config:
        positions = config['positions']
    if 'posters' in config:
        posters = config['posters']

#img = Image.open(input)
image = cv2.imread(input)

# Pillow setup
# Convert the color from BGR to RGB
image2 = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
# Convert the OpenCV image to a PIL Image
pil_img = Image.fromarray(image)


# Create an ImageDraw object
draw = ImageDraw.Draw(pil_img, "RGBA")

boxes = [(40,1400, 1000, 380), (1060,1400, 1000,380), (2080,1400, 1000, 380), (700,50, 900,900), (1950,50, 900,900)]

for box in boxes:
    (xpos, ypos, wid, hei) = box
    # First rectangle
    draw.rectangle([(xpos, ypos), (xpos + wid, ypos + hei)],
        fill=(200, 200, 255, 128))

pos = (xpos + 4, ypos + 2)
pnum = 0
boxnr = 0
# Need to move the "boxes" also...
(xpos, ypos, wid, hei) = boxes[boxnr]
pos = (xpos + 4, ypos)
for poster in posters:
    pnum = pnum + 1
    if (pnum < 10):
        pos = (pos[0] + 15, pos[1])
    draw_multi_line(draw, pos, str(pnum), font1, wid - 45)
    pos = (pos[0] + 40, pos[1])
    pos = draw_multi_line(draw, pos, poster['name'], font1, wid - 45)
    pos = (xpos + 4, pos[1])
    if (pos[1] + 25 > ypos + hei):
        boxnr = boxnr + 1
        (xpos, ypos, wid, hei) = boxes[boxnr]
        pos = (xpos + 4, ypos)



# Convert back to OpenCV image and show it
image = np.array(pil_img)
image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

cv2.namedWindow("Test")
cv2.setMouseCallback("Test", mouse_callback)
n = 0
for pos in positions:
    n = n + 1
    draw_pos(n, pos['x'], pos['y'])
while True:
    cv2.imshow("Test", image)
    if cv2.waitKey(1) & 0xFF == ord('q'):  # Press 'q' to quit
        break

print(positions)
ystr = yaml.safe_dump({"positions":positions})
print(ystr)
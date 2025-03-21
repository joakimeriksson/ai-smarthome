import sys, os, argparse, numpy as np, yaml
from PIL import Image, ImageFont, ImageDraw
import cv2

# Fonts for the texts on the intro slide
font1 = ImageFont.truetype("fonts/Calibri.ttf", 31)
color = (0,0,0)
circle_color = (255, 200, 200)

image = None
positions = []
line_spacing = 8

def closest_point_on_line(p1, p2, p3):
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    dx, dy = x2-x1, y2-y1
    det = dx*dx + dy*dy
    a = (dy*(y3-y1)+dx*(x3-x1))/det
    return x1+a*dx, y1+a*dy

def draw_pos(n, x, y):
    center_coordinates = (x, y)  # Adjust these values based on your image dimensions       
    radius = 10
    thickness = 3  # Use -1 for a filled circle
    # Draw the circle
    cv2.circle(image, center_coordinates, radius, circle_color, thickness)
    if n is not None:
        org = (x - 20, y + 10)  # Bottom-left corner of the text string in the image
        font = cv2.FONT_HERSHEY_SIMPLEX  # Font type
        fontScale = 0.9  # Font scale (size of the font)
        color = (0, 0, 0)  # White color in BGR
        thickness = 2  # Thickness of the lines used to draw the text
        cv2.putText(image, str(n), org, font, fontScale, color, thickness, cv2.LINE_AA)


def mouse_callback(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN:
        positions.append({'x':x,'y':y})
        draw_pos(len(positions), x, y)

def draw_line(draw, pos, text, font, predict = False):
    if not predict:
        draw.text((pos[0], pos[1]), text, color,font=font)
    bbox = font.getbbox(text)
    size = (bbox[2] - bbox[0], bbox[3] - bbox[1])
    example_bbox = font.getbbox("ABCDEFyglq")
    # Somehow bbox gets less height than the old getsize of the font call. 
    # add 1 here to compensate a bit.
    xsize, ysize = example_bbox[2] - example_bbox[0], line_spacing + example_bbox[3] - example_bbox[1]
    return (pos[0] + size[0], pos[1] + ysize)

def draw_multi_line(draw, pos, text, font, max_width, predict = False):
    bbox = font.getbbox(text)
    text_width = bbox[2] - bbox[0]
    if text_width <= max_width:
        return draw_line(draw, pos, text, font, predict)
    else:
        # split the line by spaces to get words
        words = text.split()
        i = 0
        # append every word to a line while its width is shorter than image width
        line = ''
        for word in words:
            bbox = font.getbbox(line + word)
            if (bbox[2] - bbox[0]) <= max_width:
                line = line + word + " "
            else:
                (x, y) = draw_line(draw, pos, line, font, predict)
                pos = (pos[0], y)
                line = word + " "
        if len(line) > 0:
            return draw_line(draw, pos, line, font, predict)
        return pos

def load_and_update(input):
    image = cv2.imread(input)

    # Pillow setup
    # Convert the OpenCV image to a PIL Image
    pil_img = Image.fromarray(image)

    # Create an ImageDraw object
    draw = ImageDraw.Draw(pil_img, "RGBA")

    # The boxes where we will put the poster names
    boxes = [(40,1400, 960, 380), (1060,1400, 960,380), (2080,1400, 960, 380), (700, 40, 960, 970), (1950, 40, 960,970)]

    for box in boxes:
        (xpos, ypos, wid, hei) = box
        # First rectangle
        draw.rectangle([(xpos, ypos), (xpos + wid, ypos + hei)],
            fill=(210, 210, 255, 128))

    pos = (xpos + 4, ypos + 2)
    pnum = 0
    boxnr = 0
    # Need to move the "boxes" also...
    (xpos, ypos, wid, hei) = boxes[boxnr]
    pos = (xpos + 4, ypos)

    sorted_posters = sorted(posters, key=lambda obj: obj['position'])
    count = {}
    for poster in sorted_posters:
        pnum = pnum + 1

        # predict
        ppos = draw_multi_line(draw, pos, poster['name'], font1, wid - 55, True)
        if (ppos[1] + 5 > ypos + hei):
            boxnr = boxnr + 1
            print("Box no:", boxnr)
            (xpos, ypos, wid, hei) = boxes[boxnr]
            pos = (xpos + 4, ypos)

        if (pnum < 10):
            pos = (pos[0] + 20, pos[1])

        poster_pos = poster['position']
        draw_multi_line(draw, pos, str(poster_pos), font1, wid - 55)
        pos = (pos[0] + 50, pos[1])
        pos = draw_multi_line(draw, pos, poster['name'], font1, wid - 55)
        pos = (xpos + 4, pos[1])
        print(str(pnum) + ": " + poster['name'])
        # draw a circle...
        p = positions[poster_pos - 1]
        count[poster_pos] = count.get(poster_pos, 0) + 1
        print("Draw circle at ", poster_pos, p)
        radius = 10
        # Define the bounding box for the circle
        left_up_point = (p['x'] - radius, p['y'] - radius)
        right_down_point = (p['x'] + radius, p['y'] + radius)
        bbox = [left_up_point, right_down_point]
        # Draw the circle
        color = "#b0b0ff"
        if count[poster_pos] > 1:
            color = "#f0b0b0"
        draw.ellipse(bbox, fill=color)

    n = 0
    for pos in positions:
        n = n + 1
        draw_line(draw, (pos['x'] - 18, pos['y'] - 20), str(n) , font1)

    # Convert back to OpenCV image and show it
    image = np.array(pil_img)
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

    return image


args = sys.argv[1:]
p = argparse.ArgumentParser()
p.add_argument('-c', dest='config', default="config.yaml")
p.add_argument('input_file')
conopts = p.parse_args(args)

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
    if 'linespacing' in config:
        line_spacing = config['linespacing']


image = load_and_update(input)

cv2.namedWindow("Test")
cv2.setMouseCallback("Test", mouse_callback)

while True:
    cv2.imshow("Test", image)
    key = cv2.waitKey(1) & 0xff
    if key == ord('z'):
        positions.pop()
        print(positions)
        image = load_and_update(input)
    if key == ord('q'):  # Press 'q' to quit
        break

print(positions)
ystr = yaml.safe_dump({"positions":positions})
print(ystr)
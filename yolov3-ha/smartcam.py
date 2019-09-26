#
# Example of using keras-yolo3 for detecting object on a camera.
# The idea is to detect persons or moving objects and to build a
# warning/notification system for that.
#
# Also allow plugin of Home-automation integration and calls:
#
# - ha_detect.publish_detection(detect_type, max_score) - top detection
# - ha_detect.publish_image(png-image) - detection image with boxes
#
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import cv2, numpy as np, datetime
from PIL import Image, ImageFont, ImageDraw
import sys, importlib, getopt, yaml

# Path to keras-yolo3 with Joakim Erikssons PR pulled in.
yolo_path = '../../keras-yolo3'
sys.path.append(yolo_path)
import yolo
import hacv

debug_enable = 0
def debug(*arg):
    if debug_enable:
        print(arg)

def usage():
        print("Usage: ", sys.argv[0],"[-v <URI>] [-s] [-d]")
        print("Options:")
        print("-h             help - show this info")
        print("-v <URI>       fetch video from this URI")
        print("-p <pkg.class> plugin for the video detection notifications")
        print("-s             show input and detections (openCV)")
        print("-d             save detections to disk")
        print("-c             load config file")

video_path = "0"
show = False
save_to_disk = False
plugin = "hacv.CVMQTTPlugin".split(".")
config = None
yaml_cfg = None

try:
    argv = sys.argv[1:]
    opts, args = getopt.getopt(argv,"hsdv:p:c:")
except getopt.GetoptError as e:
    sys.stderr.write(str(e) + '\n')
    usage()
    sys.exit(2)
for opt, arg in opts:
    if opt == '-h':
        usage()
        sys.exit()
    elif opt == "-s":
        show = True
    elif opt == "-d":
        save_to_disk = True
    elif opt == "-v":
        video_path = arg
    elif opt == "-p":
        plugin = arg.split(".")
    elif opt == "-c":
        config = arg

if config is not None:
        with open(config, 'r') as ymlfile:
                yaml_cfg = yaml.load(ymlfile)
        debug("Config: ", yaml_cfg)
        cvconf = yaml_cfg['cvconf']
        plugin = cvconf['plugin'].split(".")
        video_path = cvconf['video']

# allow video_path "0" => first camera (web-camera on my Macbook)
if video_path == "0":
   video_path = 0

# setup the video stream
video=cv2.VideoCapture(video_path)
ret, frame = video.read()
avgframe = frame

# Use the default YOLOv3 model data and its font.
kwargs = {"model_path" : yolo_path + '/model_data/yolo.h5',
          "anchors_path": yolo_path + '/model_data/yolo_anchors.txt',
          "classes_path": yolo_path + '/model_data/coco_classes.txt',
          "font_path": yolo_path + '/font/FiraMono-Medium.otf'}

# create the plugin
cls = getattr(importlib.import_module(plugin[0]), plugin[1])
ha_detect = cls(yaml_cfg)

yolo = yolo.YOLO(**kwargs)

while(1):
        ret, frame = video.read()
        subframe = cv2.subtract(frame, avgframe)
        grayscaled = cv2.cvtColor(subframe, cv2.COLOR_BGR2GRAY)
        retval2,th1 = cv2.threshold(grayscaled,35,255,cv2.THRESH_BINARY)
        avgframe = cv2.addWeighted(frame, 0.1, avgframe, 0.9, 0.0)

        if show:
                cv2.imshow('Frame', frame)
                cv2.imshow('Treshold diff', th1)

        th1 = th1 / 255
        w, h = th1.shape
        sum = cv2.sumElems(th1)[0]/(w*h)
        debug("SUM:", cv2.sumElems(th1)[0]/(w*h), w, h)
        if sum > 0.001:
                fconv = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = Image.fromarray(fconv)
                out_boxes, out_scores, out_classes = yolo.detect_image_boxes(image)
                detect_name = ''
                detect_class = ''
                max_score = 0
                for i, c in reversed(list(enumerate(out_classes))):
                        predicted_class = yolo.class_names[c]
                        score = out_scores[i]
                        if score > max_score:
                                max_score = score
                                detect_name = predicted_class + "-" + str(score) + "-"
                                detect_class = predicted_class
                r_image = yolo.mark_image_boxes(image, out_boxes, out_scores, out_classes)
                detect = cv2.cvtColor(np.array(r_image), cv2.COLOR_RGB2BGR)

                # only publish if score is higher than zero
                if max_score > 0:
                        debug("*** Detected ", detect_name)
                        ha_detect.publish_detection(detect_class, max_score)
                        ha_detect.publish_image(cv2.imencode('.png', detect)[1].tostring())
                # show the image and save detection disk
                if show:
                        cv2.imshow("YOLOv3", detect)
                if save_to_disk:
                        file = 'yolo-' + detect_name + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".png"
                        cv2.imwrite(file, detect)

        cv2.waitKey(1)

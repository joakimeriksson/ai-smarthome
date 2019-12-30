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
import os.path
import colorsys
import hacv
import yolo3

# Initialize the parameters
confThreshold = 0.5  #Confidence threshold
nmsThreshold = 0.4   #Non-maximum suppression threshold

def usage():
        print("Usage: ", sys.argv[0],"[-v <URI>] [-s] [-d]")
        print("Options:")
        print("-h             help - show this info")
        print("-v <URI>       fetch video from this URI")
        print("-p <pkg.class> plugin for the video detection notifications")
        print("-s             show input and detections (openCV)")
        print("-d             save detections to disk")
        print("-c             load config file")

yolo = yolo3.YoloV3(confThreshold, nmsThreshold)

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
        print("Config: ", yaml_cfg)
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

# create the plugin
cls = getattr(importlib.import_module(plugin[0]), plugin[1])
ha_detect = cls(yaml_cfg)

while(1):
        ret, frame = video.read()
        if ret:
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
                print("SUM:", cv2.sumElems(th1)[0]/(w*h), w, h)
                if sum > 0.001:
                    detection = yolo.detect(frame)
                    
                    # Put efficiency information. The function getPerfProfile returns the
                    # overall time for inference(t) and the timings for each of the layers(in layersTimes)
                    t, _ = yolo.net.getPerfProfile()
                    label = 'Inference time: %.2f ms' % (t * 1000.0 / cv2.getTickFrequency())
                    cv2.putText(frame, label, (0, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255))
                    # Write the frame with the detection boxes
                    if len(detection) > 0:
                        max_score = detection[0][1]
                        detect_name = detection[0][0]
                    else:
                        max_score = 0
                    # only publish if score is higher than zero
                    if max_score > 0:
                        print("*** Detected ", detect_name)
                        ha_detect.publish_detection(detect_name, max_score)
                        ha_detect.publish_detections(detection)
                        ha_detect.publish_image(cv2.imencode('.png', frame)[1].tostring())
                    # show the image and save detection disk
                    if show:
                        cv2.imshow("YOLOv3", frame)
                    if save_to_disk:
                        file = 'yolo-' + detect_name + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".png"
                        cv2.imwrite(file, frame)
        cv2.waitKey(1)

# MIT License
# Copyright (c) 2019 JetsonHacks
# See license
# Using a CSI camera (such as the Raspberry Pi Version 2) connected to a 
# NVIDIA Jetson Nano Developer Kit using OpenCV
# Drivers for the camera and OpenCV are included in the base image

import cv2
import mqtt_cam

# gstreamer_pipeline returns a GStreamer pipeline for capturing from the CSI camera
# Defaults to 1280x720 @ 60fps 
# Flip the image by setting the flip_method (most common values: 0 and 2)
# display_width and display_height determine the size of the window on the screen

def gstreamer_pipeline(capture_width=1280, capture_height=720, display_width=1280, display_height=720, framerate=60, flip_method=0) :   
    return ('nvarguscamerasrc ! ' 
    'video/x-raw(memory:NVMM), '
    'width=(int)%d, height=(int)%d, '
    'format=(string)NV12, framerate=(fraction)%d/1 ! '
    'nvvidconv flip-method=%d ! '
    'video/x-raw, width=(int)%d, height=(int)%d, format=(string)BGRx ! '
    'videoconvert ! '
    'video/x-raw, format=(string)BGR ! appsink'  % (capture_width,capture_height,framerate,flip_method,display_width,display_height))

class JetsonMQTTCamera(mqtt_cam.MQTTCamera):

    def __init__(self, mqttBroker, camera=None, topic="ha/camera/mqtt"):
        self.show = True
        self.broker = mqttBroker
        self.topic = topic
        self.send_frames = 0
        # To flip the image, modify the flip_method parameter (0 and 2 are the most common)
        print(gstreamer_pipeline(flip_method=0))
        self.cap = cv2.VideoCapture(gstreamer_pipeline(flip_method=0), cv2.CAP_GSTREAMER)
        # First frame is average...
        ret, self.avgframe = self.cap.read()
        self.connect("Jetson MQTT Camera")

if __name__ == '__main__':
    mqCam = JetsonMQTTCamera("192.168.1.50", topic="ha/camera/mqtt")
    mqCam.show = False
    mqCam.send_frames = 5
    mqCam.camera_loop()

    # When everything done, release the capture
    cv2.destroyAllWindows()



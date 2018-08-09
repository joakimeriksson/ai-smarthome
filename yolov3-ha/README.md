# Integration of Keras-Yolov3 with Home Assistant over MQTT.
This is an integration of object detection for the Home Asstant smart home platform. 
The integration is done over MQTT - images with detection boxes, motion event (with binary sensor) and TTS-text are sent over MQTT.

Requirements:
* Python 3.x
* Tensorflow + Keras installed (in your python environment)
* Keras-Yolov3 repository with my PR pulled in (or my local version at: https://github.com/joakimeriksson/keras-yolo3/tree/yolo3-boxes-api)
* OpenCV for python (pip3 install opencv-python)
* Camera (built in web camera or RTSP camera)
* MQTT broker
* A home assistant installation (if you want to test the integration)

I used the Anaconda python data science environment to get Keras and Tensorflow installed on my MAC but
there are multiple ways to install this.

# Getting started
To make a really quick test when you have the above installed.

1. git clone ...

2. git clone ...

3. 


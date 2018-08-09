# Integration of Keras-Yolov3 with Home Assistant over MQTT.
This is an integration of object detection for the Home Asstant smart home platform. 
The integration is done over MQTT - images with detection boxes, motion event (with binary sensor) and TTS-text are sent over MQTT.

Requirements:
* Python 3.x
* Tensorflow + Keras installed (in your python environment)
* Keras-Yolov3 repository with my PR pulled in (or my local version at:)

I used the Anaconda python data science environment to get Keras and Tensorflow installed on my MAC but
there are multiple ways to install this.

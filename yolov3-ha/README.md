# Integration of Yolov3 with Home Assistant over MQTT.
This is an integration of object detection for the Home Asstant smart home platform. 
The integration is done over MQTT - images with detection boxes, motion event (with binary sensor) and TTS-text are sent over MQTT.

First version made use of a Keras Tensorflow version of YoloV3. Second version is using the new Darknet support that
is built-in in the latest version of OpenCV. This means that there is no need for Tensorflow or Keras anymore.

Requirements (version 1):
* Python 3.x
* Tensorflow + Keras installed (in your python environment)
* Keras-Yolov3 repository with my PR pulled in (or my local version at: https://github.com/joakimeriksson/keras-yolo3/tree/yolo3-boxes-api)
* OpenCV for python (pip3 install opencv-python)
* Camera (built in web camera or RTSP camera)
* MQTT broker
* A home assistant installation (if you want to test the integration)

Requirements (version 2):
* Python 3.x
* OpenCV for python (pip3 install opencv-python)
* Camera (built in web camera or RTSP camera)
* MQTT broker
* A home assistant installation (if you want to test the integration)


I used the Anaconda python data science environment to get Keras and Tensorflow installed on my MAC but
there are multiple ways to install this.

# Getting started (v1)
To make a really quick test when you have the above installed.

1. Clone the keras-yolo3 and checkout the modified code (yolo3-boxes-api branch)

    > git clone https://github.com/joakimeriksson/keras-yolo3.git
    > cd keras-yolo3
    > git checkout yolo3-boxes-api

2. Clone this repository.

    > git clone https://github.com/joakimeriksson/ai-smarthome.git
    
    
3. Start the application

    > cd ai-smarthome/yolov3-ha
    > python smartcam.py -v 0 -s
    
 This should give you a video feed from "camera 0" on your computer. On My OS-X it is the webcam.

# Getting started (v2)
To make a quick test with this - ensure that you have latest version of open-cv (3.4.2 or later).

1. Clone this repository.

     > git clone https://github.com/joakimeriksson/ai-smarthome.git

2. Download the yolov3 weights:

    > wget https://pjreddie.com/media/files/yolov3.weights

Then run:
 
    > cd ai-smarthome/yolov3-ha
    > python smartcam-ocv.py -v 0 -s
    >

# Run with configuration
You can also run it using 

    >python smartcam.py -c config-file.yaml

This will load configuration from the config file that can be used to configre video stream and
MQTT broker host and other things.

My config looks like this:

    cvconf:
        video: rtsp://192.168.1.169:7447/5b5b034b9008df24782d88f1_2
        plugin: hacv.CVMQTTPlugin

    hacv:
        host: 192.168.1.169
        name: livingroom

The cvconf is for configuring the smart-camera application with its video stream and
which plugin that is going to be used for notifications of detections.

The hacv part is for configuring the homeassistant integration with MQTT Broker host and
the name of the "view" of the camera. In this case detection will be sent to TTS with
"There is a <detected-object-class> in the livingroom". The object-class is from the YOLOv3
object classes (person, sofa, horse, dog, etc.).


# Home Assistant configuration

I have the following configuration in the Home Assistant configuration.yaml file:

    # MQTT Broker
    mqtt:
      broker: 192.168.1.169

    ffmpeg:

    # Live view + MQTT detection camera view
    camera:
      - platform: ffmpeg
        name: LiveView
        input: rtsp://192.168.1.169:7447/5b5b034b9008df24782d88f1_2
      - platform: mqtt
        name: Last Detection (YOLOv3)
        topic: ha/camera/mqtt

    # Binary MQTT Sensor
    binary_sensor:
      - platform: mqtt
        name: GardenMotionSensor
        device_class: motion
        value_template: '{{value_json.on}}'
        state_topic: "ha/motion/mqtt"
        
This assumes a MQTT Broker such as mosquitto or similar running at host 192.168.1.169.

I also have some TTS triggering code in the automations.yaml file to get the notifications on my
sonos speakers (called media_player.kitchen).

    - id: mqtt_tts_id
      alias: MQTT TTS
      trigger:
      - platform: mqtt
        topic: ha/tts/say
      action:
      - service_template: tts.google_say
        entity_id: media_player.kitchen
        data_template:
          message: '{{ trigger.payload }}'

This will register a subscribe on the topic ha/tts/say and trigger an action on the Google TTS
based on the content of the MQTT message. So any message to ha/tts/say will be spoken out on the
Sonos speakers in my kitchen.

![HomeAssistantTest](https://user-images.githubusercontent.com/599447/43793953-440994d0-9a7d-11e8-9b40-7f701500247c.png)

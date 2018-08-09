#
# Example integration of using the keras-yolo3 object detection.
# This integration is towards MQTT in Home-Assistant and can easily
# be configured to provide both images of detection and notifications
# via speakers / TTS - and also be used for triggering other automations
# (via binary sensor API over MQTT).
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import threading, time, yaml

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to broker:", rc)
    else:
        print("Connection failed: ", rc)

class CVMQTTPlugin:
    client = None
    timer = None
    name = "area"
    detects = {}

    def __init__(self, cfg):
        if cfg is not None:
            broker_address = cfg['hacv']['host']
            self.name = cfg['hacv']['name']
        else:
            broker_address = "127.0.0.1"
        self.client = mqttClient.Client("Python-CV-YOLO3")
        self.client.on_connect = on_connect
        self.client.connect(broker_address)
        self.client.loop_start()

    def no_motion(self):
        print("publishing motion OFF");
        self.client.publish("ha/motion/mqtt", '{"on":"OFF"}')

    def publish_detection(self, detection_type, likelihood):
        print("Publishing ", detection_type, likelihood)
        if detection_type not in self.detects:
            self.detects[detection_type] = 0
        if self.detects[detection_type] + 10.0 < time.time():
            self.detects[detection_type] = time.time()
            print("publish TTS")
            self.client.publish("ha/tts/say", "There is a " + detection_type + " in the " + self.name)
            print("publish Motion")
            self.client.publish("ha/motion/mqtt", '{"on":"ON", "type":"' + detection_type + '"}')
            if self.timer is not None:
                self.timer.cancel()
            print("Setting up timer for 15 seconds")
            self.timer = threading.Timer(15, self.no_motion)
            self.timer.start()

    def publish_image(self, image):
        print("Publishing image.")
        self.client.publish("ha/camera/mqtt", image)

    def __del__(self):
        self.client.disconnect()
        self.client.loop_stop()


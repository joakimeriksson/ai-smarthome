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
import threading, time, yaml, json

debug_enable = 0
def debug(*arg):
    if debug_enable:
        print(arg)

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        debug("Connected to broker:", rc)
    else:
        debug("Connection failed: ", rc)

class CVMQTTPlugin:
    client = None
    timer = None
    name = "area"
    detects = {}
    username = None
    password = None
    mqtt_tts = "ha/tts/mqtt"
    mqtt_motion = "ha/motion/mqtt"
    mqtt_camera = "ha/camera/mqtt"
    mqtt_detections = "ha/detect/detections"

    def __init__(self, cfg):
        if cfg is not None:
            broker_address = cfg['hacv']['host']
            self.name = cfg['hacv']['name']
            if cfg['hacv']['username']:
                self.username = cfg['hacv']['username']
            if cfg['hacv']['password']:
                self.password = cfg['hacv']['password']
            if cfg['hacv']['mqtt_tts']:
                self.mqtt_tts = cfg['hacv']['mqtt_tts']
            if cfg['hacv']['mqtt_motion']:
                self.mqtt_motion = cfg['hacv']['mqtt_motion']
            if cfg['hacv']['mqtt_camera']:
                self.mqtt_camera = cfg['hacv']['mqtt_camera']
        else:
            broker_address = "127.0.0.1"

        try:
            self.client = mqttClient.Client("Python-CV-YOLO3")
            self.client.on_connect = on_connect
            if self.username and self.password:
                self.client.username_pw_set(self.username, self.password)
            self.client.connect(broker_address)
            self.client.loop_start()
        except:
            print("Could not connect to mqtt broker", broker_address)
            self.client = None

    def no_motion(self):
        if self.client == None:
            return
        debug("publishing motion OFF");
        self.client.publish(self.mqtt_motion, '{"on":"OFF"}')

    def publish_detections(self, detections):
        if self.client == None:
            return
        print("Detections", json.dumps({'detections':detections}))
        self.client.publish(self.mqtt_detections, json.dumps({'detections':detections}))


    def publish_detection(self, detection_type, likelihood):
        if self.client == None:
            return
        debug("Publishing ", detection_type, likelihood)
        if detection_type not in self.detects:
            self.detects[detection_type] = 0
        if self.detects[detection_type] + 10.0 < time.time():
            self.detects[detection_type] = time.time()
            debug("publish TTS")
            self.client.publish(self.mqtt_tts, "There is a " + detection_type + " in the " + self.name)
            debug("publish Motion")
            self.client.publish(self.mqtt_motion, '{"on":"ON", "type":"' + detection_type + '"}')
            if self.timer is not None:
                self.timer.cancel()
            debug("Setting up timer for 15 seconds")
            self.timer = threading.Timer(15, self.no_motion)
            self.timer.start()

    def publish_image(self, image):
        if self.client == None:
            return
        debug("Publishing image.")
        self.client.publish(self.mqtt_camera, image)

    def __del__(self):
        if self.client == None:
            return
        self.client.disconnect()
        self.client.loop_stop()


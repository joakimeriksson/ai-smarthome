#!/usr/bin/python3
# -*- coding: utf-8 -*-

# Copyright (c) 2021 Joakim Eriksson
#
# This shows a simple example of automatic registration of MQTT devices in Home Assistant.
# One temperature sensor and one camera (your laptop camera)
#
#

import paho.mqtt.client as mqtt
import json

topicPrefix = "homeassistant"

# Device that connects to the broker and sends / recives messages
class MQTTDevice(mqtt.Client):

    def __init__(self,  name, dev_id, dev_type = "sensor", dev_class = "temperature", mqttBroker="localhost"):
        super().__init__("HA-MQTT-" + dev_id)
        self.broker = mqttBroker
        self.name = name
        self.dev_type = dev_type
        self.dev_class = dev_class
        self.dev_id = dev_id
        self.disco_topic = topicPrefix + "/" + dev_type + "/" + dev_id + "/config"
        self.topic = topicPrefix + "/" + dev_type + "/" + dev_id + "/value"
        self.connect(mqttBroker, 1883, 60)
        self.loop_start()

    def send_data(self, data):
        print("Data on topic:", self.topic)
        self.publish(self.topic, data)

    def send_json(self, data):
        self.publish(self.topic, json.dumps(data))

    def send_disco(self):
        if self.dev_type == "camera":
            # Cameras (no device_class)
            json_conf = {
                "name": self.name,
                "topic": self.topic,
                "device": { "manufacturer": "frontal loop", "identifiers":["23132"] },
                "unique_id" : self.dev_id
            }
        else:
            # Sensors and other devices
            json_conf = {
                "name": self.name,
                "icon": "mdi:thermometer-lines",
                "device_class": self.dev_class,
                "state_topic": self.topic,
                "unique_id": self.dev_id,
                "device" : { "manufacturer": "frontal loop", "identifiers":["12345"] }
            }
        print(self.disco_topic, " => ", json.dumps(json_conf))
        self.publish(self.disco_topic, json.dumps(json_conf))
        
    def on_connect(self, mqttc, obj, flags, rc):
        print("rc: " + str(rc))

    def on_message(self, mqttc, obj, msg):
        print(msg.topic + " " + str(msg.qos) + " " + str(msg.payload))

    def on_publish(self, mqttc, obj, mid):
        print("mid: " + str(mid))
        pass

    def on_subscribe(self, mqttc, obj, mid, granted_qos):
        print("Subscribed: " + str(mid) + " " + str(granted_qos))

    def on_log(mqttc, obj, level, string):
        print(string)

# Test of the mqttdev - (if run as main)
if __name__ == '__main__':
    print("---- registering sensor ----")
    import cv2, random, time, sys

    if len(sys.argv) > 1:
        broker = sys.argv[1]
    else:
        broker = "localhost"

    print("Connecting to broker: ", broker)
    tempDev = MQTTDevice("outdoorTemp", "22342", "sensor", dev_class = "temperature", mqttBroker=broker)
    tempDev.send_disco()
    val = random.random() * 10 + 15
    tempDev.send_data(val)

    camDev = MQTTDevice("TestCam", "1234", "camera", mqttBroker=broker)
    camDev.send_disco()
    cap = cv2.VideoCapture(1)

    for i in range(10):
        time.sleep(1)
        ret, frame = cap.read()
        camDev.send_data(cv2.imencode('.png', frame)[1].tostring())

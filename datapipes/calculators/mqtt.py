# MQTT Calculator for publishing MQTT from inputs
from calculators.core import Calculator
from calculators.image import ImageData
import paho.mqtt.client as mqtt
import json

mqttClient = None

def on_connect(client, userdata, flags, rc):
    print("Connected with result code "+str(rc))

def on_message(client, userdata, msg):
    print(msg.topic+" "+str(msg.payload))

def mqtt_connect_client():
    global mqttClient
    if mqttClient is None or not mqttClient.is_connected():
        mqttClient = mqtt.Client()
        mqttClient.on_connect = on_connect
        mqttClient.on_message = on_message
        mqttClient.connect("localhost", 1883, 60)
        mqttClient.loop_start()

class MQTTPublishCalculator(Calculator):
    def __init__(self, name, s, options):
        super().__init__(name, s, options)
        if 'topic' in options:
            self.topic = options['topic']

    def process(self):
        data = self.get(0)
        if data is not None:
            mqtt_connect_client()
            topic = getattr(self, 'topic', "datapipes/" + self.input[0])
            # This should be protobuf image in the long run
            if isinstance(data, ImageData):
                print("MQTT publish:", topic, " Image!")
                mqttClient.publish(topic, cv2.imencode('.png', data.image)[1].tostring())
            else:
                print("MQTT publish:", topic, json.dumps(data))
                mqttClient.publish(topic, json.dumps(data))

class MQTTPublishYoloClass(MQTTPublishCalculator):
    def process(self):
        data = self.get(0)
        if data is not None:
            mqtt_connect_client()
            if len(self.output) > 0:
                def_topic = self.output[0]
            else:
                def_topic = "say"
            topic = getattr(self, 'topic', def_topic)
            # This should be protobuf image in the long run
            print("MQTT publish:", topic, data)
            mqttClient.publish(topic, data[0][0])

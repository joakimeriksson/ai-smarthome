#
# MQTT Image processing class - JSON data
# Used for analysing and annotating an image with detection boxes.
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import json
import paho.mqtt.client as mqtt
import cv2, sys, numpy as np

import base64

class MQTTImageProcess(mqtt.Client):

    def __init__(self, topic, replyTopic, id = None):
        if (id == None):
            super().__init__()
        else:
            super().__init__(id)
        self.frame = None
        self.imgdata = None
        self.show_frame = False
        self.topic = topic
        self.replyTopic = replyTopic

    def set_frame(self, frame, imgdata, topic):
        self.frame = frame
        self.show_frame = True
        self.imgdata = imgdata
        self.msgtopic = topic

    def on_connect(self, mqttc, obj, flags, rc):
        if rc == 0:
            self.subscribe(self.topic, 0)
            print("Connected to broker:", rc)
        else:
            print("Connection failed: ", rc)

    def on_message(self, mqttc, obj, message):
        print(message.topic + " " + str(message.qos))
        imgdata = json.loads(message.payload)
        b64img = imgdata['image']
        img = base64.b64decode(b64img)
        nparr = np.frombuffer(img, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        self.set_frame(frame, imgdata, message.topic)
        self.process_image()

    def on_publish(self, mqttc, obj, mid):
        print("mid: "+str(mid))

    def on_subscribe(self, mqttc, obj, mid, granted_qos):
        print("Subscribed: " + str(mid) + " " + str(granted_qos) + " " + str(obj))

    def on_log(self, mqttc, obj, level, string):
        print(string)

    # Should add detections also! (JSON for detections)
    def publish_image(self, frame):
        h, w = frame.shape[:2]
        img = cv2.imencode('.png', frame)[1].tostring()
        encoded_img = base64.b64encode(img).decode("utf-8")
        jsimg = { "height": h, "witdth": w, "image": encoded_img}
        print(json.dumps(jsimg))
        self.publish(self.replyTopic, json.dumps(jsimg))

    # show the image.
    def process_image(self):
        # No processing here - just forwarding...
        self.procframe = self.frame
        self.publish_image(self.procframe)

# If you want to use a specific client id, use
# mqttc = MyMQTTClass("client-id")
# but note that the client id must be unique on the broker. Leaving the client
# id parameter empty will generate a random id for you.
# Should take this a configs...

if __name__ == "__main__":
    topic = "ha/camera/mqtt_json"
    replyTopic = "ha/camera/reply/mqtt_json"
    mqttBroker = "localhost"

    # Connect to the broker
    client = MQTTImageProcess(topic, replyTopic)
    client.connect(mqttBroker)
    client.loop_start()

    while(True):
        if client.show_frame:
            cv2.imshow('Cam-frame', client.frame)
            client.show_frame = False
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # When everything done, release the capture
    cv2.destroyAllWindows()
#
# MQTT Image processing class - JSON data
# Used for analysing and annotating an image with detection boxes.
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#
# The MQTT IMG Processing Client is also designed to act as a OpenCV capture source

import json
from threading import Condition
import paho.mqtt.client as mqtt
import cv2, sys, numpy as np
import base64

class MQTTImageProcess(mqtt.Client):

    def __init__(self, topic, id = None, description = None):
        if (id == None):
            super().__init__()
        else:
            super().__init__(id)
        self.frame = None
        self.imgdata = None
        self.topic = topic
        self.imgget = Condition()
        if description is None:
            self.description = {"type": "MQTT image processing"}
        self.description = description
        self.queue =[]

    def set_frame(self, frame, imgdata, topic):
        self.frame = frame
        self.imgdata = imgdata
        self.msgtopic = topic
        self.imgget.acquire()
        self.imgget.notify()
        self.imgget.release()

    def addq(self, json):
        self.queue.append(json)
        self.imgget.acquire()
        self.imgget.notify()
        self.imgget.release()

    def popq(self):
        if (len(self.queue) > 0):
            return self.queue.pop(0)
        self.imgget.acquire()
        self.imgget.wait()
        self.imgget.release()
        return self.queue.pop(0)

    # Subscribe to the in topic
    def on_connect(self, mqttc, obj, flags, rc):
        if rc == 0:
            self.subscribe(self.topic + "/in/#", 0)
            self.publish(self.topic+ "/info", json.dumps(self.description), retain=True)
            print("Connected to broker:", rc)
        else:
            print("Connection failed: ", rc)

    # TODO: we should make a queue of the image data to process
    def on_message(self, mqttc, obj, message):
        print(message.topic + " " + str(message.qos))
        self.addq({'msg':json.loads(message.payload), 'topic':message.topic})

    def on_publish(self, mqttc, obj, mid):
        print("mid: "+str(mid))

    def on_subscribe(self, mqttc, obj, mid, granted_qos):
        print("Subscribed: " + str(mid) + " " + str(granted_qos) + " " + str(obj))

    def on_log(self, mqttc, obj, level, string):
        print(string)

    # Should add detections also! (JSON for detections)
    def publish_image(self, frame, topic, detections = {}):
        h, w = frame.shape[:2]
        img = cv2.imencode('.png', frame)[1].tostring()
        encoded_img = base64.b64encode(img).decode("utf-8")
        jsimg = { "height": h, "witdth": w, "image": encoded_img, "detections": detections}
        # print(json.dumps(jsimg))
        # Receive topic is turned into a publish topic
        outtopic = topic.replace("/in", "/out")
        print("Publishing under topic: ", outtopic)
        self.publish(outtopic, json.dumps(jsimg))

    def read(self):
        data = self.popq()
        imgdata = data['msg']
        b64img = imgdata['image']
        img = base64.b64decode(b64img)
        nparr = np.frombuffer(img, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        self.set_frame(frame, imgdata, data['topic'])
        return True, self.frame

# If you want to use a specific client id, use
# mqttc = MyMQTTClass("client-id")
# but note that the client id must be unique on the broker. Leaving the client
# id parameter empty will generate a random id for you.
# Should take this a configs...

if __name__ == "__main__":
    topic = "ha/camera/mqtt_json"
    mqttBroker = "localhost"

    # Connect to the broker
    client = MQTTImageProcess(topic)
    client.connect(mqttBroker)
    client.loop_start()

    i = 0
    while(True):
        ret, frame = client.read()
        print("Qlen:" + str(len(client.queue)), client.msgtopic)
        cv2.imshow('Cam-frame', frame)
        i = i + 1
        if i % 10 == 9:
            client.publish_image(frame, client.msgtopic, [])
        if cv2.waitKey(5) & 0xFF == ord('q'):
            break

    # When everything done, release the capture
    cv2.destroyAllWindows()

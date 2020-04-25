#
# MQTT Image processing class
# Used for analysing and annotating an image with detection boxes.
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqtt
import cv2, sys, numpy as np
from PIL import Image
import base64, json
import pose_test

class MQTTImageProcess(mqtt.Client):
    FRAME_RAW = 1
    FRAME_PB = 2
    FRAME_B64 = 3

    def __init__(self, topic, id = None):
        if (id == None):
            super().__init__()
        else:
            super().__init__(id)
        self.frame = None
        self.show_frame = False
        self.topic = topic

    def set_frame(self, frame, type, topic):
        self.frame = frame
        self.type = type
        self.show_frame = True
        self.msgtopic = topic

    def on_connect(self, mqttc, obj, flags, rc):
        if rc == 0:
            print("Connected to broker:", rc)
        else:
            print("Connection failed: ", rc)

    def on_message(self, mqttc, obj, message):
        print(message.topic + " " + str(message.qos))
        if message.topic.endswith("img"):
            nparr = np.frombuffer(message.payload, np.uint8)
            self.set_frame(cv2.imdecode(nparr, cv2.IMREAD_COLOR),MQTTImageProcess.FRAME_RAW, message.topic)
        elif message.topic.endswith("img_pb"):
            frame_pb = images_pb2.Image()
            frame_pb.ParseFromString(message.payload)
            print("PB img: width:",frame_pb.width, "height:", frame_pb.height)
            nparr = np.frombuffer(frame_pb.imgdata, np.uint8)
            self.set_frame(cv2.imdecode(nparr, cv2.IMREAD_COLOR), MQTTImageProcess.FRAME_PB, message.topic)
        elif message.topic.endswith("imgb64"):
            start = message.payload[0:23]
            print("payload:" + str(start))
            if start == b'data:image/jpeg;base64,':
                print("Equal")
                imgdata = base64.b64decode(message.payload[23:])
                nparr = np.frombuffer(imgdata, np.uint8)
                self.set_frame(cv2.imdecode(nparr, cv2.IMREAD_COLOR), MQTTImageProcess.FRAME_B64, message.topic)
        else:
            print("Message not handled.")


    def on_publish(self, mqttc, obj, mid):
        print("mid: "+str(mid))

    def on_subscribe(self, mqttc, obj, mid, granted_qos):
        print("Subscribed: " + str(mid) + " " + str(granted_qos) + " " + str(obj))

    def on_log(self, mqttc, obj, level, string):
        print(string)

def keyp2json(keyp):
    return {'keypoint':keyp.k, 'score':float(keyp.score), 'pos':[float(keyp.yx[0]), float(keyp.yx[1])]}

def keyps2json(keypoints):
    json_ks = []
    for keyp in keypoints:
        keyo = keypoints[keyp]
        json_ks = json_ks + [keyp2json(keyo)]
    return json_ks

def pose2json(pose):
    json_p = {'keypoints':keyps2json(pose.keypoints), 'score':float(pose.score)}
    return json_p
        
def poses2json(poses):
    json_p = []
    for pose in poses:
        json_p = json_p + [pose2json(pose)]
    return json_p
    
# If you want to use a specific client id, use
# mqttc = MyMQTTClass("client-id")
# but note that the client id must be unique on the broker. Leaving the client
# id parameter empty will generate a random id for you.
# Should take this a configs...
topic = "kth/dm2518/pose"
replyTopic = "ha/camera/reply/mqtt"
mqttBroker = "mqtt.eclipse.org"

# Connect to the broker
client = MQTTImageProcess(topic, id="pose-img")
client.connect(mqttBroker)
client.subscribe(topic + "/#", 0)
client.loop_start()


while(True):
    if client.show_frame:
        nf = client.frame.copy()
        # You may need to convert the color.
        img = cv2.cvtColor(nf, cv2.COLOR_BGR2RGB)
        im_pil = Image.fromarray(img)
        d = pose_test.process_poses(im_pil)
        nf = np.asarray(im_pil)
        # convert to a openCV2 image, notice the COLOR_RGB2BGR which means that 
        # the color is converted from RGB to BGR format
        nf = cv2.cvtColor(nf, cv2.COLOR_RGB2BGR) 
        print("Should show frame and reply.")
        if d != []:
            if (client.type == client.FRAME_RAW):
                print("Nothing for raw")
            elif (client.type == client.FRAME_B64):
                img =  b'data:image/jpeg;base64,' + base64.encodebytes(cv2.imencode('.jpeg',  nf)[1].tostring())
                print("IMG:" + img.decode('ascii'))
                # Add reply in topic
                replyTopic = client.msgtopic.replace("dm2518/", "dm2518/reply/")
                client.publish(replyTopic, img.decode('ascii'))
                client.publish(replyTopic.replace("imgb64", "json"), json.dumps(poses2json(d)))
            else:
                print("unhandled image type")
        client.show_frame = False

#
# MQTT Image processing class
# Used for analysing and annotating an image with detection boxes.
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqtt
import cv2, sys, numpy as np
import images_pb2

# Hack to allow import of the yolov3 detector
# should be in a package later...
sys.path.append('../yolov3-ha')
import yolo3
import base64

def create_image_pb(frame, id):
    img = images_pb2.Image()
    h, w = frame.shape[:2]
    img.width = w
    img.height = h
    img.id = id
    img.imgdata = cv2.imencode('.png', frame)[1].tostring()
    return img

def create_detections_pb(detections, image_pb):
    if detections == []:
        return None
    det_pb = images_pb2.ImageObjectDetections()
    det_pb.image.CopyFrom(image_pb)
    det_pb.algorithm_name = "Yolo V3 / COCO"
    for detection in detections:
        tmpdet = det_pb.detections.add()
        tmpdet.class_name = detection[0]
        tmpdet.score = detection[1]
        tmpdet.left = detection[2][0]
        tmpdet.top = detection[2][1]
        tmpdet.right = detection[2][2]
        tmpdet.bottom = detection[2][3]
    return det_pb;

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

# If you want to use a specific client id, use
# mqttc = MyMQTTClass("client-id")
# but note that the client id must be unique on the broker. Leaving the client
# id parameter empty will generate a random id for you.
# Should take this a configs...

if __name__ == "__main__":
    topic = "ha/camera/mqtt"
    replyTopic = "ha/camera/reply/mqtt"
    mqttBroker = "mqtt.eclipse.org"

    # Connect to the broker
    client = MQTTImageProcess()
    client.connect(mqttBroker)
    client.subscribe(topic, 0)
    client.subscribe(topic + "_pb", 0)
    client.subscribe(topic + "_b64", 0)
    client.loop_start()

    yolo = yolo3.YoloV3(0.5, 0.4, datapath="../yolov3-ha")

    while(True):
        if client.show_frame:
            nf = client.frame.copy()
            d = yolo.detect(nf)
            print("Should show frame and reply.")
            if d != []:
                if (client.type == client.FRAME_PB):
                    # Create a detections protocol buffer
                    img = create_image_pb(nf, "the-id")
                    det_pb = create_detections_pb(d, img)
                    client.publish("ha/analysis/mqtt_pb", det_pb)
                elif (client.type == client.FRAME_RAW):
                    print("Nothing for raw")
                elif (client.type == client.FRAME_B64):
                    img =  b'data:image/jpeg;base64,' + base64.encodebytes(cv2.imencode('.jpeg',  nf)[1].tostring())
                    print("IMG:" + img.decode('ascii'))
                    client.publish(replyTopic + "_b64", img.decode('ascii'))
                else:
                    print("unhandled image type")
            cv2.imshow('Det-frame', nf)
            client.show_frame = False
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # When everything done, release the capture
    cv2.destroyAllWindows()
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

    def __init__(self, id):
        super().__init__(id)
        self.frame = None
        self.show_frame = False

    def on_connect(self, mqttc, obj, flags, rc):
        if rc == 0:
            print("Connected to broker:", rc)
        else:
            print("Connection failed: ", rc)

    def on_message(self, mqttc, obj, message):
        print(message.topic + " " + str(message.qos))
        if message.topic == "ha/camera/mqtt":
            print("Matched!!!")
            nparr = np.frombuffer(message.payload, np.uint8)
            self.frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            self.show_frame = True
        elif message.topic == "ha/camera/mqtt_pb":
            frame_pb = images_pb2.Image()
            frame_pb.ParseFromString(message.payload)
            print("PB img: width:",frame_pb.width, "height:", frame_pb.height)
            nparr = np.frombuffer(frame_pb.imgdata, np.uint8)
            self.frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            self.show_frame = True

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
client = MQTTImageProcess("test-id")
client.connect("localhost")
# Should take this a configs...
client.subscribe("ha/camera/mqtt", 0)
client.subscribe("ha/camera/mqtt_pb", 0)
client.loop_start()

yolo = yolo3.YoloV3(0.5, 0.4, datapath="../yolov3-ha")

while(True):
    # Capture frame-by-frame
    if client.show_frame:
#        cv2.imshow('Cam-frame', frame)
        nf = client.frame.copy()
        d = yolo.detect(nf)
        if d != []:
            # Create a detections protocol buffer        
            img = create_image_pb(nf, "the-id")
            det_pb = create_detections_pb(d, img)
        cv2.imshow('Det-frame', nf)
        client.show_frame = False
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cv2.destroyAllWindows()
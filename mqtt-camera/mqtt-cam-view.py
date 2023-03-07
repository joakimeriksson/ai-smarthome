#
# This is a basic example of a MQTT camera viewer - it will show both plain
# images encoded in binary format (png, etc) in the payload or make use of
# a protocol buffer encoded image that also include width, height + id.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import threading, time, yaml
import numpy as np, sys, time
import cv2
import images_pb2

# Hack to allow import of the yolov3 detector
# should be in a package later...
sys.path.append('../yolov3-ha')
import yolo3

show = True
client = None
frame = None
showFrame = False


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to broker:", rc)
    else:
        print("Connection failed: ", rc)

def on_message(client, userdata, message):
    global frame
    global showFrame
    print("Received message on topic '"
          + message.topic + "' with QoS " + str(message.qos))
    if message.topic == "ha/camera/mqtt":
        print("Matched!!!")
        nparr = np.frombuffer(message.payload, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        showFrame = True
    elif message.topic == "ha/camera/mqtt_pb":
        frame_pb = images_pb2.Image()
        frame_pb.ParseFromString(message.payload)
        print("PB img: width:",frame_pb.width, "height:", frame_pb.height)
        nparr = np.frombuffer(frame_pb.imgdata, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        showFrame = True


client = mqttClient.Client("Python-MQTT-CAM")
client.on_connect = on_connect
client.connect("localhost")
client.on_message = on_message
# Should take this a configs...
client.subscribe("ha/camera/mqtt", 0)
client.subscribe("ha/camera/mqtt_pb", 0)
client.loop_start()

yolo = yolo3.YoloV3(0.5, 0.4, datapath="../yolov3-ha")

while(True):
    # Capture frame-by-frame
    if showFrame:
        cv2.imshow('Cam-frame', frame)
#        nf = frame.copy()
#        d = yolo.detect(nf)
#        cv2.imshow('Det-frame', nf)
        showFrame = False
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break


# When everything done, release the capture
cv2.destroyAllWindows()

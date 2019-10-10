#
# This integration is towards MQTT in Home-Assistant and can easily
# be configured to provide both images streamed unfiltered or diff-filtered.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import threading, time, yaml
import numpy as np, sys, time
import cv2

show = True
client = None

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to broker:", rc)
    else:
        print("Connection failed: ", rc)


def diff_filter(frame, avgframe):
    subframe = cv2.subtract(frame, avgframe)
    grayscaled = cv2.cvtColor(subframe, cv2.COLOR_BGR2GRAY)
    retval2,th1 = cv2.threshold(grayscaled,35,255,cv2.THRESH_BINARY)
    avgframe = cv2.addWeighted(frame, 0.1, avgframe, 0.9, 0.0)

    if show:
        cv2.imshow('Treshold diff', th1)

    th1 = th1 / 255
    w, h = th1.shape
    sum = cv2.sumElems(th1)[0]/(w*h)
    print("SUM:", cv2.sumElems(th1)[0]/(w*h), w, h)
    return avgframe, sum

def publish_image(frame):
    if client == None:
        return
    print("Publishing image.")
    client.publish("ha/camera/mqtt", frame)


video = 0
if len(sys.argv) > 1:
    video = sys.argv[1]
cap = cv2.VideoCapture(video)

client = mqttClient.Client("Python-CV-YOLO3")
client.on_connect = on_connect
client.connect("localhost")
client.loop_start()

fc = 0
# First frame is average...
ret, avgframe = cap.read()
while(True):
    # Capture frame-by-frame
    ret, frame = cap.read()

    avgframe, sum = diff_filter(frame, avgframe)
    if sum > 0.01:
        publish_image(cv2.imencode('.png', frame)[1].tostring())

    # Our operations on the frame come here
    #frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    # Display the resulting frame
    fc = fc + 1

    if fc % 1 == 0:
        cv2.imshow('frame',frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()


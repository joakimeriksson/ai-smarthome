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
    nparr = np.frombuffer(message.payload, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    showFrame = True

client = mqttClient.Client("Python-MQTT-CAM")
client.on_connect = on_connect
client.connect("localhost")
client.on_message = on_message
client.subscribe("ha/camera/mqtt", 0)
client.loop_start()


while(True):
    # Capture frame-by-frame
    if showFrame:
        cv2.imshow('Cam-frame',frame)
        showFrame = False
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cv2.destroyAllWindows()

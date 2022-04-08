#
# This is a basic example of a MQTT camera viewer - it will show both plain
# images encoded in binary format (png, etc) in the payload or make use of
# a protocol buffer encoded image that also include width, height + id.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import numpy as np, sys, json, base64
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
    if message.topic == "ha/camera/mqtt_json":
        print("Matched!!!")
        imgdata = json.loads(message.payload)
        b64img = imgdata['image']
        img = base64.b64decode(b64img)
        nparr = np.frombuffer(img, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        showFrame = True


client = mqttClient.Client("Python-MQTT-CAM")
client.on_connect = on_connect
client.connect("localhost")
client.on_message = on_message
# Should take this a configs...
client.subscribe("ha/camera/mqtt_json", 0)
client.loop_start()

while(True):
    # Capture frame-by-frame
    if showFrame:
        cv2.imshow('Cam-frame', frame)
        showFrame = False
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cv2.destroyAllWindows()

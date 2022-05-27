#
# This is a basic example of a MQTT camera viewer taking as input a JSON format with a base64 encoded image.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import numpy as np, sys, json, base64
import cv2, argparse, random

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
    imgdata = json.loads(message.payload)
    b64img = imgdata['image']
    img = base64.b64decode(b64img)
    nparr = np.frombuffer(img, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    showFrame = True

# parse the command line
parser = argparse.ArgumentParser(description="View images received over MQTT.", 
                                 formatter_class=argparse.RawTextHelpFormatter, epilog="MQTT Camera Viewer")

parser.add_argument("--topic", type=str, default="ha/camera/mqtt_json", help="MQTT topic to subscribe to")
parser.add_argument("--broker", type=str, default="localhost", help="MQTT broker to connect to")
try:
	opt = parser.parse_known_args()[0]
except:
	print("")
	parser.print_help()
	sys.exit(0)

client = mqttClient.Client("CAMViewer-" + str(hex(random.randint(0,16777215)))[2:])
client.on_connect = on_connect
client.connect(opt.broker)
client.on_message = on_message
# Should take this a configs...
print("Client", client._client_id, "Subscribing to topic:", opt.topic)
client.subscribe(opt.topic, 0)
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

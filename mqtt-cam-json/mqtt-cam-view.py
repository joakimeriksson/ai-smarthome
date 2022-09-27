#
# This is a basic example of a MQTT camera viewer taking as input a JSON format with a base64 encoded image.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import numpy as np, sys, json, base64
import cv2, argparse, random, time

show = True
client = None
frame = None
detections = {}
showFrame = False

keypoints = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle" ]

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to broker:", rc)
    else:
        print("Connection failed: ", rc)

def on_message(client, userdata, message):
    global frame
    global showFrame, detections
    print("Received message on topic '"
          + message.topic + "' with QoS " + str(message.qos))
    imgdata = json.loads(message.payload)
    b64img = imgdata['image']
    img = base64.b64decode(b64img)
    nparr = np.frombuffer(img, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if 'detections' in imgdata:
        print("detections:" + str(imgdata['detections']))
        detections = imgdata['detections']
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
        if detections != {}:
            start_time = time.process_time()
            start_wt = time.time()
            if detections['type'] == 'body-pose':
                for pose in detections['poses']:
                    kps = pose['keypoints']
                    for link in pose['links']:
                        from_p = kps[link[0]]
                        to_p = kps[link[1]]                    
                        print(link)
                        cv2.line(frame, (from_p['x'], from_p['y']), (to_p['x'], to_p['y']), (0,255,0), 3)
                    for kp in pose['keypoints']:
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        cv2.circle(frame, (kp['x'], kp['y']), 5, (100, 255, 100), -1)
                        cv2.putText(frame, str(kp['ID']), (kp['x'] - 20, kp['y']), font, 1, (100, 255, 100), 2, cv2.LINE_AA)
                        if kp['ID'] < len(keypoints):
                            cv2.putText(frame, keypoints[kp['ID']], (kp['x'] - 0, kp['y']), font, 1, (255, 100, 100), 2, cv2.LINE_AA)
                    print("Drawing skeleton took: ", time.process_time() - start_time, time.time() - start_wt)
            if detections['type'] == 'object-detection':
                for detection in detections['detections']:
                    bbox = detection['bbox']
                    cv2.rectangle(frame, (int(bbox[0]), int(bbox[1])),
                                  (int(bbox[0] + bbox[2]), int(bbox[1] + bbox[3])),
                                  (0, 255, 0), 2)
        cv2.imshow('Cam-frame', frame)
        cv2.imwrite('image-' + str(int(time.time())) + '.jpg', frame)
        showFrame = False
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cv2.destroyAllWindows()

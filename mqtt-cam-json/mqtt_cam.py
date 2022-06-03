#
# This is a basic MQTT Camera that sends out a web-camera or similar to a MQTT topic.
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import sys, base64, random, time
import cv2, json, argparse

connected = False
# Can this be put within the class?
def on_connect(client, userdata, flags, rc):
    global connected
    if rc == 0:
        print("Connected to broker:", rc)
        connected = True
    else:
        print("Connection failed: ", rc)

class MQTTCamera:

    def __init__(self, mqttBroker, camera, topic="ha/camera/mqtt_json", interval=0):
        self.broker = mqttBroker
        self.camera = camera
        self.topic = topic
        self.cap = cv2.VideoCapture(camera)
        self.interval = interval
        # First frame is average...
        ret, self.avgframe = self.cap.read()
        self.client = mqttClient.Client("CameraJSON-" + str(hex(random.randint(0,16777215)))[2:])
        self.client.on_connect = on_connect
        self.connected = False
        self.client.connect(mqttBroker)
        self.client.loop_start()

    def diff_filter(self, frame, avgframe):
        subframe = cv2.subtract(frame, avgframe)
        grayscaled = cv2.cvtColor(subframe, cv2.COLOR_BGR2GRAY)
        retval2,th1 = cv2.threshold(grayscaled,35,255,cv2.THRESH_BINARY)
        avgframe = cv2.addWeighted(frame, 0.1, avgframe, 0.9, 0.0)

        th1 = th1 / 255
        w, h = th1.shape
        sum = cv2.sumElems(th1)[0]/(w*h)
        return avgframe, sum

    def publish_image(self, frame):
        global connected
        if self.client == None:
            return
        if not connected:
            print("Not yet connected", connected)
            return
        h, w = frame.shape[:2]
        img = cv2.imencode('.png', frame)[1].tostring()
        encoded_img = base64.b64encode(img).decode("utf-8")
        jsimg = { "height": h, "witdth": w, "image": encoded_img}
        # print(json.dumps(jsimg))
        print("Publishing image:", self.topic)
        self.client.publish(self.topic, json.dumps(jsimg))
        

    def camera_loop(self):
        fc = 0
        last_publish = time.time()
        while(True):
            # Capture frame-by-frame
            ret, frame = self.cap.read()
            self.avgframe, sum = self.diff_filter(frame, self.avgframe)
            if sum > 0.01 or self.interval > 0 and time.time() - last_publish > self.interval:
                print("Publishing image diff:", sum)
                self.publish_image(frame)
                last_publish = time.time()
        self.cap.release()

if __name__ == "__main__":
    # parse the command line
    parser = argparse.ArgumentParser(description="Send video/image stream over MQTT from camera (index).", 
                                    formatter_class=argparse.RawTextHelpFormatter, epilog="MQTT Camera")

    parser.add_argument("--camera", type=int, default=0, help="index of the camera to use (default: 0)")
    parser.add_argument("--topic", type=str, default="ha/camera/mqtt_json", help="MQTT topic to publish to")
    parser.add_argument("--broker", type=str, default="localhost", help="MQTT broker to connect to")
    parser.add_argument("--interval", type=int, default=0, help="interval in seconds between frames")
    try:
        opt = parser.parse_known_args()[0]
    except:
        print("")
        parser.print_help()
        sys.exit(0)

    # TODO: add support for a Camera URL also (so that we can use a RTSP camera)
    mqCam = MQTTCamera(opt.broker, opt.camera, topic=opt.topic, interval=opt.interval)
    mqCam.show = False
    mqCam.camera_loop()

    # When everything done, release the capture
    cv2.destroyAllWindows()

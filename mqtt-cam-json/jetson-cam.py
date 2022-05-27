import cv2, argparse, random
import paho.mqtt.client as mqttClient
import mqtt_cam
import jetson.utils

class CapVid:
    def __init__(self, cam):
        self.cam = cam
    def read(self):
        img = self.cam.Capture()
        print(img)
        np = jetson.utils.cudaToNumpy(img)
        return True, np

class JetsonMQTTCamera(mqtt_cam.MQTTCamera):

    def __init__(self, mqttBroker, topic="ha/camera/mqtt", interval=0):
        self.show = True
        self.broker = mqttBroker
        self.topic = topic
        self.interval = interval
        self.send_frames = 0
        self.cap = CapVid(jetson.utils.videoSource('csi://0'))
        # First frame is average...
        ret, self.avgframe = self.cap.read()
        self.client = mqttClient.Client("CameraJSON-" + str(hex(random.randint(0,16777215)))[2:])
        self.client.connect(mqttBroker)
        self.client.loop_start()

if __name__ == '__main__':
# parse the command line
    parser = argparse.ArgumentParser(description="Send video/image stream over MQTT from Jetson camera.", 
                                    formatter_class=argparse.RawTextHelpFormatter, epilog="MQTT Camera")
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
    mqCam = JetsonMQTTCamera(opt.broker, topic=opt.topic, interval=opt.interval)
    mqCam.show = False
    mqCam.camera_loop()

    # When everything done, release the capture
    cv2.destroyAllWindows()
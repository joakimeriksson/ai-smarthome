
import cv2, sys, numpy as np
sys.path.append('../yolov3-ha')
import yolo3
import base64, json
import mqttimgproc

# If you want to use a specific client id, use
# mqttc = MyMQTTClass("client-id")
# but note that the client id must be unique on the broker. Leaving the client
# id parameter empty will generate a random id for you.
# Should take this a configs...
topic = "kth/dm2518/yolo3"
replyTopic = "kth/dm2518/reply/yolo3"
mqttBroker = "mqtt.eclipse.org"

# Connect to the broker
client = mqttimgproc.MQTTImageProcess(topic, id = "yolov3-img")
client.connect(mqttBroker)
client.subscribe(topic + "/#", 0)
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
                print("Topic:" + topic)
                # Add reply in topic
                replyTopic = client.msgtopic.replace("dm2518/", "dm2518/reply/")
                client.publish(replyTopic, img.decode('ascii'))
                client.publish(replyTopic.replace("imgb64", "json"), json.dumps(d))
                print(d)
            else:
                print("unhandled image type")
        client.show_frame = False
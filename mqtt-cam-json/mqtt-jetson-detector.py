#!/usr/bin/python3
#
# Copyright (c) 2021, NVIDIA CORPORATION. All rights reserved.
#
# Permission is hereby granted, free of charge, to any person obtaining a
# copy of this software and associated documentation files (the "Software"),
# to deal in the Software without restriction, including without limitation
# the rights to use, copy, modify, merge, publish, distribute, sublicense,
# and/or sell copies of the Software, and to permit persons to whom the
# Software is furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
# THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
# FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
# DEALINGS IN THE SOFTWARE.
#

import jetson.inference
import jetson.utils

import argparse
import sys
import json
import mqtt_imgproc

class MQTTJetsonDetector(mqtt_imgproc.MQTTImageProcess):
    # show the image.
    def process_image(self):
        # No processing here - just forwarding...
        print("Should process the image...")
        #self.procframe = self.frame
        #self.publish_image(self.procframe)


# parse the command line
parser = argparse.ArgumentParser(description="Run object detector DNN on a video/image stream over MQTT.", 
                                 formatter_class=argparse.RawTextHelpFormatter, epilog=jetson.inference.poseNet.Usage() +
                                 jetson.utils.videoSource.Usage() + jetson.utils.videoOutput.Usage() + jetson.utils.logUsage())

parser.add_argument("--network", type=str, default="resnet18-body", help="pre-trained model to load (see below for options)")
parser.add_argument("--overlay", type=str, default="box,labels,conf", help="detection overlay flags (e.g. --overlay=box,labels,conf)\nvalid combinations are:  'box', 'labels', 'conf', 'none'")
parser.add_argument("--threshold", type=float, default=0.50, help="minimum detection threshold to use")
parser.add_argument("--topic", type=str, default="ha/camera/mqtt_json", help="MQTT topic to subscribe to")
parser.add_argument("--broker", type=str, default="localhost", help="MQTT broker to connect to")
try:
	opt = parser.parse_known_args()[0]
except:
	print("")
	parser.print_help()
	sys.exit(0)

# load the object detection network
net = jetson.inference.detectNet(opt.network, sys.argv, opt.threshold)

# default reply topic
replyTopic = opt.topic + "/reply"

# Connect to the broker
client = MQTTJetsonDetector(opt.topic, replyTopic)
client.connect(opt.broker)
client.loop_start()

# process frames until the user exits
while True:
    # capture the next image
    ret, frame = client.read()

    img = jetson.utils.cudaFromNumpy(frame)

    # detect objects in the image (with overlay)
    detections = net.Detect(img, overlay=opt.overlay)

    # print the pose results
    print("detected {:d} objects in image".format(len(detections)))

    ddet = []
    for detection in detections:
        print(detection)
        print(detection.ClassID)
        ddet = ddet + [{'category_id':detection.ClassID, 'score':detection.Confidence, 'bbox':[detection.Left, detection.Top, detection.Width, detection.Height]}]

    detection = {'type': "object-detection", 'detections': ddet}
    jsonDet = json.dumps(detection)
    print(jsonDet)

    
    npframe = jetson.utils.cudaToNumpy(img)
    # publish the image
    client.publish_image(npframe, client.msgtopic, detection)

    # print out performance info
    net.PrintProfilerTimes()

#
# MQTT Camera image processing using Yolo
#
# Takes an image on ha/camera/mqtt
# Posts back an image on ha/camera/yolo
#
# Author: Joakim Eriksson, joakim.eriksson@ri.se
#

import paho.mqtt.client as mqttClient
import cv2, numpy as np, datetime
from PIL import Image, ImageFont, ImageDraw
import colorsys

show = True
client = None
frame = None
processFrame = False

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("Connected to broker:", rc)
    else:
        print("Connection failed: ", rc)

def on_message(client, userdata, message):
    global frame
    global processFrame
    print("Received message on topic '"
          + message.topic + "' with QoS " + str(message.qos))
    nparr = np.frombuffer(message.payload, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    processFrame = True

def publish_image(frame):
    global client
    if client == None:
        return
    print("Publishing image.")
    client.publish("ha/camera/yolo", frame)

def publish_detection(name, score):
    global client
    client.publish("ha/detection/yolo", "There is a " + name + " with likelihood" + str(score))

# Initialize the parameters
confThreshold = 0.5  #Confidence threshold
nmsThreshold = 0.4   #Non-maximum suppression threshold
inpWidth = 416       #Width of network's input image
inpHeight = 416      #Height of network's input image

# Give the configuration and weight files for the model and load the network using them.
modelConfiguration = "cfg/yolov3.cfg";
modelWeights = "yolov3.weights";
classesFile = "data/coco.names";
classes = None

# Get the names of the output layers
def getOutputsNames(net):
    # Get the names of all the layers in the network
    layersNames = net.getLayerNames()
    # Get the names of the output layers, i.e. the layers with unconnected outputs
    return [layersNames[i[0] - 1] for i in net.getUnconnectedOutLayers()]

# Remove the bounding boxes with low confidence using non-maxima suppression
def postprocess(frame, outs, color):
    frameHeight = frame.shape[0]
    frameWidth = frame.shape[1]
    # Scan through all the bounding boxes output from the network and keep only the
    # ones with high confidence scores. Assign the box's class label as the class with the highest score.
    classIds = []
    confidences = []
    boxes = []
    for out in outs:
        for detection in out:
            scores = detection[5:]
            classId = np.argmax(scores)
            confidence = scores[classId]
            if confidence > confThreshold:
                center_x = int(detection[0] * frameWidth)
                center_y = int(detection[1] * frameHeight)
                width = int(detection[2] * frameWidth)
                height = int(detection[3] * frameHeight)
                left = int(center_x - width / 2)
                top = int(center_y - height / 2)
                classIds.append(classId)
                confidences.append(float(confidence))
                boxes.append([left, top, width, height])

    # Perform non maximum suppression to eliminate redundant overlapping boxes with
    # lower confidences.
    indices = cv2.dnn.NMSBoxes(boxes, confidences, confThreshold, nmsThreshold)
    retval = []
    for i in indices:
        i = i[0]
        box = boxes[i]
        left = box[0]
        top = box[1]
        width = box[2]
        height = box[3]
        retval = retval + [(classes[classIds[i]], confidences[i])]
        print(classes[classIds[i]], confidences[i], left, top, width, height)
        drawPred(classIds[i], confidences[i], left, top, left + width, top + height, color)
    return retval
# Draw the predicted bounding box
def drawPred(classId, conf, left, top, right, bottom, color):
    # Draw a bounding box.
    cv2.rectangle(frame, (left, top), (right, bottom), color[classId], 3)
    label = '%.2f' % conf
    # Get the label for the class name and its confidence
    if classes:
        assert(classId < len(classes))
        label = '%s:%s' % (classes[classId], label)
    #Display the label at the top of the bounding box
    labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1, 1)
    top = max(top, labelSize[1])
    cv2.rectangle(frame, (left, top + 3), (left + labelSize[0], top - labelSize[1] - 6), color[classId], -1)
    cv2.putText(frame, label, (left, top), cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)

net = cv2.dnn.readNetFromDarknet(modelConfiguration, modelWeights)
net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

with open(classesFile, 'rt') as f:
    classes = f.read().rstrip('\n').split('\n')

# Generate colors for drawing bounding boxes.
hsv_tuples = [(x / len(classes), 1., 1.)
              for x in range(len(classes))]
colors = list(map(lambda x: colorsys.hsv_to_rgb(*x), hsv_tuples))
colors = list(map(lambda x: (int(x[0] * 255), int(x[1] * 255), int(x[2] * 255)),
                  colors))
np.random.seed(10101)  # Fixed seed for consistent colors across runs.
np.random.shuffle(colors)  # Shuffle colors to decorrelate adjacent classes.
np.random.seed(None)  # Reset seed to default.

client = mqttClient.Client("Python-MQTT-CAM")
client.on_connect = on_connect
client.connect("localhost")
client.on_message = on_message
client.subscribe("ha/camera/mqtt", 0)
client.loop_start()


while(1):
    if processFrame:
        processFrame = False
        fconv = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(fconv)
        # Create a 4D blob from a frame.
        blob = cv2.dnn.blobFromImage(frame, 1/255, (inpWidth, inpHeight), [0,0,0], 1, crop=False)
        # Sets the input to the network
        net.setInput(blob)
        # Runs the forward pass to get output of the output layers
        outs = net.forward(getOutputsNames(net))
        # Remove the bounding boxes with low confidence
        detection = postprocess(frame, outs, colors)
        # Put efficiency information. The function getPerfProfile returns the
        # overall time for inference(t) and the timings for each of the layers(in layersTimes)
        t, _ = net.getPerfProfile()
        label = 'Inference time: %.2f ms' % (t * 1000.0 / cv2.getTickFrequency())
        cv2.putText(frame, label, (0, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255))
        # Write the frame with the detection boxes
        if len(detection) > 0:
            max_score = detection[0][1]
            detect_name = detection[0][0]
        else:
            max_score = 0
        # only publish if score is higher than zero
        if max_score > 0:
            print("*** Detected ", detect_name)
            publish_detection(detect_name, max_score)
            publish_image(cv2.imencode('.png', frame)[1].tostring())
        # show the image and save detection disk
        if show:
            cv2.imshow("YOLOv3", frame)
    cv2.waitKey(1)

import cv2, numpy as np, datetime
from PIL import Image, ImageFont, ImageDraw
import sys, importlib, getopt
import os.path
import colorsys

# Give the configuration and weight files for the model and load the network using them.


modelConfiguration = "cfg/yolov3.cfg";
modelWeights = "yolov3.weights";
classesFile = "data/coco.names";

#modelConfiguration = "cfg/yolov4.cfg";
#modelWeights = "yolov4.weights";
#classesFile = "data/coco.names";


class YoloV3:

    inpWidth = 416       #Width of network's input image
    inpHeight = 416      #Height of network's input image
    drawPerformance = True
    
    def __init__(self, confThreshold, nmsThreshold, datapath="."):
        self.confThreshold = confThreshold
        self.nmsThreshold = nmsThreshold
        self.classes = None
        self.net = cv2.dnn.readNetFromDarknet(datapath + "/" + modelConfiguration, datapath + "/" + modelWeights)
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        with open(datapath + "/" + classesFile, 'rt') as f:
            self.classes = f.read().rstrip('\n').split('\n')
        # Generate colors for drawing bounding boxes.
        hsv_tuples = [(x / len(self.classes), 1., 1.)
                    for x in range(len(self.classes))]
        self.colors = list(map(lambda x: colorsys.hsv_to_rgb(*x), hsv_tuples))
        self.colors = list(map(lambda x: (int(x[0] * 255), int(x[1] * 255), int(x[2] * 255)),
                        self.colors))
        np.random.seed(10101)  # Fixed seed for consistent colors across runs.
        np.random.shuffle(self.colors)  # Shuffle colors to decorrelate adjacent classes.
        np.random.seed(None)  # Reset seed to default.

    # Get the names of the output layers
    def getOutputsNames(self):
        # Get the names of all the layers in the network
        layersNames = self.net.getLayerNames()
        # Get the names of the output layers, i.e. the layers with unconnected outputs
        return [layersNames[i[0] - 1] for i in self.net.getUnconnectedOutLayers()]

    # Remove the bounding boxes with low confidence using non-maxima suppression
    def postprocess(self, frame, outs, color):
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
                if confidence > self.confThreshold:
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
        indices = cv2.dnn.NMSBoxes(boxes, confidences, self.confThreshold, self.nmsThreshold)
        retval = []
        for i in indices:
            i = i[0]
            box = boxes[i]
            left = box[0]
            top = box[1]
            width = box[2]
            height = box[3]
            retval = retval + [(self.classes[classIds[i]], confidences[i], (left, top, left + width, top + height))]
            print(self.classes[classIds[i]], confidences[i], left, top, width, height)
            self.drawPred(frame, classIds[i], confidences[i], left, top, left + width, top + height, color)
        return retval
    
    # Draw the predicted bounding box
    def drawPred(self, frame, classId, conf, left, top, right, bottom, color):
        # Draw a bounding box.
        cv2.rectangle(frame, (left, top), (right, bottom), color[classId], 3)
        label = '%.2f' % conf
        # Get the label for the class name and its confidence
        if self.classes:
            assert(classId < len(self.classes))
            label = '%s:%s' % (self.classes[classId], label)
        #Display the label at the top of the bounding box
        labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1, 1)
        top = max(top, labelSize[1])
        cv2.rectangle(frame, (left, top + 3), (left + labelSize[0], top - labelSize[1] - 6), color[classId], -1)
        cv2.putText(frame, label, (left, top), cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)
        print("Draw pref on frame:" + str(classId))

    def detect(self, frame):
        fconv = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(fconv)
        # Create a 4D blob from a frame.
        blob = cv2.dnn.blobFromImage(frame, 1/255, (YoloV3.inpWidth, YoloV3.inpHeight), [0,0,0], 1, crop=False)
        # Sets the input to the network
        self.net.setInput(blob)
        # Runs the forward pass to get output of the output layers
        outs = self.net.forward(self.getOutputsNames())
        # Remove the bounding boxes with low confidence
        detection = self.postprocess(frame, outs, self.colors)

        # Put efficiency information. The function getPerfProfile returns the
        # overall time for inference(t) and the timings for each of the layers(in layersTimes)
        if self.drawPerformance:
            t, _ = self.net.getPerfProfile()
            label = 'Inference time: %.2f ms' % (t * 1000.0 / cv2.getTickFrequency())
            cv2.putText(frame, label, (0, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255))

        return detection



#
# Data pipelines for Edge Computing
#
# Inspired by Google Media pipelines
#
#
# Dataflow can be within a "process" and then hook in locally
# But can also be via a "bus" or other communication mechanism
# 
#

# 
# Example: Draw detections
#
# Input 1. Picture
# Input 2. Detections [...]
#
# They can come in one single combined data-packet och as a picture that should be "annotated"
# with labels
#
import cvutils
import cv2
from datetime import datetime

# Named data
streaming_data = {}

class Calculator:
    def __init__(self, name):
        self.name = name
        # input names
        self.input = ['in']
        self.input_data = [None]
        # output names
        self.output = ['out']
        self.output_data = [None]
        self.lastStep = False

    # called to trigger a calculation of inputs => output
    def process_node(self):
        self.lastStep = self.process()
        return self.lastStep

    def get_output_index(self, name):
       return output.index(name)

    def set_input(self, index, inputData):
        print(self.name + " setting input ", index)
        self.input_data[index] = inputData
    
    def get_output(self, index):
        return self.output_data[index]

    def set_output(self, index, data):
        print("Setting output:" + self.output[index])
        streaming_data[self.output[index]] = data

    def set_input_names(self, inputs):
        self.input = inputs
        self.input_data = [None] * len(inputs)
    
    def set_output_names(self, outputs):
        self.output = outputs
        self.output_data = [None] * len(outputs)

    def get(self, index):
        val = self.input_data[index]
        self.input_data[index] = None
        return val

class ImageData:
    def __init__(self, image, timestamp):
        self.image = image
        self.timestamp = timestamp

class ImageMovementDetector(Calculator):
    def __init__(self, name):
        super().__init__(name)
        self.avg = cvutils.DiffFilter()

    def process(self):
        image = self.get(0)
        print(image)
        if isinstance(image, ImageData):
            if self.avg.calculate_diff(image.image) > 0.01:
                print(" *** Trigger motion!!! => output set!")
                self.set_output(0, image)
                return True
        return False

class ShowImage(Calculator):
    def process(self):
        image = self.get(0)
        if image is not None:
            cv2.imshow(self.name, image.image)
        return True

import sys
sys.path.append('../yolov3-ha')
import yolo3

class CaptureNode(Calculator):
    def __init__(self, name):
        super().__init__(name)
        self.output_data = [None]
        self.cap = cv2.VideoCapture(0)

    def process(self):
        ret, frame = self.cap.read()
        now = datetime.now()
        timestamp = datetime.timestamp(now)
        self.set_output(0, ImageData(frame, timestamp))
        return True

class YoloDetector(Calculator):
    def __init__(self, name):
        super().__init__(name)
        self.input_data = [None]
        self.yolo = yolo3.YoloV3(0.5, 0.4, datapath="../yolov3-ha")

    def process(self):
        image = self.get(0)
        if isinstance(image, ImageData):
            nf = image.image.copy()
            d = self.yolo.detect(nf)
            if d != []:
                self.set_output(0, ImageData(nf, image.timestamp))
                self.set_output(1, d)
                return True
        return False

class DrawDetections(Calculator):
    def __init__(self, name):
        super().__init__(name)
        self.input_data = [None, None]

    def process(self):
        if self.input_data[0] is not None and self.input_data[1] is not None:
            image = self.get(0)
            detections = self.get(1)
            self.input_data[1] = None
            if isinstance(image, ImageData):
                frame = image.image.copy()
                cvutils.drawDetections(frame, detections)
                self.set_output(0, ImageData(frame, image.timestamp))
                return True
        return False


# Test the code.
if __name__ == "__main__":

#
# input points to another node that should be used as input to this node.
# output is names on the different outputs. Just for matching...

    pipelineSrc = [{'calculator': 'CaptureNode', 'input':[], 'output':['input_video']},
                   {'calculator': 'ImageMovementDetector', 'input':['input_video'], 'output':['motion_detected']},
                   {'calculator': 'YoloDetector', 'input': ['motion_detected'],'output':['yolo_object_detector_img','yolo_detections']},
                   {'calculator': 'DrawDetections', 'input': ['motion_detected', 'yolo_detections'], 'output':['detection_image']},
                   {'calculator': 'ShowImage', 'input': ['yolo_object_detector_img'],'output':[]},
                   {'calculator': 'ShowImage', 'input': ['detection_image'],'output':[]},
                   ]


# Class must exist in globals to work.
    nr = 0
    pipeline = []
    for node in pipelineSrc:
        n = globals()[node['calculator']]("Node:" + str(nr) + ":" + node['calculator'])
        nr = nr + 1
        n.set_input_names(node['input'])
        n.set_output_names(node['output'])
        for name in node['input']:
            streaming_data[name] = None
        pipeline = pipeline + [n]
        print(n, n.input_data)

    while(True):
        # only one input for now...
        for node in pipeline:
            if len(node.input) > 0:
                for i in range(0, len(node.input)):
                    print("Getting output of " + node.input[i] + " for " + node.name)
                    if streaming_data[node.input[i]] is not None and node.input_data[i] is None:
                        print("  Setting input ", i, "to", streaming_data[node.input[i]])
                        node.set_input(i, streaming_data[node.input[i]])
            print("Process on ", node.name)
            node.process_node()
            print("SData:", streaming_data)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

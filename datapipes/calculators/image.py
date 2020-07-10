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
from calculators.core import Calculator

class ImageData:
    def __init__(self, image, timestamp):
        self.image = image
        self.timestamp = timestamp

class ImageMovementDetector(Calculator):
    def __init__(self, name, s, options=None):
        super().__init__(name, s)
        self.avg = cvutils.DiffFilter()
        self.threshold = 0.01
        if 'threshold' in options:
            self.threshold = options['threshold']

    def process(self):
        image = self.get(0)
        print(image)
        if isinstance(image, ImageData):
            value = self.avg.calculate_diff(image.image)
            if value > self.threshold:
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
    def __init__(self, name, s, options=None):
        super().__init__(name, s, options)
        self.output_data = [None]
        if options is not None and 'video' in options:
            self.video = options['video']
        else:
            self.video = 0
        print("*** Capture from ", self.video)
        self.cap = cv2.VideoCapture(self.video)

    def process(self):
        ret, frame = self.cap.read()
        now = datetime.now()
        timestamp = datetime.timestamp(now)
        self.set_output(0, ImageData(frame, timestamp))
        return True

class YoloDetector(Calculator):
    def __init__(self, name, s, options=None):
        super().__init__(name, s)
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
    def __init__(self, name, s, options=None):
        super().__init__(name, s)
        self.input_data = [None, None]

    def process(self):
        if self.input_data[0] is not None and self.input_data[1] is not None:
            image = self.get(0)
            detections = self.get(1)
            if isinstance(image, ImageData):
                frame = image.image.copy()
                cvutils.drawDetections(frame, detections)
                self.set_output(0, ImageData(frame, image.timestamp))
                return True
        return False

class LuminanceCalculator(Calculator):
    def __init__(self, name, s, options=None):
        super().__init__(name, s, options)
        self.input_data = [None]

    def process(self):
        if self.input_data[0] is not None:
            image = self.get(0)
            if isinstance(image, ImageData):
                gray = cv2.cvtColor(image.image, cv2.COLOR_BGR2GRAY)
                self.set_output(0, ImageData(gray, image.timestamp))
            return True

class SobelEdgesCalculator(Calculator):
    def __init__(self, name, s, options=None):
        super().__init__(name, s, options)
        self.input_data = [None]

    def process(self):
        if self.input_data[0] is not None:
            image = self.get(0)
            if isinstance(image, ImageData):
                img = cv2.GaussianBlur(image.image, (3,3), 0)
                sobelx = cv2.Sobel(img, cv2.CV_64F, 1, 0, ksize = 5)
                self.set_output(0, ImageData(sobelx, image.timestamp))
            return True

            
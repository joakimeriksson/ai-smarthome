# CV Utils
#
#
import cv2
import colorsys

def drawDetection(frame, left, top, right, bottom, color, classname, confidence):
    cv2.rectangle(frame, (left, top), (right, bottom), color, 3)
    label = ''
    if confidence is not None:
        label = '%.2f' % confidence
    # Get the label for the class name and its confidence
    label = '%s:%s' % (classname, label)
    #Display the label at the top of the bounding box
    labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1, 1)
    top = max(top, labelSize[1])
    cv2.rectangle(frame, (left, top + 3), (left + labelSize[0], top - labelSize[1] - 6), color, -1)
    cv2.putText(frame, label, (left, top), cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)

def drawDetections(frame, dets):
    for detection in dets:
        drawDetection(frame, int(detection[2][0]), int(detection[2][1]), int(detection[2][2]), detection[2][3], (255,0,0), detection[0], detection[1])

class detection:
    def __init__(self, ci, top, left, right, bottom, confidence = None, time = None):
        self.classIndex = ci
        self.top = top
        self.left = left
        self.bottom = bottom
        self.right = right
        self.confidence = confidence

# DrawUtils - draw detections on images
class DrawUtils:

    # setup utils object with some specific classes on the format:
    # ["c1","c2",...]
    def __init__(self, classes):
        self.classes = classes
        # Generate colors for drawing bounding boxes.
        hsv_tuples = [(x / len(self.classes), 1., 1.)
                    for x in range(len(self.classes))]
        self.colors = list(map(lambda x: colorsys.hsv_to_rgb(*x), hsv_tuples))
        self.colors = list(map(lambda x: (int(x[0] * 255), int(x[1] * 255), int(x[2] * 255)),
                        self.colors))

    # Draw the predicted bounding box
    def draw_detection(self, frame, classIndex, left, top, right, bottom, confidence=None):
        # Draw a bounding box.
        cv2.rectangle(frame, (left, top), (right, bottom), self.colors[classIndex], 3)
        label = ''
        if confidence is not None:
            label = '%.2f' % confidence
        # Get the label for the class name and its confidence
        if self.classes:
            assert(classIndex < len(self.classes))
            label = '%s:%s' % (self.classes[classIndex], label)
        #Display the label at the top of the bounding box
        labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1, 1)
        top = max(top, labelSize[1])
        cv2.rectangle(frame, (left, top + 3), (left + labelSize[0], top - labelSize[1] - 6), self.colors[classIndex], -1)
        cv2.putText(frame, label, (left, top), cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)

    def draw_elapsed(self, frame, time = None):
        if time is not None:
            cv2.putText(frame, "Elapsed: %.2f ms" % time, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

    def draw_class(self, frame, classIndex, confidence = None, time = None):
        label = "Class: " + self.classes[classIndex]
        if confidence is not None:
            label = label + " %.2f" % confidence
        cv2.putText(frame, label, (20, 20), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        self.draw_elapsed(frame, time)

    def draw_detections(self, frame, detections, time = None):
        for detection in detections:
            self.draw_detection(frame, detection.classIndex, detection.left, detection.top, detection.right, detection.bottom, detection.confidence)
        self.draw_elapsed(frame, time)

class DiffFilter:
    def __init__(self, initFrame = None):
        self.avgframe = initFrame

    def calculate_diff(self, frame):
        if self.avgframe is not None:
            subframe = cv2.subtract(frame, self.avgframe)
            grayscaled = cv2.cvtColor(subframe, cv2.COLOR_BGR2GRAY)
            retval2,th1 = cv2.threshold(grayscaled,35,255,cv2.THRESH_BINARY)
            self.avgframe = cv2.addWeighted(frame, 0.1, self.avgframe, 0.9, 0.0)
            th1 = th1 / 255
            w, h = th1.shape
            sum = cv2.sumElems(th1)[0]/(w*h)
            return sum
        else:
            self.avgframe = frame
            return 0.0


# Test the code.
if __name__ == "__main__":
    # execute only if run as a script
    du = DrawUtils(["person", "cat", "car"])
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()
    avg = DiffFilter(frame)
    du.draw_detection(frame, 1, 40, 40, 80, 80, confidence=0.3)
    avg.calculate_diff(frame)
    du.draw_detection(frame, 2, 140, 20, 200, 110, confidence=0.93)
    avg.calculate_diff(frame)
    du.draw_detections(frame, [detection(0, 120, 120, 150, 150, 0.33)], time=47.5)
    avg.calculate_diff(frame)
    du.draw_class(frame, 1, confidence=0.55, time=22)
    print("Diff: ", avg.calculate_diff(frame))

    cv2.imshow("test", frame)
    cv2.imshow("avg", avg.avgframe)
    if cv2.waitKey(10000) & 0xFF == ord('q'):
        print("Break")
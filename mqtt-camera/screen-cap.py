import time
import cv2
import mss
import numpy
import sys
sys.path.append('../yolov3-ha')
import yolo3


with mss.mss() as sct:
    # Part of the screen to capture
    monitor = {"top": 40, "left": 0, "width": 800, "height": 640}
    print(sct.monitors);
    yolo = yolo3.YoloV3(0.5, 0.4, datapath="../yolov3-ha")

    while "Screen capturing":
        last_time = time.time()

        # Get raw pixels from the screen, save it to a Numpy array
        img = numpy.array(sct.grab(monitor))
        img = cv2.resize(img, dsize=(800, 640), interpolation=cv2.INTER_CUBIC)

        nf = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
        d = yolo.detect(nf)

        print(d)

        # Display the picture
        cv2.imshow("OpenCV/Numpy normal", nf)

        print("fps: {}".format(1 / (time.time() - last_time)))
        time.sleep(0.2)
        # Press "q" to quit
        if cv2.waitKey(25) & 0xFF == ord("q"):
            cv2.destroyAllWindows()
            break
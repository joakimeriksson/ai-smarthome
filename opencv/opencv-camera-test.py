import numpy as np
import cv2, sys

cap = cv2.VideoCapture(1) #"rtsp://192.168.1.55:554/s0")
print('Is the IP camera turned on: {}'.format(cap.isOpened()))
print(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
print(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

while(True):
    # Capture frame-by-frame
    ret, frame = cap.read()

    print("Ret:", ret)
    if ret:
        # Our operations on the frame come here
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Display the resulting frame
        cv2.imshow('frame', gray)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

    
# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()

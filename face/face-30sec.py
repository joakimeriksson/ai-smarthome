import numpy as np
import cv2
import face_recognition
import time


# Load a sample picture and learn how to recognize it.
me_image = face_recognition.load_image_file("known/joakim.png")
me_face_encoding = face_recognition.face_encodings(me_image)[0]
known_face_encodings = [
    me_face_encoding,
]
known_face_names = [
    "Joakim Eriksson",
]


cap = cv2.VideoCapture(0)
photo_time = 0
while(True):
    # Capture frame-by-frame
    ret, frame = cap.read()

    face_locations = face_recognition.face_locations(frame)
    face_encodings = face_recognition.face_encodings(frame, face_locations)

    print(face_locations)
    name = "Unknown"
    match = False

    # Loop through each face found in the unknown image
    for (top, right, bottom, left), face_encoding in zip(face_locations, face_encodings):
        # See if the face is a match for the known face(s)
        matches = face_recognition.compare_faces(known_face_encodings, face_encoding)
        # If a match was found in known_face_encodings, just use the first one.
        if True in matches:
            first_match_index = matches.index(True)
            name = known_face_names[first_match_index]
            match = True
        cut = frame[top:bottom, left:right]
        cv2.rectangle(frame,(left, top), (right, bottom),(0,255,0),3)
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, name,(left, top - 5), font, 0.7, (255,255,255),2,cv2.LINE_AA)
        cv2.imshow('cut', cut)
        print("Name: ", name)
    if match == False:
        print("no match")

    # Display the resulting frame
    cv2.imshow('frame', frame)
    if time.time() - photo_time > 30.0:
        print("the photo is old...")
        known_face_encodings = known_face_encodings[0:1]
        known_face_names = known_face_names[0:1]

    key = cv2.waitKey(1) & 0xff
    if key == ord('q'):
        break
    if key == ord('p'):
        if(len(known_face_encodings) < 2):
            print("Storing new encoding")
            photo_time = time.time()
            known_face_encodings = known_face_encodings + [face_encoding]
            known_face_names = known_face_names + ["Newly Photoed"]
    if key == ord('o'):
        if name == "Newly Photoed":
            print("Door will open for you!")
        else:
            print("Door is closed for you!")

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()

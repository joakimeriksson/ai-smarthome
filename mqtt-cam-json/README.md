# MQTT Camera - JSON
This is a code-base for experimenting with AI/ML-models for image processing using MQTT API:s.

## Set-up
Ensure that you have python3 installed
Run the requirements.txt file to ensure that all the libraries are installed.
 
## Camera source
The camera source will be used for publishing a stream of images to the MQTT broker at a specified topic. This will create an input topic for the AI/ML model to do inferencing on.


    >python3 mqtt-cam-json.py --camera 1 --topic ha/camera/mqtt_json/in/joakimwebcam --broker=192.168.1.237
    ...

## Image viewer
The viewer is used to display the images from the camera source or from an analyzer / ML Model. The follwing will just show the images from the above we-camera source.

    >python3 mqtt-cam-view.py --topic ha/camera/mqtt_json/in/joakimwebcam --broker=192.168.1.237
    ...

## Image processors
...

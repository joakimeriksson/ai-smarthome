# MQTT Camera - JSON
This is a code-base for experimenting with AI/ML-models for image processing using MQTT API:s.

## Set-up
Ensure that you have python3 installed
Run the requirements.txt file to ensure that all the libraries are installed.
 
## JSON Format
All the messages are using a JSON-format that includes some meta-data and a base-64 encoded image.
An image is represented as:

     { "height": h, "witdth": w, "image": encoded_img}

and when there is detections in the image there is a detection attribute added:

     { "height": h, "witdth": w, "image": encoded_img, "detections": detections}

## Camera source
The camera source will be used for publishing a stream of images to the MQTT broker at a specified topic. This will create an input topic for the AI/ML model to do inferencing on.


    >python3 mqtt-cam-json.py --camera 1 --topic ha/camera/mqtt_json/in/joakimwebcam --broker=192.168.1.237
    ...

## Image viewer
The viewer is used to display the images from the camera source or from an analyzer / ML Model. The follwing will just show the images from the above web-camera source.

    >python3 mqtt-cam-view.py --topic ha/camera/mqtt_json/in/joakimwebcam --broker=192.168.1.237
    ...

## Image processors
The image processors will process incoming image data and reply with a new image (processed) and a set of detection meta-data. 

### Jetson inference - Pose Estimator
Note that the Jetson inference code is supposed to exist together with the other files of jetson-inference and under python/examples/

The pose estimator will use the Jetson Inference Engine to do pose estimation on the incoming images. The pose estimator will produce JSON expression on the following format:

    "detections" : {
            "type" : "pose-estimation", 
            "poses" : [
                {
                    "keypoints" : [{'ID': 0, 'x': 515, 'y': 472} ... ]
                    "links" : [[index_from, index_to], ... ]
                }
                ... ]

Note that the index in links is not the ID of the keypoint but the index of the keypoint in the keypoints array.

### Jetson inference - Object Detector
The object detector make use of jetson-inference pre-trained models - mobililnet-ssd, etc.


    "detections" : {
            "type" : "object-detection", 
            "detections" : [
		 {  "category_id": 1,
		    "score": 0.70654296875,
		    "bbox": [498.125, 208.4765625, 476.25, 500.625]}
                 }
                ... ]

The category_id is from the COCO object detector categories.


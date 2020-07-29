# Datapipes - processing pipeline for python
Experimental pipeline processing for Python. Intended for developing basic AI or IoT pipelines for testing ideas.

## Run datapipes.py
Datapipes are run with computer vision example by default (for now)
>python3 datapipes.py graphs/edge_detection.pbtxt

This will run the same graph as is available in googles mediapipes as an example of the similarities.

## Interactive CLI Version
Another option to start datapipes is to run it from an interactive cli.
>python3 pipecli.py

This will allow you to play with loading pipeline, starting stopping and printing the pipeline. Future features will be to add and remove parts of the pipeline at runtime, run at different speeds, debug, etc.

## Future features and ideas
* Add a way to distribute the pipeline processing over multiple threads and machines.
* Add a way to send messages over MQTT instead of passing results internally in python
* Serialize messages in protobufs between processes (over network)
* Allow same config to run in different modes (e.g. local in single process or over MQTT with protobufs) without
massive configuration change

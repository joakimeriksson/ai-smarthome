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
import cv2, sys
from calculators.image import *
from google.protobuf import text_format
import pipeconfig_pb2

def setup_default():
# input points to another node that should be used as input to this node.
# output is names on the different outputs. Just for matching...

    pipelineSrc = [{'calculator': 'CaptureNode', 'input':[], 'output':['input_video']},
                   {'calculator': 'ImageMovementDetector', 'input':['input_video'], 'output':['motion_detected'], 'node_options':{'threshold':0.01}},
                   {'calculator': 'YoloDetector', 'input': ['motion_detected'],'output':['yolo_object_detector_img','yolo_detections']},
                   {'calculator': 'DrawDetections', 'input': ['motion_detected', 'yolo_detections'], 'output':['detection_image']},
                   {'calculator': 'ShowImage', 'input': ['yolo_object_detector_img'],'output':[]},
                   {'calculator': 'ShowImage', 'input': ['detection_image'],'output':[]},
                   ]

# Class must exist in globals to work.

    for node in pipelineSrc:
        n = globals()[node['calculator']]("Node:" + str(nr) + ":" + node['calculator'], streaming_data)
        nr = nr + 1
        n.set_input_names(node['input'])
        n.set_output_names(node['output'])
        if ('node_options' in node):
            n.set_options(node['node_options'])
        for name in node['input']:
            streaming_data[name] = None
        pipeline = pipeline + [n]
    return pipeline

# Either load a pbtxt file or use the default above
if __name__ == "__main__":

    if len(sys.argv) == 2:
        pipe = pipeconfig_pb2.CalculatorGraphConfig()
        print("Loading pipeline from ", sys.argv[1])
        f = open(sys.argv[1], "r")
        txt = f.read()
        c = text_format.Parse(txt, pipe)

        nr = 0
        pipeline = []
        streaming_data = {}

        ins = CaptureNode("input_video", streaming_data)
        ins.set_input_names([])
        ins.set_output_names(["input_video"])

        outs = ShowImage("output_video", streaming_data)
        outs.set_input_names(["output_video"])
        outs.set_output_names([])

        pipeline = pipeline + [ins]
        for node in pipe.node:
            print(node.input_stream)
            n = globals()[node.calculator]("Node:" + str(nr) + ":" + node.calculator, streaming_data)
            nr = nr + 1
            n.set_input_names(node.input_stream)
            n.set_output_names(node.output_stream)
            n.set_options(node.node_options)
            for name in node.input_stream:
                streaming_data[name] = None
            pipeline = pipeline + [n]

        pipeline = pipeline + [outs]
    else:
        print("*** Setting up default pipeline.")
        setup_default()


    print("Pipeline:", pipeline)

    while(True):
        # only one input for now...
        for node in pipeline:
            if len(node.input) > 0:
                for i in range(0, len(node.input)):
                    print("Getting output of " + node.input[i] + " for " + node.name)
                    if streaming_data[node.input[i]] is not None and node.input_data[i] is None:
                        print("  Setting input ", i, "to", streaming_data[node.input[i]])
                        node.set_input(i, streaming_data[node.input[i]])
            node.process_node()
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

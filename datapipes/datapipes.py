#
# Data pipelines for Edge Computing in Python.
#
# Inspired by Google Media pipelines
#
# Dataflow can be within a "process" and then hook in locally
# But can also be via a "bus" or other communication mechanism
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
from calculators.mqtt import *
from google.protobuf import text_format
import pipeconfig_pb2

def add_stream_input_node(dict, name, node):
    if name not in dict:
        dict[name] = []
    dict[name] = dict[name] + [(node, node.get_input_index(name))]

def merge_options(mapoptions):
    options = {**mapoptions.doubleOptions, **mapoptions.stringOptions}
    return options

# Either load a pbtxt file or use the default above
if __name__ == "__main__":

    streaming_data = {}

    if len(sys.argv) == 2:
        pipe = pipeconfig_pb2.CalculatorGraphConfig()
        print("Loading pipeline from ", sys.argv[1])
        f = open(sys.argv[1], "r")
        txt = f.read()
        c = text_format.Parse(txt, pipe)

        pipeline = []

        ins = CaptureNode("input_video", streaming_data)
        ins.set_input_names([])
        ins.set_output_names(["input_video"])

        outs = ShowImage("output_video", streaming_data)
        outs.set_input_names(["output_video"])
        outs.set_output_names([])
        add_stream_input_node(streaming_data, "output_video", outs)

        pipeline = pipeline + [ins]
        for nr, node in enumerate(pipe.node, start = 1):
            print(node.input_stream)
            n = globals()[node.calculator]("Node:" + str(nr) + ":" + node.calculator, streaming_data)
            nr = nr + 1
            n.set_input_names(list(node.input_stream))
            n.set_output_names(list(node.output_stream))
            n.set_options(merge_options(node.map_node_options))
            for name in node.input_stream:
                add_stream_input_node(streaming_data, name, n)
            pipeline = pipeline + [n]

        pipeline = pipeline + [outs]
    else:
        print("*** Missing config file for pipeline.")
        exit()

    print("Pipeline:", pipeline)

    while(True):
        # Just process all nodes - they will produce output and process the input.
        for node in pipeline:
            node.process_node()
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

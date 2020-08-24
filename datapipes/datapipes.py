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
import cv2, sys, time
from calculators.image import *
from calculators.mqtt import *
from google.protobuf import text_format
import pipeconfig_pb2
import sched, threading

def add_stream_input_node(dict, name, node):
    if name not in dict:
        dict[name] = []
    dict[name] = dict[name] + [(node, node.get_input_index(name))]

def merge_options(mapoptions):
    options = {**mapoptions.doubleOptions, **mapoptions.stringOptions}
    return options

class Pipeline:
    def __init__(self):
        self.scheduler = sched.scheduler(time.time, time.sleep)
        self.streaming_data = {}
        self.pipeline = []
        self.do_exit = False
        self.run_pipeline = False
        self.run_step = 0

    def add_node(self, calculator, prefix, options, input_streams, output_streams):
        print("calculator", calculator)
        n = globals()[calculator]("Node:" + prefix + ":" + calculator, self.streaming_data, options=options)
        n.set_input_names(input_streams)
        n.set_output_names(output_streams)
        for name in input_streams:
            add_stream_input_node(self.streaming_data, name, n)
        self.pipeline = self.pipeline + [n]

    # Setup a pipeline based on a configuration
    def setup_pipeline(self, config, options={}, prefix=""):
        pipe = pipeconfig_pb2.CalculatorGraphConfig()
        c = text_format.Parse(config, pipe)

        # Should check if this already exists in the config...
        #   map_node_options: { key:"video"; value:"rtsp://192.168.1.237:7447/5c8d2bf990085177ff91c7a2_2" }
        ins = CaptureNode(prefix + "input_video", self.streaming_data, options=options.get('input_video',{}))
        ins.set_input_names([])
        ins.set_output_names([prefix + "input_video"])

        outs = ShowImage(prefix + "output_video", self.streaming_data)
        outs.set_input_names([prefix + "output_video"])
        outs.set_output_names([])
        add_stream_input_node(self.streaming_data, prefix + "output_video", outs)
        self.pipeline = self.pipeline + [ins]
        for nr, node in enumerate(pipe.node, start = 1):
            options = merge_options(node.map_node_options)
            self.add_node(node.calculator, prefix, options, list(map(lambda x: prefix + x, node.input_stream)), list(map(lambda x: prefix + x, node.output_stream)))
        self.pipeline = self.pipeline + [outs]
        return self.streaming_data, self.pipeline

    def get_node_by_output(self, outputname):
        return list(filter(lambda x : outputname in x.output, self.pipeline))

    # Running with the main thread - as it make use of CV2s show image.
    def run(self):
        while(not self.do_exit):
            if self.run_pipeline or self.run_step > 0:
                # Just process all nodes - they will produce output and process the input.
                for node in self.pipeline:
                    node.process_node()
                time.sleep(0.001)
                self.run_step -= 1
            else:
                # Nothing running at the moment...
                time.sleep(1)
            # CV2 wait-key
            if cv2.waitKey(1) & 0xFF == ord('q'):
                return
            self.scheduler.run()

    def step(self):
        self.run_step = 1

    def start(self):
        self.run_pipeline = True

    def stop(self):
        self.run_pipeline = False

    # I always forget if it is quit or exit - so I have both...
    def quit(self):
        self.do_exit = True

    def exit(self):
        self.do_exit = True

# Either load a pbtxt file or use the default above
if __name__ == "__main__":

    pipeline = Pipeline()

    if len(sys.argv) == 2:
        print("Loading pipeline from ", sys.argv[1])
        f = open(sys.argv[1], "r")
        txt = f.read()
        s1,p1 = pipeline.setup_pipeline(txt)
#        s1,p1 = pipeline.setup_pipeline(txt, options={'input_video': {'video': "rtsp://192.168.1.237:7447/5c8d2bf990085177ff91c7a2_2"}}, prefix="2/")
    else:
        print("*** Missing config file for pipeline.")
        exit()

    pipeline.start()
    pipeline.run()


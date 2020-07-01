#
# Data pipelines for Edge Computing
#
# Inspired by Google Media pipelines
#
#
# Dataflow can be within a "process" and then hook in locally
# But can also be via a "bus" or other communication mechanism
# 

class Calculator:
    def __init__(self, name, streams):
        self.name = name
        # input names
        self.input = ['in']
        self.input_data = [None]
        # output names
        self.output = ['out']
        self.output_data = [None]
        self.lastStep = False
        self.streams = streams

    # called to trigger a calculation of inputs => output
    def process_node(self):
        self.lastStep = self.process()
        return self.lastStep

    def get_output_index(self, name):
       return output.index(name)

    def set_input(self, index, inputData):
        print(self.name + " setting input ", index)
        self.input_data[index] = inputData
    
    def get_output(self, index):
        return self.output_data[index]

    def set_output(self, index, data):
        print("Setting output:" + self.output[index])
        self.streams[self.output[index]] = data

    def set_input_names(self, inputs):
        self.input = inputs
        self.input_data = [None] * len(inputs)
    
    def set_output_names(self, outputs):
        self.output = outputs
        self.output_data = [None] * len(outputs)

    def set_options(self, options):
        print(self.name  + " set options:", options)
        self.options = options

    def get(self, index):
        val = self.input_data[index]
        self.input_data[index] = None
        return val

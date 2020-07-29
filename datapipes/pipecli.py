import datapipes, threading, os
from cmd import Cmd
import networkx as nx
import matplotlib.pyplot as plt

def plot(g, labels):
    print("Plotting... Thread:", threading.get_ident())
    plt.subplot(121)
    pos=nx.spring_layout(g)
    nx.draw(g, pos, with_labels=True, font_weight='bold')
    nx.draw_networkx_edge_labels(g ,pos,edge_labels=labels,font_size=10)
    plt.show()

class PipeCli(Cmd):
    prompt = 'pipecli> '

    def __init__(self, completekey='tab', stdin=None, stdout=None):
        Cmd.__init__(self, completekey=completekey, stdin=stdin, stdout=stdout)
        self.pipeline = datapipes.Pipeline()
        self.ctr = 1
        self.camera = 0

    def do_exit(self, inp):
        '''exit the application.'''
        print("Bye")
        self.pipeline.exit()
        return True

    def do_setvideo(self, inp):
        '''set the current (default) video stream input. (setvideo <source>)'''
        print("Set video input '{}'".format(inp))
        self.camera = inp

    def do_print(self, inp):
        g = nx.Graph()
        labels = dict()
        for n in self.pipeline.pipeline:
            print("N:", n.name)
            print("  input :", n.input)
            print("  output:", n.output)
            g.add_node(n.name)
            # Add input edges
            for ni in n.input:
                nodes = self.pipeline.get_node_by_output(ni)
                if len(nodes) > 0:
                    g.add_edge(n.name, nodes[0].name)
                    labels[(n.name,nodes[0].name)] = ni
        self.pipeline.scheduler.enter(1, 1, plot, argument=(g,labels,))
        print("Done...")


    def emptyline(self):
        return

    def do_load(self, inp):
        if len(inp) == 0:
            files = [f for f in os.listdir("graphs")]
            print("Available pipelines (in graphs):")
            for file in files:
                print(file)
        else:
            print("Loading pipeline from ", inp)
            try:
                f = open(inp, "r")
            except:
                try:
                    f = open("graphs/" + inp, "r")
                except:
                    print("File not found:", inp)
                    return
            txt = f.read()
            print("Load graphs: '{}'".format(txt))
            self.pipeline.setup_pipeline(txt, prefix=str(self.ctr) + "/", options={'input_video': {'video': self.camera}})
            self.ctr += 1

    def do_start(self, inp):
        if not self.pipeline.run_pipeline:
            self.pipeline.start()

    def do_stop(self, inp):
        self.pipeline.stop()

    def do_step(self, inp):
        self.pipeline.step()

# Setup the CLI and start a separate thread for that - as main is needed for the CV processing.
p = PipeCli()
thread = threading.Thread(target=p.cmdloop)
thread.start()
p.pipeline.run()
thread.join()
import datapipes, threading
from cmd import Cmd


class PipeCli(Cmd):
    prompt = 'pipecli> '

    def __init__(self, completekey='tab', stdin=None, stdout=None):
        Cmd.__init__(self, completekey=completekey, stdin=stdin, stdout=stdout)
        self.pipeline = datapipes.Pipeline()
        self.ctr = 1

    def do_exit(self, inp):
        '''exit the application.'''
        print("Bye")
        self.pipeline.exit()
        return True

    def do_addcamera(self, inp):
        print("Add camera '{}'".format(inp))

    def do_loadgraph(self, inp):
        print("Loading pipeline from ", inp)
        f = open(inp, "r")
        txt = f.read()
        print("Load graphs: '{}'".format(txt))
        self.pipeline.setup_pipeline(txt, prefix=str(self.ctr) + "/")
        self.ctr += 1

    def do_start(self, inp):
        if not self.pipeline.run_pipeline:
            self.pipeline.start()

    def do_stop(self, inp):
        self.pipeline.stop()

    def do_step(self, inp):
        self.pipeline.step()

p = PipeCli()
thread = threading.Thread(target=p.cmdloop)
thread.start()
p.pipeline.run()
thread.join()
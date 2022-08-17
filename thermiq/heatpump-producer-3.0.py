import serial
import regs
import time
from confluent_kafka import SerializingProducer
from confluent_kafka.serialization import StringSerializer
import socket
from datetime import datetime
import toml
import hopsworks

DEBUG = False

def acked(err, msg):
    if err is not None:
        print("Failed to deliver message: %s: %s" % (str(msg), str(err)))
    else:
        print('Message {} successfully produced to {} [{}] at offset {}'.format(
        msg.key(), msg.topic(), msg.partition(), msg.offset()))



# Load HopsWorks Kafka configuration
conf = toml.load('config-3.toml')

connection = hopsworks.connection(
    host=conf['hops']['host'],
    project=conf['project']['name'],
    api_key_value=conf['project']['api_key']
)


# Initialize a simple String serializer for the key
string_serializer = StringSerializer('utf_8')

project = connection.get_project(name = conf['project']['name'])

kafka_api = project.get_kafka_api()
kafka_conf = kafka_api.get_default_config()

kafka_conf['key.serializer'] = string_serializer
kafka_conf['value.serializer'] = string_serializer

print(kafka_conf)

producer = SerializingProducer(kafka_conf)

tregs = regs.ThermIQ()

ser = serial.Serial('/dev/ttyACM0', timeout=1)  # open serial port
print(ser.name)         # check which port was really used
ser.write(b'ati\n')     # write a string
ser.write(b'atr0075\n')

lastTime = time.time()

while(True):

    if (time.time() - lastTime) > 60:
        lastTime = time.time()
        ser.write(b'atr0075\n')
    
    line = ser.readline()
    line = str(line, 'ascii')
    if len(line) > 3 and "=" in line:
        line = line.strip()
        d = line.split("=")
        #print(line, d)
        try:
            reg = int(d[0], 16)
            val = int(d[1], 16)
            name = tregs.get_name(reg)
            #print("Reg: " + str(reg) + " = " + str(val) + " Name:" + name + " " + tregs.get_type(name))
            tregs.set_value(reg, val)
            if DEBUG:
                print(tregs.get_description(name),"=", tregs.get_value(reg), tregs.get_type(name))
            if reg == 117:
                if DEBUG:
                    print("-------")
                print(tregs.json())
                if DEBUG:
                    print("-------")
                producer.produce(conf['kafka']['topic'], key="key", value=tregs.json(), on_delivery=acked)
                # Wait up to 1 second for events. Callbacks will be invoked during
                # this method call if the message is acknowledged.
                producer.poll(1)
        except ValueError:
            # Handle the exception
            print('Failed parsing:', d)

ser.close()

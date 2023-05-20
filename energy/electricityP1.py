import requests, time
from confluent_kafka import SerializingProducer
from confluent_kafka.serialization import StringSerializer
import socket
from datetime import datetime
import toml
import hopsworks

# Read smart-meter data from the P1 Smart Meter device
def read_smartmeter(url):
    # Making a get request
    response = requests.get(url)
    # get json content
    data = response.json()
    data['timestamp'] = time.time_ns() // 1000000
    return data


# Load HopsWorks Kafka configuration
conf = toml.load('config.toml')

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

smart_meter_url = conf['smartmeter']['url']
while(True):
    data = read_smartmeter(smart_meter_url)
    print(data['EnergyDelivered'])

    producer.produce(conf['kafka']['topic'], key="key", value=tregs.json(), on_delivery=acked)
    # Wait up to 1 second for events. Callbacks will be invoked during
    # this method call if the message is acknowledged.
    producer.poll(1)
    # Sleep one second...
    time.sleep(1.0)


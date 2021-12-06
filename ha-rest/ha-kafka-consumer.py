# 2021 - Joakim Eriksson, RISE, joakim.eriksson@ri.se
# Experimental Kafka consumer connecting Kafka topic with the REST API of 
# Home Assistant. Control a light via home assistant REST API.
# The Hops/Kafka part is inspired by Ahmad Al-Shishtawy's blog at 
# https://www.logicalclocks.com/blog/using-an-external-python-kafka-client-to-interact-with-a-hopsworks-cluster
#
#

from confluent_kafka import DeserializingConsumer
from confluent_kafka.serialization import StringDeserializer
import toml, json
import requests


# Load HopsWorks Kafka configuration - and Home Assistant API token
conf = toml.load("config.toml")

# Initialize a simple String deserializer for the key and value
string_deserializer = StringDeserializer('utf_8')

# Initialize the consumer
consumer_conf = {'bootstrap.servers': conf['hops']['url']+':'+conf['kafka']['port'],
                    'security.protocol': 'SSL',
                    'ssl.ca.location': conf['project']['ca_file'],
                    'ssl.certificate.location': conf['project']['certificate_file'],
                    'ssl.key.location': conf['project']['key_file'],
                    'ssl.key.password': conf['project']['key_password'],
                    'key.deserializer': string_deserializer,
                    'value.deserializer': string_deserializer,
                    'group.id': conf['kafka']['consumer']['group_id'],
                    'auto.offset.reset': conf['kafka']['consumer']['auto_offset_reset'],
                    }
consumer = DeserializingConsumer(consumer_conf)
# Subscribe to a topic
consumer.subscribe([conf['kafka']['topic']])

# Get the token, URL and light for Home Assistant API
token = conf['hass']['token']
url = conf['hass']['url']
light = conf['hass']['light']

headers = {
    "Authorization": "Bearer " + token,
    "content-type": "application/json",
}

# Load and print state of light
response = requests.get(url + "states/" + light, headers=headers)
print(response.text)


print("Consuming Kafka messages.")
# Main loop - polls for Kafka messages and controls light if receiving a service message.
while True:
    try:
        # SIGINT can't be handled when polling, limit timeout to 1 second.
        msg = consumer.poll(1.0)
        if msg is None:
            continue
        event = msg.value()
        if event is not None:
            print("Event record {}: value: {}\n"
                    .format(msg.key(), event))
            json_event = json.loads(event)
            if 'service' in json_event:
                # Assumes that both brighness and rgb_color are set
                if json_event['service'] == 'turn_on':
                    data = {'entity_id': light,'rgb_color':json_event['rgb_color'],
                     'brightness':json_event['brightness']}
                    print(data)
                    response = requests.post(url + "services/light/turn_on", headers=headers, json=data)
                    print(response)

    except KeyboardInterrupt:
        break
consumer.close()



import requests, re, json, time
import paho.mqtt.client as mqtt
from datetime import datetime

# Get the current date
current_date = datetime.now().strftime("%Y/%m-%d")
# Construct the URL with the current date
url = f"https://www.elprisetjustnu.se/api/v1/prices/{current_date}_SE3.json"

# Make the GET request
resp = requests.get(url)
data = resp.json()
print(data)
values = []
for obj in data:
    print(obj)
    values = values + [obj['SEK_per_kWh']]

values = json.dumps(values)

import time
# Run the other thing...
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
client.connect("192.168.1.56", 1883, 60)
client.loop()

print(values)

mqttPublish = client.publish("test-spot", payload=values, retain=True)
    
for i in range(1,10):
    client.loop()
    time.sleep(0.1)

mqttPublish.wait_for_publish()
client.disconnect()

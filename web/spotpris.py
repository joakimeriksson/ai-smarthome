import mechanize, re, json, datetime, time
from bs4 import BeautifulSoup
import paho.mqtt.client as mqtt

def on_connect(client, userdata, flags, rc):
    print("Connected with result code "+str(rc))

def on_message(client, userdata, msg):
    print(msg.topic+" "+str(msg.payload))


br = mechanize.Browser()
resp = br.open("https://www.elbruk.se/timpriser-se3-stockholm")
data = resp.read()
print(br.title())
soup = BeautifulSoup(data, 'html.parser')

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message
client.connect("192.168.1.237", 1883, 60)
client.loop_start()

for script in soup.find_all('script'):
    if (script.text.find("label: 'Idag'") != -1):
        print(script.text)
        all = re.findall(r'label: (.+),((?:\n.+?)+)data: (.+)', script.text, re.MULTILINE)
        for data in all:
            print(data[0] + ":" + data[2])
            if data[0] == "'Idag'":
                spot = json.loads(data[2])
                print(spot)
                print("Current hour", datetime.datetime.now().hour)
                print("Spot now: ", spot[datetime.datetime.now().hour])
                client.publish("test-spot", payload=json.dumps(spot), retain=True)
for i in range(1,10):
    client.loop()
    time.sleep(1)


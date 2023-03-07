#
# Simplistic application that displays the current spot price of Electricity 
# Joakim Eriksson, 2022.
#
# Config in config.json - needs to be uploaded to the NodeMCU / micropython
# {
#  "SSID": "<your SSID>",
#  "password": "<your wifi-password>",
#  "mqtt-topic": "the topic to get spot-prices from",
#  "mqtt-broker": "the broker to connect to",
# }

import network
import machine
import json, time
from umqtt.simple import MQTTClient
import display

# initialize the display - grabbed from: 
# https://github.com/loboris/MicroPython_ESP32_psRAM_LoBo/issues/310
tft=display.TFT()
tft.init(tft.ST7789, rst_pin=23, backl_pin=4, miso=0, mosi=19, clk=18, cs=5, dc=16, width=235, height=340, backl_on=1)

# invert colors and configure the display
tft.tft_writecmd(0x21)
tft.orient(tft.LANDSCAPE)
tft.setwin(40, 52, 279, 186)

spot_topic = b"spot"
img_topic = b"img"
spot_price_today = []

# get a color that corresponds to the price (in SEK/100 per kWh)
def get_spot_color(spot_price):
    if spot_price < 50:
        return 0x00ff00
    elif spot_price < 100:
        return 0x40b000
    elif spot_price < 200:
        return 0x808000
    else:
        return 0xff0000

# Received messages from subscriptions will be delivered to this callback
def sub_cb(topic, msg):
    global spot_price_today
    print((topic, msg))
    if topic == spot_topic:
        jprice = json.loads(msg)
        print("Spot Prices:", jprice)
        spot_price_today = jprice
    if topic == img_topic:
        jprice = json.loads(msg)


# Read config
# should have { 'SSID': <YOUR_SSID>, 'password':<pass> }
f = open('config.json', 'r')
data = f.readlines()
f.close()
cdata = ""
for s in data:
    cdata = cdata + s
print("Raw file", cdata)
config = json.loads(cdata)

print("Parsed Config:", config)
spot_topic = config["mqtt-topic"].encode()
mqtt_host = config["mqtt-broker"]

wlan_ap = network.WLAN(network.AP_IF)
wlan_ap.active(False)

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
nets = wlan.scan()

print("Networks", nets)

wlan.connect(config['SSID'], config['password'])
while not wlan.isconnected():
    machine.idle() # save power while waiting
print('WLAN connection succeeded!')

c = MQTTClient("umqtt_client", mqtt_host)
c.set_callback(sub_cb)
c.connect()
c.subscribe(spot_topic)

# This works only with the micropython that happen to have RTC in machine
rtc = machine.RTC()
if not rtc.synced():
    rtc.ntp_sync('pool.ntp.org')

tft.set_bg(tft.BLACK)
tft.set_fg(tft.WHITE)
tft.clear()
while(True):
    c.check_msg()
    time.sleep(1)
    # Ugly hack to get the Swedish (CET) time - but will change during winter...
    now = time.gmtime(int(time.time() + 2 * 3600))
    tft.text(10, 10, "Spot Price at %02d:%02d:%02d   " % (now[3], now[4], now[5]))
 
    if len(spot_price_today) > 23:
        current_spot = spot_price_today[now[3]]
        tft.text(10, 30, "Now: %.2f    " % current_spot)
        # Draw a graph on todays SPOT prices...
        x = 10
        y = 50 + 60
        hour = 0
        ymul = 60 / max(spot_price_today)
        tft.rect(10, 50, 200, 60, get_spot_color(current_spot), tft.BLACK)
        for spot in spot_price_today:
            tft.rect(x, y - int(spot * ymul), 8, int(spot * ymul), get_spot_color(spot), get_spot_color(spot))
            if hour % 4 == 0:
                tft.text(x - 4, y + 2, "%02d" % (hour))
            if now[3] == hour:
                tft.line(x + 4, y - 59, x + 4, y - 1, tft.WHITE)
            x = x + 8
            hour = hour + 1


#
# GPIO web fetch - will fetch a web page when GPIO port on pin 12 changes.
# Joakim Eriksson, 2020.
#
# Config in config.json - needs to be uploaded to the NodeMCU / micropython
# {
#  "SSID": "<your SSID>",
#  "password": "<your wifi-password>",
#  "url-on": "<the url to fetch when pin is 1>",
#  "url-off": "<the url to fetch when pin is 0>",
# }

import time, socket, ussl
import network
import machine
import json

# Simple HTTP request function
def http_get(url):
    print("Fetching:", url)
    proto, _, host, path = url.split('/', 3)

    if proto == "http:":
        port = 80
    elif proto == "https:":
        port = 443

    addr = socket.getaddrinfo(host, port)[0][-1]
    s = socket.socket()
    s.connect(addr)
    if proto == "https:":
        s = ussl.wrap_socket(s, server_hostname=host)
    s.write(bytes('GET /%s HTTP/1.0\r\nHost: %s\r\n\r\n' % (path, host), 'utf8'))
    while True:
        data = s.read(100)
        if data:
            print(str(data, 'utf8'), end='')
        else:
            break
    s.close()

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
url_on = config["url-on"]
url_off = config["url-off"]

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

pin = machine.Pin(12, mode=machine.Pin.IN, pull=machine.Pin.PULL_UP)
last_v = 0
while True:
    v = pin.value()
    time.sleep(1)
    if v != last_v:
        try:
            if (v == 1):
                http_get(url_on)
            else:
                http_get(url_off)
            last_v = v
        except OSError as exc:
            print("OSError: ", exc.args[0])
            time.sleep(4)
    print("This is output... PIN:", v, " last:", last_v)

import time, socket
import network
import machine
import json

def http_get(url):
    _, _, host, path = url.split('/', 3)
    addr = socket.getaddrinfo(host, 80)[0][-1]
    s = socket.socket()
    s.connect(addr)
    s.send(bytes('GET /%s HTTP/1.0\r\nHost: %s\r\n\r\n' % (path, host), 'utf8'))
    while True:
        data = s.recv(100)
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
print(cdata)
config = json.loads(cdata)

print(config)

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
nets = wlan.scan()

print("Networks", nets)
wlan.connect(config['SSID'], config['password']) #'joxehome', 'nadapokada')
while not wlan.isconnected():
    machine.idle() # save power while waiting
print('WLAN connection succeeded!')

pin = machine.Pin(12, mode=machine.Pin.IN, pull=machine.Pin.PULL_UP)
last_v = 0
while True:
    v = pin.value()
    time.sleep(1)
    if v != last_v:
        http_get("http://192.168.1.1/" + str(v))
    last_v = v
    print("This is output... PIN:", v)

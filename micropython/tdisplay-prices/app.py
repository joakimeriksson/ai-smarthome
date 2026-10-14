# Spot-price display for the LilyGO T-Display (ESP32, ST7789 135x240), MicroPython 1.29 + st7789py.
# Joakim Eriksson 2022 (LoBo/MQTT version), 2026: fetches the prices itself from elprisetjustnu.se.
# config.json: {"ssid": "...", "psk": "...", "area": "SE3"}; demo_prices.json (same API format) is used
# when there is no network, which is what the emulator's browser build has.
import json, time, network, machine, sys, gc, esp32

def heap(tag): gc.collect(); print("HEAP", tag, "gc", gc.mem_free(), "idf", sum(x[2] for x in esp32.idf_heap_info(esp32.HEAP_DATA)))

def load_json(name, default):
    try:
        with open(name) as f: return json.load(f)
    except OSError:
        return default

cfg = load_json("config.json", {})
area = cfg.get("area", "SE3")

# Associate before the display driver and fonts load: MicroPython's GC heap grows into the ESP-IDF heap when
# they are imported, and the Wi-Fi association (WPA2, lwIP, DHCP) plus a TLS handshake need the IDF heap.
def connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.config(pm=network.WLAN.PM_NONE)
    if wlan.isconnected(): return wlan
    if not cfg.get("ssid"): return None
    wlan.connect(cfg["ssid"], cfg.get("psk", ""))
    for _ in range(100):
        if wlan.isconnected(): heap("associated"); return wlan
        time.sleep_ms(200)
    return None

wlan = connect()
print("WLAN", wlan.ifconfig()[0] if wlan else "no connection")

from machine import Pin, SPI
import st7789py as st7789, vga2_16x32 as big, vga1_8x16 as small
W, H = 240, 135
tft = st7789.ST7789(SPI(2, baudrate=20_000_000, sck=Pin(18), mosi=Pin(19), miso=None), 135, 240,
                    reset=Pin(23, Pin.OUT), dc=Pin(16, Pin.OUT), cs=Pin(5, Pin.OUT), backlight=Pin(4, Pin.OUT), rotation=1)
btn_refresh = Pin(0, Pin.IN, Pin.PULL_UP)        # left button: fetch again
GREY = 0x8410
heap("display")

def price_color(sek):                             # SEK/kWh, same steps as the 2022 version (öre/kWh thresholds)
    if sek < 0.50: return st7789.GREEN
    if sek < 1.00: return 0x4600                  # dark green
    if sek < 2.00: return 0x8400                  # olive
    return st7789.RED

def status(text, color=st7789.WHITE):
    tft.fill_rect(0, H - 16, W, 16, st7789.BLACK)
    tft.text(small, text[:30], 0, H - 16, color)

def set_time():
    try:
        import ntptime; ntptime.settime(); return True
    except OSError:
        return False

def fetch(day):                                   # day: (y, m, d) UTC; prices come in 15-minute slots since 2025-10
    """Stream the day's JSON and keep only (hour, SEK/kWh): the full document does not fit next to TLS on this heap."""
    import requests
    url = "https://www.elprisetjustnu.se/api/v1/prices/%04d/%02d-%02d_%s.json" % (day[0], day[1], day[2], area)
    heap("fetch")
    r = requests.get(url, timeout=20)
    heap("got " + str(r.status_code))
    try:
        if r.status_code != 200: return None
        slots, tail = [], b""
        while True:
            chunk = r.raw.read(1024)
            if not chunk: break
            buf = tail + chunk
            while True:                           # one object per iteration: {"SEK_per_kWh":0.049,...,"time_start":"2026-10-14T00:00:00+02:00",...}
                a = buf.find(b"{"); b = buf.find(b"}", a + 1)
                if a < 0 or b < 0: break
                obj = buf[a:b]; buf = buf[b + 1:]
                k = obj.find(b'"SEK_per_kWh":'); t = obj.find(b'"time_start":"')
                if k >= 0 and t >= 0:
                    slots.append({"SEK_per_kWh": float(obj[k + 14:obj.find(b",", k)]), "time_start": obj[t + 14:t + 39].decode()})
            tail = buf[-1200:]
        return slots
    finally:
        r.close()

def hourly(slots):                                # -> ([24 SEK/kWh], utc_offset_seconds) from the API's time_start strings
    hours = [[] for _ in range(24)]
    off = 0
    for s in slots:
        t = s["time_start"]                       # "2026-10-14T10:00:00+02:00"
        hours[int(t[11:13])].append(s["SEK_per_kWh"])
        off = (int(t[20:22]) * 60 + int(t[23:25])) * 60 * (1 if t[19] == "+" else -1)
    return [sum(h) / len(h) if h else None for h in hours], off

def draw(prices, off, source):
    tft.fill(st7789.BLACK)
    lt = time.localtime(time.time() + off)
    hour = lt[3]
    now = prices[hour] if prices and prices[hour] is not None else None
    tft.text(small, "%s %02d:%02d %s" % (area, lt[3], lt[4], source), 0, 0, GREY)
    if now is None:
        tft.text(big, "no price", 0, 20, st7789.RED)
    else:
        tft.text(big, "%.2f" % now, 0, 20, price_color(now))
        tft.text(small, "SEK/kWh", 84, 36, GREY)
    if prices:
        top = max(p for p in prices if p is not None) or 1
        base, hmax = H - 20, 56
        for h, p in enumerate(prices):
            if p is None: continue
            x = 8 + h * 9
            bar = max(1, int(p / top * hmax))
            tft.fill_rect(x, base - bar, 8, bar, price_color(p))
            if h == hour: tft.hline(x, base + 1, 8, st7789.WHITE)
            if h % 6 == 0: tft.text(small, "%02d" % h, x - 4, base + 3, GREY)

def refresh(source):
    try:
        slots = fetch(time.gmtime()[:3])
        if slots:
            prices, off = hourly(slots)
            print("PRICES live", len(slots), "slots, utc offset", off)
            return prices, off, "live"
    except Exception as e:
        print("fetch failed:", repr(e)); sys.print_exception(e)
    return None, 0, source

prices, off, source = None, 0, "demo"
if wlan:
    print("TIME", "ntp" if set_time() else "no ntp", time.gmtime()[:6])
    status("fetching " + area + " ...", st7789.YELLOW)
    prices, off, source = refresh(source)
if prices is None:
    demo = load_json("demo_prices.json", None)
    if demo:
        prices, off = hourly(demo); print("PRICES demo", len(demo), "slots")
        if not wlan: machine.RTC().datetime((2026, 10, 14, 2, 10, 0, 0, 0))   # the demo day's clock
draw(prices, off, source)
lt = time.localtime(time.time() + off)
print("DRAWN", source, "local %02d:%02d" % (lt[3], lt[4]), "now", prices[lt[3]] if prices else None)
if prices is None: status("no network, no demo data", st7789.RED)

last_fetch, last_min = time.time(), -1
while True:
    time.sleep_ms(250)
    t = time.localtime(time.time() + off)
    if wlan and wlan.isconnected() and (btn_refresh.value() == 0 or time.time() - last_fetch > 3600):
        status("fetching ...", st7789.YELLOW)
        p2, o2, s2 = refresh(source)
        if p2: prices, off, source = p2, o2, s2
        last_fetch, last_min = time.time(), -1
    if t[4] != last_min:
        last_min = t[4]
        draw(prices, off, source)

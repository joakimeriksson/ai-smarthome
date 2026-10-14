# Spot-price display on the LilyGO TTGO T-Display (classic ESP32)

Stock MicroPython + a few files. Fetches today's Nord Pool prices for SE3 from elprisetjustnu.se
itself (Wi-Fi, SNTP, HTTPS), draws the current price and 24 hourly bars on the 135x240 ST7789.
Runs unchanged on the real board and in esp32sim (`--chip esp32`), where `demo_prices.json` is the
fallback when there is no network.

## Files
- `app.py` — the application (import order matters, see the comment at the top); `main.py` is `import app`
- `st7789py.py` — russhughes' pure-Python ST7789 driver (MIT), `vga1_8x16.py` / `vga2_16x32.py` — bitmap fonts
- `demo_prices.json` — one day of the API's output, for the no-network fallback
- `config.json` (not in git) — `{"ssid": "...", "psk": "...", "area": "SE3"}`

## Flash and install (board on /dev/cu.usbserial-*)
```sh
python3 -m venv venv && venv/bin/pip install esptool mpremote mpy-cross
venv/bin/esptool.py --port PORT erase_flash
venv/bin/esptool.py --port PORT --baud 460800 write_flash 0x1000 ESP32_GENERIC-20260824-v1.29.0.bin   # micropython.org
for f in app st7789py vga1_8x16 vga2_16x32; do venv/bin/mpy-cross -march=xtensawin -O2 $f.py; done
venv/bin/mpremote connect PORT cp app.mpy st7789py.mpy vga1_8x16.mpy vga2_16x32.mpy demo_prices.json config.json main.py :
```
Use the `.mpy` files, not the `.py` sources: on the classic ESP32 MicroPython's GC heap grows into the
ESP-IDF heap while parsing source, and the Wi-Fi stack plus a TLS handshake need ~45 KB of IDF heap.
For the same reason `app.py` associates before importing the display driver and fonts, and streams the
13.6 kB JSON instead of holding it.

## Pins (T-Display)
ST7789 on VSPI: SCK 18, MOSI 19 (`miso=None`, or MicroPython claims 19 as MISO), CS 5, DC 16, RST 23, BL 4;
buttons 35 and 0 (left = refresh); battery ADC 34, ADC enable 14.

#
# Reader of MaixSense A010 - serial images 
# Format is described here: https://wiki.sipeed.com/hardware/en/maixsense/maixsense-a010/at_command_en.html
#
# Author: Joakim Eriksson
#
import serial, time

# Decode the depth image
def decode(binimg):
    length = binimg[2] + binimg[3] * 256
    if len(binimg) < length + 4:
        return None
    imgpos = 16 + 4
    width = binimg[14] # 4 + 10
    height = binimg[15] # 4 + 11
    print("Image: len ", length, " W,H:", width, height)
    return binimg[imgpos:imgpos + length - 16], length + 4, width, height


class SerialComm:

    def __init__(self, port, baud_rate):
        self.port = port
        self.baud_rate = baud_rate
        self.ser = serial.Serial(port, baud_rate, timeout=1)
        self.buffer = bytearray()

    def _read_bytes(self, timeout):
        bytesread = 0
        end_time = time.time() + timeout
        response = b''
        while time.time() < end_time and bytesread < 20:
            if self.ser.in_waiting > 0:
                data = self.ser.read()
                response += data
                bytesread = bytesread + len(data)
        return response


    def _fill_buffer(self, timeout):
        data = self._read_bytes(timeout)
        self.buffer.extend(data)

    def send_at_command(self, command, timeout=1):
        try:
            self.ser.write((command + '\r\n').encode('utf-8'))
            response = self.read_next(timeout)
            return response
        except Exception as e:
            print(f"Error: {e}")
            return None

    def read_next(self, timeout):
        if self.buffer is None or len(self.buffer) < 4:
            self._fill_buffer(timeout)
        next = None

        bytes = self.buffer
        if bytes[0] == 0x00 and bytes[1] == 0xff:
            res = decode(bytes)
            if res == None:
                print("Need more data...:", len(bytes))
                self._fill_buffer(timeout)
                return None
            img, size, w, h = res
            next = ('image', w, h, img)
        else:
            text = ""
            size = 0
            # Text always should end with \n
            for data in bytes:
                if data > 0 and data < 128:
                    text = text + chr(data)
                    size = size + 1
                    if data == ord('\n'):
                        break
                else:
                    # print and skip... on byte...
                    print(data)
                    size = size + 1
                    break
            next = ('text', text)
        # Cut away len bytes...
        self.buffer = self.buffer[size:]
        return next

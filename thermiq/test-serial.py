import serial
import regs

tregs = regs.ThermIQ()

ser = serial.Serial('/dev/ttyACM0', timeout=1)  # open serial port
print(ser.name)         # check which port was really used
ser.write(b'ati\n')     # write a string
ser.write(b'atr0060\n')
while(True):
    line = ser.readline()
    print(line)
    line = str(line, 'ascii')
    if len(line) > 3 and "=" in line:
        line = line.strip()
        d = line.split("=")
        print(line, d)
        reg = int(d[0], 16)
        val = int(d[1], 16)
        name = tregs.get_name(reg)
        print("Reg: " + str(reg) + " = " + str(val) + " Name:" + name + " " + tregs.get_type(name))
        tregs.set_value(reg, val)
    
ser.close()

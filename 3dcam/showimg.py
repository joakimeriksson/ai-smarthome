import argparse
import numpy as np
import cv2
import a010cam 

def main():
    parser = argparse.ArgumentParser(description="Read images from an MaixSense A10")

    parser.add_argument('-d', '--device', type=str, required=True, help="USB device name (e.g., /dev/ttyUSB0)")
    args = parser.parse_args()

    print(f"USB Device: {args.device}")
    port = args.device # '/dev/tty.usbserial-202206_F7C95B0'  # or '/dev/ttyUSB0' for Linux
    baud_rate = 230400  # The baud rate should match the device's rate

    serial_comm = a010cam.SerialComm(port, baud_rate)

    # Do some AT Commands first - and then turn on serial images.
    # First command is to turn of images.
    res = serial_comm.send_at_command("AT+DISP=1")
    print(res)
    res = serial_comm.send_at_command("AT+ISP?")
    print(res)
    res = serial_comm.send_at_command("AT+DISP?")
    print(res)
    res = serial_comm.send_at_command("AT+BINN?")
    print(res)
    res = serial_comm.send_at_command("AT+BAUD?")
    print(res)
    res = serial_comm.send_at_command("AT+FPS?")
    print(res)
    res = serial_comm.send_at_command("AT+FPS=1")
    print(res)
    res = serial_comm.send_at_command("AT+BAUD=3")
    print(res)
    # Turn on images over serial
    res = serial_comm.send_at_command("AT+DISP=3")

    frame_img0 = None
    while(True):
        res = serial_comm.read_next(1)
        if res == None:
            continue
        if res[0] == 'text':
            print(res)
        elif res[0] ==  'image':
            data = res[3]
            width = res[1]
            height = res[2]

            # Create an image from the data
            nparr = np.frombuffer(data, np.uint8)
            frame_data0 = nparr
            frame_img0 = np.array(frame_data0, np.uint8).reshape(width, height)
            frame_img0 = cv2.applyColorMap(frame_img0, cv2.COLORMAP_RAINBOW)

            # Create a small window and show the image.
            cv2.namedWindow("frame0", cv2.WINDOW_NORMAL) 
            cv2.resizeWindow("frame0", 700, 700)
            cv2.imshow("frame0", frame_img0)
            cv2.waitKey(1)

        if res == None:
            break
        
if __name__ == "__main__":
    main()
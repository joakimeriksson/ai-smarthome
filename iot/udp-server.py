#
# Simple UDP server for Contiki-NG example RPL-UDP
# Given that it is reconfigured to send to fd00::1 (default if prefix on border-router)
#
import socket
 
UDP_IP = "fd00::1"
UDP_PORT = 5678

sock = socket.socket(socket.AF_INET6, # Internet
                     socket.SOCK_DGRAM, 0) # UDP
sock.bind((UDP_IP, UDP_PORT, 0, 0))
while True:
    data, addr = sock.recvfrom(1024) # buffer size is 1024 bytes
    print("received message: %s " % data, "from", addr)
    sock.sendto(b"hello from the server", addr)

import struct
import socket

MYPORT = 1900
SSDP_ADDR = 'ff02::c'
MYTTL = 1

# Look up multicast group address in name server and find out IP version
addrinfo = socket.getaddrinfo(SSDP_ADDR, None)[0]

# Create and configure socket
s = socket.socket(addrinfo[0], socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('', MYPORT))

# Join multicast group
group_bin = socket.inet_pton(addrinfo[0], addrinfo[4][0])
mreq = group_bin + struct.pack('@I', 0)
s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_JOIN_GROUP, mreq)

# Loop, printing any data we receive
while True:
    data, sender = s.recvfrom(1500)
    while data[-1:] == '\0': data = data[:-1] # Strip trailing \0's
    print (str(sender) + '  ' + repr(data))

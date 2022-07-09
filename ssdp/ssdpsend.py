import socket

uUDP_IP = u'ff02::c%eno1'
iUDP_PORT = 1900
uMessage = u'M-SEARCH * HTTP/1.1\r\nHOST: [%s]:%d\r\nMAN: "ssdp:discover"\r\nMX: 5\r\nST: %s\r\n\r\n' % (uUDP_IP, iUDP_PORT, "ssdp:all")

print("Sending:", uMessage)
oSocket = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
oSocket.settimeout(10)
oSocket.setsockopt(socket.IPPROTO_IPV6, socket.IP_MULTICAST_TTL, 2)
oSocket.sendto(uMessage.encode('utf-8'), (uUDP_IP, iUDP_PORT))




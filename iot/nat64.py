#!/bin/python3
#
# Copyright (c) 2019 Joakim Eriksson
# All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
# 1. Redistributions of source code must retain the above copyright
#    notice, this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright
#    notice, this list of conditions and the following disclaimer in the
#    documentation and/or other materials provided with the distribution.
# 3. The name of the author may not be used to endorse or promote
#    products derived from this software without specific prior
#    written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
# ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
# FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
# DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
# OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
# HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
# LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
# OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
# SUCH DAMAGE.
#
#
# Experimental NAT64 and DNS64 using tun-interface (for the NAT64 IPv6 interface and the
# regular sockets as the TCP/UDP interface.
#

import ipaddress
import socket
from scapy.all import *
from scapy.layers.inet import UDP, TCP
from scapy.layers.inet6 import IPv6

# TCP State machine
TCP_INIT = 1 # Same as LISTEN... more or less...
TCP_SYN_RECEIVED = 2
TCP_SYN_SENT = 3
TCP_ESTABLISHED = 4
TCP_FIN_WAIT = 5
TCP_FIN_CLOSE_WAIT = 6

# Protocol numbers
PROTO_UDP = 17
PROTO_TCP = 6
PROTO_ICMP = 58

# all connections will get their own socket - so all incoming will be
# looked up by socket
# all from IPv6 => IPv4 will be looked up by proto:IPv6:port,IPv4:port
udp_port = 15000
tcp_port = 15000
sockmap = {}
adrmap = {}
input = []
tun = None
tunconnection = None
prefix = ipaddress.ip_address("64:ff9b::0").packed

# Remove the state for this specific socket
def sock_remove(socket):
    todel = None
    sockmap.pop(socket)
    for k in adrmap:
        if adrmap[k] == socket:
            todel = k
    adrmap.pop(todel)
    input.remove(socket)
    socket.close()

# Handle TCP state - forward data from socket to tun.
def update_tcp_state_totun(st, data):
    tcpState = st[5]
    ipv6 = IPv6(src = st[2], dst = st[0])/TCP(sport=st[3], dport=st[1], flags="PA") / raw(data)
    # Update with the current seq and ack.
    ipv6.seq = tcpState['seq']
    ipv6.ack = tcpState['ack']
    return ipv6

def send_to_tun(ipv6):
    if ipv6 is not None:
        print("Writing to tun:", len(bytes(ipv6)))
        if tun is not None:
            os.write(tun, bytes(ipv6))
        if tunconnection is not None:
            tunconnection.send(bytes(ipv6))

# Handle TCP state - TCP from ipv6 toward IPv4 socket
def handle_tcp_state_tosock(ip, sock):
    global tun
    print("=== NAT64 TCP sock-send:", ip.flags, sock, "===")
    st = sockmap[sock]
    tcpState = st[5]
    if ip.flags.S:
    # Use Window size to control max segment?
        sock.setsockopt(socket.SOL_TCP, socket.TCP_MAXSEG, 1000)
        print("Maxseg:", sock.getsockopt(socket.SOL_TCP, socket.TCP_MAXSEG))
        tcpState['ack'] = ip.seq + 1
        # We are established...
        tcpState['state'] = TCP_ESTABLISHED
        tcpState['window'] = ip[TCP].window
        print("TCP State:", tcpState)
        print("SYN received - send SYNACK (tun)! ", st[5])
        ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="SA", seq=tcpState['seq'], ack=tcpState['ack'])
        ipv6.show()
        send_to_tun(bytes(IPv6(ipv6)))
#    sock.send(ip.load)
    elif ip.flags.FA or ip.flags.F:
        tcpState['state'] = TCP_FIN_CLOSE_WAIT
        tcpState['ack'] = ip.seq + 1
        tcpState['timeout'] = time.time()
        print("TCP: FIN received - sending FIN.")
        ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="FA", seq=tcpState['seq'], ack=tcpState['ack'])
        ipv6.show()
        send_to_tun(bytes(IPv6(ipv6)))
        # Clean out this socket?
    elif ip.flags.A or ip.flags.AP:
        if tcpState['state'] == TCP_ESTABLISHED:
            if not hasattr(ip,'load'):
                print("ESTABLISHED from other side. seq:", ip.seq, "ack:", ip.ack)
                tcpState['seq'] = ip.ack
            else:
                # ACK immediately - we assume that we get data from other side soon...
                print("TCP: received ", len(ip.load), "seq:", ip.seq, "ack:", tcpState['ack'])
                tcpState['ack'] = ip.seq + len(ip.load)
                # We should also handle the sanity checks for the ACK
                tcpState['seq'] = ip.ack
                ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="A", seq=tcpState['seq'], ack=tcpState['ack'])
                ipv6 = IPv6(ipv6)
                print("TCP Sending ACK (tun)!", st[5])
                ipv6.show()
                send_to_tun(bytes(ipv6))
    if hasattr(ip, 'load'):
        print("TCP: Sending over socket - Payload:", ip.load)
        sock.send(ip.load)

def nat64_send(ip):
    global input, udp_port, tcp_port
    # NAT64 translation
    dst = ipaddress.ip_address(ip.dst)
    key = ""
    if dst.packed[0:4] == prefix[0:4]:
        ip4dst = ipaddress.ip_address(dst.packed[-4:])
        print("NAT64 dst:", ip4dst, ip.nh)
        if ip.nh == PROTO_UDP:
            if DNS in ip:
                print("DNS name:", ip[DNS].opcode)
                if ip[DNS].opcode == 0 and ip[DNS].qdcount > 0:
                    print(ip[DNSQR].qname)
                    addr = socket.gethostbyname(ip[DNSQR].qname)
                    dns64addr = ipaddress.ip_address(prefix[0:16-4] +
                                                     ipaddress.ip_address(addr).packed)
                    print(" => ", addr, str(dns64addr))
                    name = ip[DNSQR].qname
                    ipaddr = dns64addr
                    resp = IPv6(dst=ip.src, src=ip.dst)/UDP(dport=ip[UDP].sport, sport=53)/DNS(id=ip[DNS].id, qr=1, ancount=1)/DNSRR(type='AAAA', rrname=name,rdata=ipaddr)
                    reps = IPv6(resp)
                    resp.show()
                    print(repr(resp))
                    send_to_tun(resp)
                    return 0
            key = "udp:%s:%s-%s:%s"%(ip.src, ip.sport, ip4dst, ip.dport)
            if key not in adrmap:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("0.0.0.0", udp_port))
                sock.settimeout(1.0)
                sock.connect((str(ip4dst), ip.dport))
                udp_port = udp_port + 1
                adrmap[key] = sock
                sockmap[sock] = (ip.src, ip.sport, ip.dst, ip.dport, ip.nh)
                print("Opened sock:", sock)
                input = input + [sock]
            else:
                sock = adrmap[key]

            print("=== NAT64 UDP Sending:", bytes(ip[UDP]), sock, "===")
            sock.send(bytes(ip[UDP]))
        elif ip.nh == PROTO_TCP:
            key = "tcp:%s:%s-%s:%s"%(ip.src, ip.sport, ip4dst, ip.dport)
            if key not in adrmap:
                print("TCP opening ", ip4dst, ip.dport)
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("0.0.0.0", tcp_port))
                sock.settimeout(1.0)
                sock.connect((str(ip4dst), ip.dport))
                tcp_port = tcp_port + 1
                adrmap[key] = sock
                sockmap[sock] = (ip.src, ip.sport, ip.dst, ip.dport, ip.nh, {'seq':4711, 'ack':0, 'state':TCP_INIT})
                print("Opened sock:", sock)
                input = input + [sock]
            else:
                sock = adrmap[key]
            handle_tcp_state_tosock(ip, sock)


def nat64_recv(sock, data, addr):
    print("==== NAT64 Received; ", data, addr, "====")
    t = sockmap[sock]
    ipv6 = None
    proto = t[4]
    if proto == PROTO_UDP:
        ipv6 = IPv6(IPv6(src = t[2], dst = t[0])/UDP(sport=t[3], dport=t[1])/raw(data))
    elif proto == PROTO_TCP:
        ipv6 = IPv6(update_tcp_state_totun(t, data))
        print("NAT64 TCP to tun")
        ipv6.show()
    send_to_tun(ipv6)

def recv_from_tun(packet):
    ip = IPv6(packet)
    if ip.nh != PROTO_ICMP:
        print(">> RECV from TUN: ")
        ip.show()
        # do nat64 and send
        nat64_send(ip)

# Only for OS-X for now.
# Should be easy to adapt for linux also.
tun = os.open("/dev/tun12", os.O_RDWR)
os.system("ifconfig tun12 inet6 64:ff9b::1/96 up")
os.system("sysctl -w net.inet.ip.forwarding=1");

input = [tun]

tunsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_address = ('localhost', 8888)
print(sys.stderr, 'starting up on %s port %s' % server_address)
tunsock.bind(server_address)
tunsock.listen(1)
print("Accepting connections...")
tunconnection, client_address = tunsock.accept()
print("Connection from:", client_address)
tunconnection.send(b"hello.")
input = input + [tunconnection]
try:
    while 1:
        print("Input:", input)
        inputready,outputready,exceptready = select(input,[],input)
        for r in inputready:
            if r == tun:
                packet = os.read(tun, 4000)
                recv_from_tun(packet)
            elif r == tunconnection:
                data = r.recv(4000)
                if not data:
                    print(">> Socket shutdown - remove socket!")
                    sock_remove(r)
                else:
                    recv_from_tun(data)
            else:
                # avoid getting too big packet in over socket. To avoid IP fragmentation.
                max = 1200
                st = sockmap[r]
                if(len(st) > 5):
                    tcpState = st[5]
                    print("Recv:", tcpState)
                    max = tcpState['window']
                data, addr = r.recvfrom(max)
                if not data:
                    print(">> Socket shutdown - remove socket!")
                    sock_remove(r)
                else:
                    nat64_recv(r, data, addr)
        for r in exceptready:
            print(r)
except KeyboardInterrupt:
    print("Stopped by user.")

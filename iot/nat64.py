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
from struct import *
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
PROTOS = {PROTO_UDP: "udp", PROTO_TCP: "tcp", PROTO_ICMP: "icmp"}

sockmap = {}
adrmap = {}
input = []
tun = None
tunconnection = None
prefix = ipaddress.ip_address("64:ff9b::0").packed

def genkey(proto, src, dest, sport, dport):
    return "%s:%s:%s-%s:%s"%(PROTOS[proto], src, sport, dest, dport)

def add_socket(socket):
    global input
    if socket is not None and socket not in input:
        input = input + [socket]

class NAT64State:

    def __init__(self, src, dst, sport, dport, proto):
        self.dst = dst
        self.src = src
        self.sport = sport
        self.dport = dport
        self.proto = proto
        self.maxreceive = 1200
        self.key = genkey(proto, src, dst, sport, dport)

class UDP64State(NAT64State):
    udp_port = 15000

    def __init__(self, src, dst, sport, dport):
        super(TCP64State, self).__init__(src, dst, sport, dport, PROTO_UDP)
        ip4dst = ipaddress.ip_address(ipaddress.ip_address(dst).packed[-4:])
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", UDP64State.udp_port))
        sock.settimeout(1.0)
        sock.connect((str(ip4dst), dport))
        self.sock = sock
        UDP64State.udp_port = UDP64State.udp_port + 1

    def receive(self):
        print("UDP: socket receive:", self)
        data, addr = self.sock.recvfrom(self.maxreceive)
        if not data:
            sock_remove(self.sock)
            return None
        ipv6 = IPv6(IPv6(src = self.dst, dst = self.src)/UDP(sport=self.dport, dport=self.sport)/raw(data))
        send_to_tun(ipv6)
        return data

    def __repr__(self):
        return "UDP - src:%s:%d dst:%s:%d state:%d seq:%d ack:%d"%(self.src, self.sport, self.dst, self.dport)

class TCP64State(NAT64State):
    sock: None
    tcp_port = 15000

    def __init__(self, src, dst, sport, dport):
        super(TCP64State, self).__init__(src, dst, sport, dport, PROTO_TCP)
        ip4dst = ipaddress.ip_address(ipaddress.ip_address(dst).packed[-4:])
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", TCP64State.tcp_port))
        sock.settimeout(1.0)
        sock.connect((str(ip4dst), dport))
        self.sock = sock
        self.state = TCP_INIT
        self.ack = 0
        self.seq = 4711
        self.window = 1200
        self.mss = 1200
        print("TCP opening ", ip4dst, dport)
        print("Opened sock:", sock)
        TCP64State.tcp_port = TCP64State.tcp_port + 1

    # Handle TCP state - forward data from socket to tun.
    def update_tcp_state_totun(self, data):
        print(self)
        ipv6 = IPv6(src = self.dst, dst = self.src)/TCP(sport=self.dport, dport=self.sport, flags="PA") / raw(data)
        # Update with the current seq and ack.
        ipv6.seq = self.seq
        ipv6.ack = self.ack
        return ipv6

    # receive packet and send to tun.
    def receive(self):
        global input
        if self.sock is None:
            return None
        print("TCP socket receive:", self)
        maxread = max(self.maxreceive, self.mss)
        data, addr = self.sock.recvfrom(maxread)
        print("received from socket: ", data, not data)
        input.remove(self.sock)
        print("Input:", input)
        if not data:
            print("Socket closing... TCP state kept to handle TUN close.")
            self.sock.close()
            self.sock = None
            print("TCP: FIN over socket received - sending FIN over tun.", self)
            ipv6 = IPv6(IPv6(src=self.dst, dst=self.src)/TCP(sport=self.dport, dport=self.sport, flags="F", seq=self.seq, ack=self.ack))
            ipv6.show()
            self.last_to_tun = ipv6
            send_to_tun(bytes(ipv6))
            return None
        ipv6 = IPv6(self.update_tcp_state_totun(data))
        print("NAT64 TCP to tun (max:", maxread)
        ipv6.show()
        self.last_to_tun = ipv6
        send_to_tun(ipv6)
        return data

    # Handle TCP state - TCP from ipv6 tun toward IPv4 socket
    def handle_tcp_state_tosock(self, ip):
        global tun, input
        print("=== NAT64 TCP sock-send:", ip.flags, self.sock, "===")
        if ip.flags.S:
            # Use Window size to control max segment?
            self.sock.setsockopt(socket.SOL_TCP, socket.TCP_MAXSEG, 1000)
            print("Maxseg:", self.sock.getsockopt(socket.SOL_TCP, socket.TCP_MAXSEG))
            self.ack = ip.seq + 1
            # We are established...
            self.state = TCP_ESTABLISHED
            self.window = ip[TCP].window
            # Get the MSS of the options
            for k, v in ip[TCP].options:
                if k == 'MSS':
                    self.mss = v
            print("TCP State:", self)
            print("SYN received - send SYNACK (tun)! ")
            ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="SA", seq=self.seq, ack=self.ack)
            ipv6.show()
            send_to_tun(bytes(IPv6(ipv6)))
        #    sock.send(ip.load)
        elif ip.flags.FA or ip.flags.F:
            self.state = TCP_FIN_CLOSE_WAIT
            self.ack = ip.seq + 1
            self.timeout = time.time()
            print("TCP: FIN received - sending FIN.", self)
            ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="FA", seq=self.seq, ack=self.ack)
            ipv6.show()
            send_to_tun(bytes(IPv6(ipv6)))
            # Clean out this socket?
        elif ip.flags.A or ip.flags.AP:
            if self.state == TCP_ESTABLISHED:
                if not hasattr(ip,'load'):
                    print("ESTABLISHED or ACK from other side. seq:", ip.seq, "ack:", ip.ack)
                    self.seq = ip.ack
                else:
                    # ACK immediately - we assume that we get data from other side soon...
                    print("TCP: received ", len(ip.load), "seq:", ip.seq, "ack:", ip.ack)
                    self.ack = ip.seq + len(ip.load)
                    # We should also handle the sanity checks for the ACK
                    self.seq = ip.ack
                    ipv6 = IPv6(src=ip.dst, dst=ip.src)/TCP(sport=ip.dport, dport=ip.sport, flags="A", seq=self.seq, ack=self.ack)
                    ipv6 = IPv6(ipv6)
                    print("TCP Sending ACK (tun)!", "State", self)
                    ipv6.show()
                    send_to_tun(bytes(ipv6))
            print("Adding back socket...")
            add_socket(self.sock)
        if hasattr(ip, 'load'):
            print("TCP: Sending over socket - Payload:", ip.load)
            self.sock.send(ip.load)


    def __repr__(self):
        return "TCP - src:%s:%d dst:%s:%d state:%d seq:%d ack:%d mss:%d"%(self.src, self.sport, self.dst, self.dport, self.state,
                                                     self.seq, self.ack, self.mss)

# Remove the state for this specific socket
def sock_remove(socket):
    todel = None
    sockmap.pop(socket)
    for k in adrmap:
        if adrmap[k] == socket:
            todel = k
    adrmap.pop(todel)
    if socket in input:
        input.remove(socket)
        socket.close()

def send_to_tun(ipv6):
    if ipv6 is not None:
        data = bytes(ipv6)
        print("Writing to tun:", len(data))
        if tun is not None:
            os.write(tun, data)
        if tunconnection is not None:
            data = struct.pack("!HH", len(data) + 4, 2) + data
            tunconnection.send(data)


def nat64_send(ip):
    global input, udp_port, tcp_port
    # NAT64 translation
    dst = ipaddress.ip_address(ip.dst)
    if dst.packed[0:4] == prefix[0:4]:
        ip4dst = ipaddress.ip_address(dst.packed[-4:])
        print("NAT64 dst:", ip4dst, ip.nh)
        key = genkey(ip.nh, ip.src, ip4dst, ip.sport, ip.dport)
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
                    resp = IPv6(dst=ip.src, src=ip.dst)/UDP(dport=ip[UDP].sport, sport=53)/DNS(id=ip[DNS].id, qr=1, ancount=1)/DNSRR(type='AAAA', rrname=name,rdata=ipaddr, ttl=3600)
                    reps = IPv6(resp)
                    resp.show()
                    print(repr(resp))
                    send_to_tun(resp)
                    return 0
            if key not in adrmap:
                udp = UDP64State(ip.src, ip.dst, ip.sport, ip.dport)
                adrmap[key] = udp.sock
                sockmap[udp.sock] = udp
                print("Opened sock:", udp.sock)
                add_socket(udp.sock)
                sock = udp.sock
            else:
                sock = adrmap[key]

            print("=== NAT64 UDP Sending:", bytes(ip[UDP]), sock, "===")
            sock.send(bytes(ip[UDP]))
        elif ip.nh == PROTO_TCP:
            if key not in adrmap:
                tcp = TCP64State(ip.src, ip.dst, ip.sport, ip.dport)
                adrmap[key] = tcp.sock
                sockmap[tcp.sock] = tcp
                add_socket(tcp.sock)
                sock = tcp.sock
            else:
                sock = adrmap[key]
            tcp = sockmap[sock]
            tcp.handle_tcp_state_tosock(ip)

def recv_from_tun(packet):
    ip = IPv6(packet)
    if ip.nh != PROTO_ICMP:
        print(">> RECV from TUN: ")
        ip.show()
        # do nat64 and send
        nat64_send(ip)

def recv_from_tuntcp(packet):
    plen, type = unpack("!HH", packet[0:4])
    print("Len:", plen, "Type", type)
    # Assume that we got the whole packet...
    # In the future we should check - and wait for more if not complete.
    recv_from_tun(packet[4:])

# Only for OS-X for now.
# Should be easy to adapt for linux also.
tun = os.open("/dev/tun12", os.O_RDWR)
os.system("ifconfig tun12 inet6 64:ff9b::1/96 up")
os.system("sysctl -w net.inet.ip.forwarding=1");

input = [tun]
tunconnection = None
tunsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_address = ('localhost', 8888)
print(sys.stderr, 'starting up on %s port %s' % server_address)
tunsock.bind(server_address)
tunsock.listen(1)
print("Accepting connections over TCP on 8888 (only one at a time).")
input = input + [tunsock]
try:
    while 1:
        print("Input:", input)
        inputready,outputready,exceptready = select(input,[],input)
        for r in inputready:
            if r == tun:
                packet = os.read(tun, 4000)
                recv_from_tun(packet)
            # Something
            elif r == tunconnection:
                data = r.recv(4000)
                if not data:
                    print(">> TUN Socket shutdown - remove socket!")
                    sock_remove(r)
                else:
                    recv_from_tuntcp(data)
            # Something on the accept socket!?
            elif r == tunsock:
                tunconnection, client_address = tunsock.accept()
                print("Connection from:", client_address)
                tunconnection.send(b"hello.")
                input = input + [tunconnection]
                input.remove(tunsock)
            # Otherwise it is on a NAT64:ed socket
            else:
                st = sockmap[r]
                # Receive will receive and send back over tun.
                data = st.receive()
                if not data:
                    print(">> Socket shutdown - remove socket?!")
        for r in exceptready:
            print(r)
except KeyboardInterrupt:
    print("Stopped by user.")

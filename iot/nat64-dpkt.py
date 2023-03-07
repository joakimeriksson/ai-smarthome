#!/bin/python3
#
# Copyright (c) 2019-2022 Joakim Eriksson
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

import ipaddress, os, platform, select, time
import socket, logging, struct, fcntl
import dpkt

# TCP State machine
TCP_INIT = 1 # Same as LISTEN... more or less...
TCP_SYN_RECEIVED = 2
TCP_SYN_SENT = 3
TCP_ESTABLISHED = 4
TCP_FIN_WAIT = 5
TCP_FIN_CLOSE_WAIT = 6

TYPE_HANDSHAKE_MAC_GET   = 1
TYPE_HANDSHAKE_MAC_SET   = 2
TYPE_RAW_IPV6            = 6

# Protocol numbers
PROTO_UDP = 17
PROTO_TCP = 6
PROTO_ICMP = 58
PROTOS = {PROTO_UDP: "udp", PROTO_TCP: "tcp", PROTO_ICMP: "icmp"}

MAC = b'\xca\xba\x88\x88\x00\xaa\xbb\x01'
macaddr = 1
sockmap = {}
adrmap = {}
input = []
tuntcp = []
tun = None
tunconnection = None
prefix = ipaddress.ip_address("64:ff9b::0").packed

log = logging.getLogger('nat64')
log.setLevel(logging.DEBUG)

# create log formatter and add it to the handlers
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
ch = logging.StreamHandler()
ch.setFormatter(formatter)
log.addHandler(ch)

def genkey(proto, src, dest, sport, dport):
    return "%s:%s:%s-%s:%s"%(PROTOS[proto], src, sport, dest, dport)

def get_next_mac():
    global MAC, macaddr
    MAC = MAC[:-1] + bytes([macaddr])
    macaddr = macaddr + 1
    return MAC

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
        super(UDP64State, self).__init__(src, dst, sport, dport, PROTO_UDP)
        ip4dst = ipaddress.ip_address(ipaddress.ip_address(dst).packed[-4:])
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", UDP64State.udp_port))
        sock.settimeout(1.0)
        sock.connect((str(ip4dst), dport))
        self.sock = sock
        UDP64State.udp_port = UDP64State.udp_port + 1

    def udpip(self, data = None):
        udp = dpkt.udp.UDP()
        udp.dport, udp.sport = self.sport, self.dport
        ip = dpkt.ip6.IP6()
        ip.src = self.dst
        ip.dst = self.src
        ip.hlim = 64
        ip.nxt = PROTO_UDP
        if data is not None:
            udp.data = data
        ip.data = udp
        ip.plen = ip.data.ulen = len(ip.data)
        return ip

    def receive(self):
        log.debug("UDP: socket receive: %s" % repr(self))
        data, addr = self.sock.recvfrom(self.maxreceive)
        if not data:
            log.debug("UDP Removing socket. No Data.")
            sock_remove(self.sock)
            return None
        ipv6 = self.udpip(data)
#        ipv6 = IPv6(IPv6(src = self.dst, dst = self.src)/UDP(sport=self.dport, dport=self.sport)/raw(data))
        log.debug("send to tun %s", repr(ipv6))
        send_to_tun(ipv6)
        return data

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
        log.debug("TCP opening %s %d %s" %(str(ip4dst), dport, repr(sock)))
        TCP64State.tcp_port = TCP64State.tcp_port + 1

    # TCP packets are more or less always for sending back over tun.
    def tcp(self, flags):
        rep = dpkt.tcp.TCP()
        rep.win = 8192
        rep.dport, rep.sport = self.sport, self.dport
        rep.flags = flags
        rep.seq = self.seq
        rep.ack = self.ack
        return rep

    def tcp_reply(self, ip, flags):
        # create a reply.
        ip.dst, ip.src = ip.src, ip.dst
        ip.data = self.tcp(flags)
        ip.plen = ip.data.ulen = len(ip.data)

    def tcpip(self, flags, data = None):
        tcp = self.tcp(flags)
        ip = dpkt.ip6.IP6()
        ip.src = self.dst
        ip.dst = self.src
        ip.hlim = 64
        ip.nxt = PROTO_TCP
        if data is not None:
            tcp.data = data
        ip.data = tcp
        ip.plen = ip.data.ulen = len(ip.data)
        return ip

    # Handle TCP state - forward data from socket to tun.
    def update_tcp_state_totun(self, data):
        ip6 = self.tcpip(dpkt.tcp.TH_ACK | dpkt.tcp.TH_PUSH, data)
        log.debug("IP6: %s" % repr(ip6))
        return ip6

    # receive packet and send to tun.
    def receive(self):
        global input
        if self.sock is None:
            return None
        print("MSS:", self.mss)
        log.debug("TCP socket receive.")
        maxread = min(self.maxreceive, self.mss)
        data, addr = self.sock.recvfrom(maxread)
        input.remove(self.sock)
        if not data:
            log.debug("Socket closing... TCP state kept to handle TUN close.")
            self.sock.close()
            input.remove(self.sock)
            self.sock = None
            log.debug("TCP: FIN over socket received - sending FIN over tun.")
            ip6 = self.tcpip(dpkt.tcp.TH_FIN)
            log.debug("FIN IP6: %s" % repr(ip6))
            self.last_to_tun = ip6
            send_to_tun(ip6)
            return None
        log.debug("NAT64 TCP to tun max: %d" % maxread)
        ipv6 = self.update_tcp_state_totun(data)
        self.last_to_tun = ipv6
        send_to_tun(ipv6)
        return data

    # Handle TCP state - TCP from ipv6 tun toward IPv4 socket
    def handle_tcp_state_tosock(self, ip):
        tcp = ip.data
        global tun, input
        log.debug("=== NAT64 TCP sock-send: %d %s."%(tcp.flags, self.sock))
        if self.sock is None:
            log.warning("Socket already closed.")
            return
        if tcp.flags & dpkt.tcp.TH_SYN > 0:
            # Use Window size to control max segment?
            self.sock.setsockopt(socket.SOL_TCP, socket.TCP_MAXSEG, 1000)
            log.debug("Maxseg: %d" % self.sock.getsockopt(socket.SOL_TCP, socket.TCP_MAXSEG))
            self.ack = tcp.seq + 1
            # We are established...
            self.state = TCP_ESTABLISHED
            self.window = tcp.win
            # Get the MSS of the options
            opts = dpkt.tcp.parse_opts(tcp.opts)
            for k, v in opts:
                if k == dpkt.tcp.TCP_OPT_MSS:
                    log.debug("MSS:", v)
                    self.mss, = struct.unpack("!H", v)
                    log.debug("MSS:", self.mss)
            log.debug("TCP State: %d SYN received." % self.mss)

            self.tcp_reply(ip, dpkt.tcp.TH_SYN | dpkt.tcp.TH_ACK)

            log.debug("IP: %s" % repr(ip))
            send_to_tun(ip)
        #    sock.send(ip.load)
        elif tcp.flags & dpkt.tcp.TH_FIN:
            self.state = TCP_FIN_CLOSE_WAIT
            self.ack = tcp.seq + 1
            self.timeout = time.time()
            log.debug("TCP: FIN received - sending FIN. %s" % self)
            self.tcp_reply(ip, dpkt.tcp.TH_FIN | dpkt.tcp.TH_ACK)
            log.debug("IP: %s" % repr(ip))
            send_to_tun(ip)
            # Clean out this socket?
        elif tcp.flags & dpkt.tcp.TH_ACK:
            if self.state == TCP_ESTABLISHED:
                if len(tcp.data) == 0:
                    log.debug("ESTABLISHED or ACK from other side. seq: %d  ack: %d" % (tcp.seq, tcp.ack))
                    self.seq = tcp.ack
                else:
                    # ACK immediately - we assume that we get data from other side soon...
                    log.debug("TCP: received %d seq: %d  ack%d ." % (len(tcp.data), tcp.seq, tcp.ack))
                    self.ack = tcp.seq + len(tcp.data)
                    # We should also handle the sanity checks for the ACK
                    self.seq = tcp.ack
                    self.tcp_reply(ip, dpkt.tcp.TH_ACK)
                    log.debug("IP: %s" % repr(ip))

                    send_to_tun(ip)
            add_socket(self.sock)
        if len(tcp.data) > 0:
            self.sock.send(tcp.data)

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

def send_to_tuntcp(socket, ipv6):
    if len(tuntcp) > 0:
        data = bytes(ipv6)
        data = struct.pack("!HH", len(data) + 4, TYPE_RAW_IPV6) + data
        for tunconn in tuntcp:
            if tunconn != socket:
                tunconn.send(data)

def send_to_tun(ipv6):
    if ipv6 is not None:
        data = bytes(ipv6)
        if tun is not None:
            os.write(tun, data)
        if len(tuntcp) > 0:
            send_to_tuntcp(None, ipv6)

def nat64_send(ip6, packet):
    global input, udp_port, tcp_port
    # NAT64 translation
    if ip6.dst[0:4] == prefix[0:4]:
        ip4dst = ipaddress.ip_address(ip6.dst[-4:])
        log.debug("NAT64 dst: %s %d." % (ip4dst, ip6.nxt))
        if ip6.nxt == PROTO_UDP:
            udp = ip6.data
            key = genkey(ip6.nxt, ip6.src, ip4dst, udp.sport, udp.dport)
            if udp.dport == 53:
                dns = dpkt.dns.DNS(udp.data)
                log.debug("*** DNS *** op:%s qd:%s" % (dns.opcode, dns.qd))
                if dns.opcode == 0 and len(dns.qd) > 0:
                    name = dns.qd[0].name
                    log.debug("DNS name - lookup: %s" % name)
                    addr = socket.gethostbyname(name)
                    dns64addr = ipaddress.ip_address(prefix[0:16-4] +
                                                     ipaddress.ip_address(addr).packed)
                    log.debug("%s => %s  %s" % (name , addr, str(dns64addr)))
                    ipaddr = dns64addr
                    dns.op = 0
                    dns.qr = 1
                    dns.rd = 1
                    dns.rcode = dpkt.dns.DNS_RCODE_NOERR
                    arr = dpkt.dns.DNS.RR()
                    arr.cls = dpkt.dns.DNS_IN
                    arr.type = dpkt.dns.DNS_AAAA
                    arr.name = name
                    arr.ttl = 3600
                    arr.ip6 = dns64addr.packed
                    dns.qd = []
                    dns.an.append(arr)
                    udp.sport, udp.dport = udp.dport, udp.sport
                    udp.sum = 0
                    ip6.dst, ip6.src = ip6.src,ip6.dst
                    udp.data = dns
                    udp.ulen = len(udp)
                    log.debug("UDP - udplen:%d" % len(udp))
                    ip6.data = udp
                    ip6.plen = len(udp)
                    log.debug("IP6 - iplen:%d" % len(ip6))
                    resp = ip6
                    send_to_tun(resp)
                    return 0
            if key not in adrmap:
                udpd = UDP64State(ip6.src, ip6.dst, udp.sport, udp.dport)
                adrmap[key] = udpd.sock
                sockmap[udpd.sock] = udpd
                log.debug("Opened sock: %s" % udpd.sock)
                add_socket(udpd.sock)
                sock = udpd.sock
            else:
                sock = adrmap[key]
#            sock.send(bytes(ip[UDP]))
            sock.send(udp.data)
        elif ip6.nxt == PROTO_TCP:
            tcp = ip6.data
            key = genkey(ip6.nxt, ip6.src, ip4dst, tcp.sport, tcp.dport)
            if key not in adrmap:
                tcpd = TCP64State(ip6.src, ip6.dst, tcp.sport, tcp.dport)
                adrmap[key] = tcpd.sock
                sockmap[tcpd.sock] = tcpd
                add_socket(tcpd.sock)
                sock = tcpd.sock
            else:
                sock = adrmap[key]
            tcpd = sockmap[sock]
            tcpd.handle_tcp_state_tosock(ip6)

# Tun is reception from local machine - not from native or NBR.
def recv_from_tun(packet):
    ip6 = dpkt.ip6.IP6()
    ip6.unpack(packet)
    log.debug("DPKT IPv6: SRC:%s DST:%s NH:%s data:%s" % (ip6.src, ip6.dst, ip6.nxt, ip6.data))
    if ip6.nxt == PROTO_UDP or ip6.nxt == PROTO_TCP:
        log.debug(">> RECV from TUN: ")
        # do nat64 and send
        nat64_send(ip6, packet)

# TunTcp from NBR or native platform.
def recv_from_tuntcp(socket, packet):
    plen, type = struct.unpack("!HH", packet[0:4])
    log.debug("Len: %d Type %d" % (plen, type))
    # Assume that we got the whole packet...
    # In the future we should check - and wait for more if not complete.
    if type == TYPE_HANDSHAKE_MAC_GET:
        data = struct.pack("!HH", 8 + 4, TYPE_HANDSHAKE_MAC_SET) + get_next_mac()
        socket.send(data)
    elif type == TYPE_RAW_IPV6:
        ip = dpkt.ip6.IP6(packet[4:])
        # Not matching prefix... Send to all tuntcp except "socket" to get things out to other nodes.
        if ip.dst[0:4] != prefix[0:4]:
            log.debug("Not matching prefix - send back to all. %d" % len(tuntcp))
            print("IP: %s" % repr(ip))
            send_to_tuntcp(socket, packet[4:])
        else:
            recv_from_tun(packet[4:])

# Only for OS-X for now.
# Should be easy to adapt for linux also.
if platform.system() == 'Darwin':
    tun = os.open("/dev/tun12", os.O_RDWR)
    os.system("ifconfig tun12 inet6 64:ff9b::1/96 up")
    os.system("sysctl -w net.inet.ip.forwarding=1");
elif platform.system() == 'Linux':
    TUNSETIFF = 0x400454ca
    IFF_TUN = 0x0001
    IFF_NO_PI = 0x1000
    tun = os.open("/dev/net/tun", os.O_RDWR)
    ifr = struct.pack('16sH', b'nat64', IFF_TUN | IFF_NO_PI)
    fcntl.ioctl(tun, TUNSETIFF, ifr)
    os.system("ifconfig nat64 inet `hostname` up")
    os.system("ifconfig nat64 add 64:ff9b::1/96")

input = [tun]
port = 18888
#input = []
tunconnection = None
tunsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_address = ('localhost', port)
tunsock.bind(server_address)
tunsock.listen(1)
log.info("Accepting tunctp connections over TCP on " + str(port) + ".")
input = input + [tunsock]
try:
    while 1:
        inputready,outputready,exceptready = select.select(input,[],input)
        for r in inputready:
            if r == tun:
                packet = os.read(tun, 4000)
                recv_from_tun(packet)
            # Something from the tuntcp connections.
            elif r in tuntcp:
                data = r.recv(4000)
                if not data:
                    log.debug(">> TUNTCP Socket shutdown - removing socket!")
                    input.remove(r)
                    tuntcp.remove(r)
                else:
                    recv_from_tuntcp(r, data)
            # Something on the accept socket!?
            elif r == tunsock:
                tunconnection, client_address = tunsock.accept()
                log.debug("Connection from: %s", client_address)
                input = input + [tunconnection]
                tuntcp = tuntcp + [tunconnection]
            # Otherwise it is on a NAT64:ed socket
            else:
                st = sockmap[r]
                # Receive will receive and send back over tun.
                data = st.receive()
                if not data:
                    log.debug(">> Socket shutdown - remove socket?!")
        for r in exceptready:
            print(r)
except KeyboardInterrupt:
    log.error("Stopped by user.")

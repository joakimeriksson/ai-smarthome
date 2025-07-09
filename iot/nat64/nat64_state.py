
import ipaddress, socket, logging, struct, time
import dpkt

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

def genkey(proto, src, dest, sport, dport):
    return "%s:%s:%s-%s:%s"%(PROTOS[proto], src, sport, dest, dport)

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

    def __init__(self, src, dst, sport, dport, server):
        super(UDP64State, self).__init__(src, dst, sport, dport, PROTO_UDP)
        self.server = server
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
        self.server.log.debug(f"UDP: socket receive: src={ipaddress.ip_address(self.src)} dst={ipaddress.ip_address(self.dst)}")
        data, addr = self.sock.recvfrom(self.maxreceive)
        if not data:
            self.server.log.debug("UDP Removing socket. No Data.")
            self.server.sock_remove(self.sock)
            return None
        ipv6 = self.udpip(data)
        self.server.log.debug(f"send to tun src={ipaddress.ip_address(ipv6.src)} dst={ipaddress.ip_address(ipv6.dst)}")
        self.server.send_to_tun(ipv6)
        return data

class TCP64State(NAT64State):
    sock: None
    tcp_port = 15000

    def __init__(self, src, dst, sport, dport, server):
        super(TCP64State, self).__init__(src, dst, sport, dport, PROTO_TCP)
        self.server = server
        ip4dst = ipaddress.ip_address(ipaddress.ip_address(dst).packed[-4:])
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", TCP64State.tcp_port))
        sock.settimeout(1.0)
        sock.connect((str(ip4dst), dport))
        self.server.log.debug(f"TCP socket connected to {str(ip4dst)}:{dport}")
        self.sock = sock
        self.state = TCP_INIT
        self.ack = 0
        self.seq = 4711
        self.window = 1200
        self.mss = 1200
        self.server.log.debug("TCP opening %s %d %s" %(str(ip4dst), dport, repr(sock)))
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
        self.server.log.debug(f"IP6: src={ipaddress.ip_address(ip6.src)} dst={ipaddress.ip_address(ip6.dst)}")
        return ip6

    # receive packet and send to tun.
    def receive(self):
        if self.sock is None:
            return None
        print("MSS:", self.mss)
        self.server.log.debug("TCP socket receive.")
        maxread = min(self.maxreceive, self.mss)
        data, addr = self.sock.recvfrom(maxread)
        if not data:
            self.server.log.debug("Socket closing... TCP state kept to handle TUN close.")
            self.sock.close()
            self.server.input.remove(self.sock)
            self.server.sock_remove(self.sock) # Call sock_remove for cleanup
            self.sock = None
            self.server.log.debug("TCP: FIN over socket received - sending FIN over tun.")
            ip6 = self.tcpip(dpkt.tcp.TH_FIN)
            self.server.log.debug(f"FIN IP6: src={ipaddress.ip_address(ip6.src)} dst={ipaddress.ip_address(ip6.dst)}")
            self.last_to_tun = ip6
            self.server.send_to_tun(ip6)
            return None
        self.server.log.debug("NAT64 TCP to tun max: %d" % maxread)
        ipv6 = self.update_tcp_state_totun(data)
        self.last_to_tun = ipv6
        self.server.send_to_tun(ipv6)
        return data

    # Handle TCP state - TCP from ipv6 tun toward IPv4 socket
    def handle_tcp_state_tosock(self, ip):
        tcp = ip.data
        self.server.log.debug(f"=== NAT64 TCP sock-send: flags={tcp.flags} sock={self.sock}")
        
        if self.sock is None:
            self.server.log.warning("Socket already closed.")
            return
        maxseg_val = self.sock.getsockopt(socket.SOL_TCP, socket.TCP_MAXSEG)
        self.server.log.debug(f"TCP: flags={tcp.flags} type={type(tcp)} data_type={type(tcp.data)} data_len={len(tcp.data) if hasattr(tcp, 'data') else 'N/A'} maxseg={maxseg_val}")
        if tcp.flags & dpkt.tcp.TH_SYN > 0:
            # Use Window size to control max segment?
            self.sock.setsockopt(socket.SOL_TCP, socket.TCP_MAXSEG, 1000)
            
            self.ack = tcp.seq + 1
            # We are established...
            self.state = TCP_ESTABLISHED
            self.window = tcp.win
            # Get the MSS of the options
            opts = dpkt.tcp.parse_opts(tcp.opts)
            for k, v in opts:
                if k == dpkt.tcp.TCP_OPT_MSS:
                    
                    self.mss, = struct.unpack("!H", v)
                    self.server.log.debug(f"MSS: {self.mss}")
            self.server.log.debug(f"TCP State: {self.mss} SYN received.")

            self.tcp_reply(ip, dpkt.tcp.TH_SYN | dpkt.tcp.TH_ACK)

            self.server.log.debug(f"IP: src={ipaddress.ip_address(ip.src)} dst={ipaddress.ip_address(ip.dst)}")
            self.server.send_to_tun(ip)
        #    sock.send(ip.load)
        elif tcp.flags & dpkt.tcp.TH_FIN:
            self.state = TCP_FIN_CLOSE_WAIT
            self.ack = tcp.seq + 1
            self.timeout = time.time()
            self.server.log.debug(f"TCP: FIN received from client - sending FIN-ACK to client and FIN to IPv4 server. src={ipaddress.ip_address(self.src)} dst={ipaddress.ip_address(self.dst)}")
            self.tcp_reply(ip, dpkt.tcp.TH_FIN | dpkt.tcp.TH_ACK)
            self.server.log.debug(f"IP: src={ipaddress.ip_address(ip.src)} dst={ipaddress.ip_address(ip.dst)}")
            self.server.send_to_tun(ip)
            # Send FIN to the IPv4 server
            if self.sock:
                self.sock.shutdown(socket.SHUT_WR)
                self.state = TCP_FIN_WAIT # Transition to FIN_WAIT state
        elif tcp.flags & dpkt.tcp.TH_ACK:
            if self.state == TCP_ESTABLISHED:
                if len(tcp.data) == 0:
                    self.server.log.debug("ESTABLISHED or ACK from other side. seq: %d  ack: %d" % (tcp.seq, tcp.ack))
                    self.seq = tcp.ack
                else:
                    # ACK immediately - we assume that we get data from other side soon...
                    self.server.log.debug("TCP: received %d seq: %d  ack%d ." % (len(tcp.data), tcp.seq, tcp.ack))
                    self.ack = tcp.seq + len(tcp.data)
                    # We should also handle the sanity checks for the ACK
                    self.seq = tcp.ack
                    self.tcp_reply(ip, dpkt.tcp.TH_ACK)
                    self.server.log.debug(f"IP: src={ipaddress.ip_address(ip.src)} dst={ipaddress.ip_address(ip.dst)}")

                    self.server.send_to_tun(ip)
            self.server.add_socket(self.sock)
        if len(tcp.data) > 0:
            self.server.log.debug(f"Sending {len(tcp.data)} bytes to IPv4 socket.")
            self.sock.send(tcp.data)

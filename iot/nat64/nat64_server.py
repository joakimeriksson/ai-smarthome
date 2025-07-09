
import logging, os, select, socket, struct, fcntl, platform, ipaddress, subprocess, time
from nat64_state import UDP64State, TCP64State
import dpkt

# Protocol numbers
PROTO_UDP = 17
PROTO_TCP = 6
PROTO_ICMP = 58
PROTOS = {PROTO_UDP: "udp", PROTO_TCP: "tcp", PROTO_ICMP: "icmp"}

class NAT64Server:
    def __init__(self, prefix="64:ff9b::0", tuntcp_port=18888, use_tun=True):
        self.setup_logging()
        self.prefix = ipaddress.ip_address(prefix).packed
        
        # All global variables become instance variables
        self.sockmap = {}
        self.adrmap = {}
        self.input = []
        self.tuntcp = []
        self.tun = None
        self.control_sock = None
        self.macaddr = 1
        self.MAC = b'\xca\xba\x88\x88\x00\xaa\xbb\x01'
        self.use_tun = use_tun

        # Setup network resources
        if self.use_tun:
            self.setup_tun_interface()
        else:
            self.log.info("TUN interface is disabled.")
        self.setup_tuntcp_listener(tuntcp_port)

    def setup_logging(self):
        self.log = logging.getLogger('nat64')
        self.log.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        ch = logging.StreamHandler()
        ch.setFormatter(formatter)
        self.log.addHandler(ch)

    def setup_tun_interface(self):
        self.log.info("Setting up TUN interface...")
        if platform.system() == 'Darwin':
            # The modern way to get a utun interface on macOS
            try:
                UTUN_CONTROL = "com.apple.net.utun_control"   # kernel control name
                UTUN_OPT_IFNAME = 2                           # getsockopt() -> b"utunN\0"
                # Constants from C headers
                AF_SYSTEM = 32
                CTLIOCGINFO = 0xc0644e03 # _IOWR('N', 3, struct ctl_info)

                # 1. Create a control socket
                control_sock = socket.socket(socket.AF_SYSTEM, socket.SOCK_DGRAM, socket.SYSPROTO_CONTROL)

                # 2) Connect — this triggers interface creation
                control_sock.connect(UTUN_CONTROL)

                # 3) Ask the kernel which name we actually got
                ifname = control_sock.getsockopt(socket.SYSPROTO_CONTROL,
                          UTUN_OPT_IFNAME, 128)
                ifname = ifname.rstrip(b"\0").decode()

                # Optional: make the fd non-blocking
                fcntl.fcntl(control_sock, fcntl.F_SETFL, os.O_NONBLOCK)
                
                self.log.info(f"Successfully created TUN interface: {ifname}")

                # Add a short delay to allow the interface to initialize before configuration.
                time.sleep(1)

                # 5. The file descriptor of the socket is our handle to the TUN device
                self.tun = control_sock.fileno()
                self.input.append(self.tun)
                self.control_sock = control_sock

                # Configure and VERIFY the new interface
                os.system("ifconfig " + ifname + " inet6 64:ff9b::1/96 up")
                os.system("sysctl -w net.inet.ip.forwarding=1")
                os.system("ifconfig " + ifname)
                os.system("sysctl net.inet.ip.forwarding")


            except Exception as e:
                self.log.error(f"Failed to create utun interface: {e}")
                self.log.error("On macOS, this script may need to be run with sudo.")
                self.tun = None
                return

        elif platform.system() == 'Linux':
            TUNSETIFF = 0x400454ca
            IFF_TUN = 0x0001
            IFF_NO_PI = 0x1000
            self.tun = os.open("/dev/net/tun", os.O_RDWR)
            ifr = struct.pack('16sH', b'nat64', IFF_TUN | IFF_NO_PI)
            fcntl.ioctl(self.tun, TUNSETIFF, ifr)
            os.system("ifconfig nat64 inet `hostname` up")
            os.system("ifconfig nat64 add 64:ff9b::1/96")
            self.input.append(self.tun)

    def setup_tuntcp_listener(self, port):
        self.tunsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_address = ('localhost', port)
        self.tunsock.bind(server_address)
        self.tunsock.listen(1)
        self.log.info("Accepting tunctp connections over TCP on " + str(port) + ".")
        self.input.append(self.tunsock)

    def get_next_mac(self):
        self.MAC = self.MAC[:-1] + bytes([self.macaddr])
        self.macaddr = self.macaddr + 1
        return self.MAC

    def send_to_tun(self, ipv6):
        if ipv6 is not None:
            data = bytes(ipv6)
            if self.tun is not None:
                if platform.system() == 'Darwin':
                    # Prepend AF_INET6 (28) as a 4-byte integer for utun interface
                    data = struct.pack('!I', 30) + data
                os.write(self.tun, data)
            if len(self.tuntcp) > 0:
                self.send_to_tuntcp(None, ipv6)

    def send_to_tuntcp(self, socket, ipv6):
        if len(self.tuntcp) > 0:
            data = bytes(ipv6)
            data = struct.pack("!HH", len(data) + 4, 6) + data # TYPE_RAW_IPV6 = 6
            for tunconn in self.tuntcp:
                if tunconn != socket:
                    tunconn.send(data)

    def add_socket(self, sock):
        if sock not in self.input:
            self.input.append(sock)

    def sock_remove(self, socket):
        todel = None
        self.sockmap.pop(socket)
        for k in self.adrmap:
            if self.adrmap[k] == socket:
                todel = k
        self.adrmap.pop(todel)
        if socket in self.input:
            self.input.remove(socket)
            socket.close()

    def nat64_send(self, ip6, packet):
        if ip6.dst[0:4] == self.prefix[0:4]:
            ip4dst = ipaddress.ip_address(ip6.dst[-4:])
            self.log.debug("NAT64 dst: %s %d." % (ip4dst, ip6.nxt))
            if ip6.nxt == 17: # UDP
                udp = ip6.data
                key = f"udp:{ip6.src}:{udp.sport}-{ip4dst}:{udp.dport}"
                if udp.dport == 53:
                    dns = dpkt.dns.DNS(udp.data)
                    if dns.opcode == 0 and len(dns.qd) > 0:
                        name = dns.qd[0].name
                        try:
                            addr = socket.gethostbyname(name)
                            dns64addr = ipaddress.ip_address(self.prefix[0:12] + ipaddress.ip_address(addr).packed)
                            self.log.debug("%s => %s  %s" % (name , addr, str(dns64addr)))
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
                            udp.sport, udp.dport = udp.dport, udp.sport # Swap ports for reply
                            udp.sum = 0 # Recalculate UDP checksum
                            ip6.dst, ip6.src = ip6.src,ip6.dst # Swap IPs for reply
                            udp.data = dns
                            udp.ulen = len(udp)
                            ip6.data = udp
                            ip6.plen = len(udp)
                            self.send_to_tun(ip6)
                        except socket.gaierror:
                            self.log.warning(f"Could not resolve {name}")
                        return
                if key not in self.adrmap:
                    udpd = UDP64State(ip6.src, ip6.dst, udp.sport, udp.dport, self)
                    self.adrmap[key] = udpd.sock
                    self.sockmap[udpd.sock] = udpd
                    self.add_socket(udpd.sock)
                    sock = udpd.sock
                else:
                    sock = self.adrmap[key]
                sock.send(udp.data)
            elif ip6.nxt == 6: # TCP
                tcp = ip6.data
                key = f"tcp:{ip6.src}:{tcp.sport}-{ip4dst}:{tcp.dport}"
                if key not in self.adrmap:
                    tcpd = TCP64State(ip6.src, ip6.dst, tcp.sport, tcp.dport, self)
                    self.adrmap[key] = tcpd.sock
                    self.sockmap[tcpd.sock] = tcpd
                    self.add_socket(tcpd.sock)
                    sock = tcpd.sock # Assign sock here
                else:
                    sock = self.adrmap[key]
                tcpd = self.sockmap[sock]
                tcpd.handle_tcp_state_tosock(ip6)

    def recv_from_tun(self, packet):
        # On macOS, utun interfaces prepend a 4-byte header (AF_INET6) to the packet.
        # We need to strip this header before passing to dpkt.
        if platform.system() == 'Darwin':
            packet = packet[4:]

        ip6 = dpkt.ip6.IP6()
        ip6.unpack(packet)
        # Convert byte strings to human-readable IPv6 addresses
        src_ip = ipaddress.ip_address(ip6.src)
        dst_ip = ipaddress.ip_address(ip6.dst)
        self.log.debug(f"DPKT IPv6: SRC:{src_ip} DST:{dst_ip} NH:{ip6.nxt} ({PROTOS.get(ip6.nxt, 'Unknown')})")
        if ip6.nxt in [17, 6]: # UDP or TCP
            self.log.debug(">> RECV from TUN: ")
            self.nat64_send(ip6, packet)

    def recv_from_tuntcp(self, r, data):
        plen, type = struct.unpack("!HH", data[0:4])
        if type == 1: # TYPE_HANDSHAKE_MAC_GET
            mac_data = struct.pack("!HH", 8 + 4, 2) + self.get_next_mac() # TYPE_HANDSHAKE_MAC_SET = 2
            r.send(mac_data)
        elif type == 6: # TYPE_RAW_IPV6
            ip = dpkt.ip6.IP6(data[4:plen])
            if ip.dst[0:4] != self.prefix[0:4]:
                self.send_to_tuntcp(r, data[4:])
            elif self.use_tun:
                self.recv_from_tun(data[4:])

    def run(self):
        self.log.info("NAT64 Server starting...")
        try:
            while True:
                inputready, _, exceptready = select.select(self.input, [], self.input)
                for r in inputready:
                    if self.use_tun and r == self.tun:
                        packet = os.read(self.tun, 4000)
                        self.recv_from_tun(packet)
                    elif r == self.tunsock:
                        tunconnection, client_address = self.tunsock.accept()
                        self.log.debug("Connection from: %s", client_address)
                        self.input.append(tunconnection)
                        self.tuntcp.append(tunconnection)
                    elif r in self.tuntcp:
                        data = r.recv(4000)
                        if not data:
                            self.log.debug(">> TUNTCP Socket shutdown - removing socket!")
                            self.input.remove(r)
                            self.tuntcp.remove(r)
                        else:
                            self.recv_from_tuntcp(r, data)
                    else:
                        st = self.sockmap.get(r)
                        if st:
                            st.receive()
                for r in exceptready:
                    self.log.error(f"Exception on {r}")
                    self.sock_remove(r)

        except KeyboardInterrupt:
            self.log.info("Shutting down.")
        finally:
            self.shutdown()

    def shutdown(self):
        for sock in self.input:
            try:
                sock.close()
            except:
                pass
        if self.tun:
            os.close(self.tun)

import argparse
from nat64_server import NAT64Server

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NAT64 Server")
    parser.add_argument("--no-tun", action="store_true", help="Disable TUN interface")
    args = parser.parse_args()

    server = NAT64Server(use_tun=not args.no_tun)
    server.run()

import java.net.NetworkInterface;
import java.net.MulticastSocket;
import java.net.Inet6Address;
import java.net.DatagramPacket;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;

public class TestSSDP {

    public static void main(String args[]) throws Exception {
       String ifname = "en0";
       if (args.length > 0) {
	   ifname = args[0];
       }
       NetworkInterface ni = NetworkInterface.getByName(ifname);
       System.out.println("Name:" + ni.getDisplayName() + " Index:" + ni.getIndex());
       System.out.println("Adr:" + ni.getInetAddresses().nextElement());
       MulticastSocket socket = new MulticastSocket(1900);
       InetAddress ipv6addr = Inet6Address.getByName("ff02::c%" + ifname);

       socket.joinGroup(new InetSocketAddress(ipv6addr, 1900), ni);

       String MSEARCH = "M-SEARCH * HTTP/1.1\nHost: 239.255.255.250:1900\nMan: \"ssdp:discover\"\nST: roku:ecp\n";
       byte[] sendData = MSEARCH.getBytes();
       DatagramPacket sendPacket = new DatagramPacket(sendData, sendData.length, ipv6addr, 1900);
       socket.send(sendPacket);
	
       byte[] buf = new byte[1000];
       DatagramPacket recv = new DatagramPacket(buf, buf.length);
       socket.receive(recv);
       System.out.println("Received packet of len:" + recv.getLength());
       for (int i = 0; i < recv.getLength(); i++) {
	   System.out.print("" + (char) buf[i]);
       }
       System.out.println("");

       socket.receive(recv);
       System.out.println("Received packet of len:" + recv.getLength());
       for (int i = 0; i < recv.getLength(); i++) {
	   System.out.print("" + (char) buf[i]);
       }
       System.out.println("");
       System.out.println("Adr:" + recv.getAddress());
    }
}

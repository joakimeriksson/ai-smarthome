#
# Ping local gateway and print the latency / response time
# (c) 2024 ChatGPT and Joakim Eriksson
#
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import subprocess
import re
import time

# Parameters
target_host = "192.168.1.1"  # Replace with your target
ping_interval = 1           # Time between pings in seconds
max_data_points = 100       # Maximum number of points to display

# Initialize the plot
fig, ax = plt.subplots()
latency_data = []

def ping():
    """Runs a ping command and extracts latency."""
    try:
        result = subprocess.run(["ping", "-c", "1", target_host],
                                capture_output=True, text=True)
        # Find latency in the output (e.g., time=34.5 ms)
        latency = re.search(r"time=(\d+\.?\d*) ms", result.stdout)
        if latency:
            return float(latency.group(1))
        return None
    except Exception as e:
        print("Ping failed:", e)
        return None

def update(frame):
    """Fetch new latency data and update the plot."""
    latency = ping()
    if latency is not None:
        latency_data.append(latency)
        if len(latency_data) > max_data_points:
            latency_data.pop(0)  # Keep the graph within max_data_points

    # Update the plot
    ax.clear()
    ax.plot(latency_data, marker="o", color="blue", markersize=3)
    ax.set_title("Live Ping Latency")
    ax.set_xlabel("Ping Attempt")
    ax.set_ylabel("Latency (ms)")
    ax.set_ylim(0, max(latency_data) + 10)
    ax.grid(True)

# Run the animation
ani = animation.FuncAnimation(fig, update, interval=ping_interval * 1000)
plt.show()

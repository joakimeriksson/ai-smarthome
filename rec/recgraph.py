# REC Graph
# Import the necessary packages and modules
import matplotlib.pyplot as plt
import json, datetime

with open('testdata.json') as json_file:
    data = json.load(json_file)

print(data)

y = list(map(lambda x : x['value'] ,data))
x = list(map(lambda x : datetime.datetime.strptime(x['observationTime'], '%Y-%m-%dT%H:%M:%SZ'), data))
# Plot the data
plt.plot(x, y, label='Temperature')

# Add a legend
plt.legend()

# Show the plot
plt.show()
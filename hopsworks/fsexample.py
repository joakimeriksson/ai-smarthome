import hsfs
import pandas as pd
import time, random
import toml

# Load HopsWorks Kafka configuration
conf = toml.load('config.toml')

print("Connecting to ", conf['hops']['host'], " project ", conf['project']['name'])


conn = hsfs.connection(
    host=conf['hops']['host'],
    project=conf['project']['name'],
    hostname_verification=False,
    api_key_value=(
        conf['project']['api_key']
        )
    )
fs = conn.get_feature_store()
print(fs)

fg = fs.get_or_create_feature_group(conf['featuregroup']['name'],
                                    version=4,
                                    description="Rain features",
                                    primary_key=['unix_time', 'location_id'])
print(fg)

#df1 = fg.read()
#print(df1)


d = {'unix_time': [int(time.time()),int(time.time() - 3600000)], 'location_id': [4711, 4711], 'rain': [random.randint(0,25), random.randint(0,25)]}
df = pd.DataFrame(data=d)

print(df)
fg.insert(df)

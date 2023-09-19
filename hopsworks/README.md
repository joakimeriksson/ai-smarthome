
Minimal example showing how to post data to a Hopsworks featurestore.


You will need to create a key for the store and create a config.toml file.
For the ICE hopsworks instance you can use the below data + an API Key:

```toml
[hops]
host = "hopsworks.ice.ri.se"

[project]
name = "ADWtest"
api_key = <your-api-key>

[featuregroup]
name =  'testfg'
```


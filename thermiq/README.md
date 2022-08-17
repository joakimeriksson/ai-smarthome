# Thermiq to Hopsworks connector
Read registers from Thermiq Thermia heat pump connection and publish the data to a kafka topic in Hopsworks.
You will need a topic created + download the certificates for the specific hopworks project to get the kafka topics to get into hopsworks.

# Version 3.0 of Hopsworks
If you have Hopsworks 3.0 it is even easier than before. Use the 3.0 version of the python script - keep the config file but replace
lots of cert-details with the API-Key. In this case the certs will be automatically downloaded from the Hopsworks instance via the REST API.


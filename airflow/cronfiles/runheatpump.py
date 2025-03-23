#
# runheatpump.py - adapted for running in colonies with cronjob and CFS
# (c) 2025 Joakim Eriksson
#
import hopsworks
import toml

# Read the config file from CFS
with open("/cfs/cronfiles/config.toml", "r") as fp:
    confData = fp.read()
print("Trying to load config.toml from:" + confData)
conf = toml.loads(confData)
connection = hopsworks.connection(
    host=conf['hops']['host'],
    project=conf['project']['name'],
    api_key_value=conf['project']['api_key']
)
print("Connected to hopsworks")
projects = connection.get_projects()
print(projects)
      
jobname = 'HeatpumpStore'
project = connection.get_project(name = conf['project']['name'])
jobs_api = project.get_jobs_api()
job = jobs_api.get_job(jobname)
execution = job.run(await_termination=True)
# True if job executed successfully
print(execution.success)
connection.close()


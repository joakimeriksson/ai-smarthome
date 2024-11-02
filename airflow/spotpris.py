#datetime
from datetime import timedelta, datetime
import shutil

# The DAG object
from airflow import DAG

# Operators
from airflow.decorators import dag, task
from airflow.operators.python_operator import PythonVirtualenvOperator


# initializing the default arguments
default_args = {
  'owner': 'Joakim',
  'start_date': datetime(2022, 3, 4),
  'retries': 3,
  'retry_delay': timedelta(minutes=5)
}

# Instantiate a DAG object
with DAG('spot_pris_dag',
    default_args=default_args,
    description='Spot Price DAG',
    schedule_interval='0 1 * * *', 
    catchup=False,
    tags=['spotpris, mqtt']
) as spot_pris_dag:

  # python callable function
  if not shutil.which("virtualenv"):
    log.warning("The virtalenv_python example task requires virtualenv, please install it.")
  else:
    # [START howto_operator_python_venv]
    @task.virtualenv(
        task_id="load_data_task", requirements=["requests"], system_site_packages=False
    )
    def load_data(**context):
      import requests, re, json, time
      from datetime import datetime

      # Get the current date
      current_date = datetime.now().strftime("%Y/%m-%d")
      # Construct the URL with the current date
      url = f"https://www.elprisetjustnu.se/api/v1/prices/{current_date}_SE3.json"

      # Make the GET request
      resp = requests.get(url)
      data = resp.json()
      print(data)
      values = []
      for obj in data:
          print(obj)
          values = values + [obj['SEK_per_kWh']]

      values = json.dumps(values)
      return values
    
    load_data_task = load_data()

  def pull_from_return(values):
    import paho.mqtt.client as mqtt
    import time
    # Run the other thing...
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
    client.connect("192.168.1.237", 1883, 60)
    client.loop()
    print(values)
    mqttPublish = client.publish("test-spot", payload=values, retain=True)
    
    for i in range(1,10):
      client.loop()
      time.sleep(0.1)
    mqttPublish.wait_for_publish()
    client.disconnect()

  # This is the way to get in XCOM data into the next node (using pyenv).
  send_data = PythonVirtualenvOperator(
    task_id='puller',
    dag=spot_pris_dag,
    op_kwargs={'values': '{{ ti.xcom_pull(task_ids="load_data_task") }}'},
    python_callable=pull_from_return,
    requirements=["paho-mqtt"]
  )

  # Set the order of execution of tasks.
  load_data_task >> send_data

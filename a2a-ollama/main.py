import uvicorn
from multiprocessing import Process
import time
import logging
from uuid import uuid4
import asyncio
import httpx

from weather_agent import app as weather_app
from vacation_planner_agent import app as vacation_planner_app
from common.types import SendTaskRequest, Message, TextPart

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_weather_agent():
    logger.info("Starting Weather Agent")
    uvicorn.run(weather_app, host="127.0.0.1", port=10003)

def run_vacation_planner_agent():
    logger.info("Starting Vacation Planner Agent")
    uvicorn.run(vacation_planner_app, host="127.0.0.1", port=10002)

async def main():
    logger.info("Starting agent processes")
    p1 = Process(target=run_weather_agent)
    p2 = Process(target=run_vacation_planner_agent)
    p1.start()
    p2.start()

    logger.info("Waiting for agents to start...")
    await asyncio.sleep(5)

    async with httpx.AsyncClient() as client:
        logger.info("Sending request to Vacation Planner Agent")
        try:
            task_id = str(uuid4())
            request = SendTaskRequest(
                params=dict(
                    id=task_id,
                    sessionId=str(uuid4()),
                    message=Message(
                        role="user",
                        parts=[TextPart(text="I want to go to a windy city")]
                    )
                )
            )
            raw_request = {
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": request.params.model_dump(),
                "id": str(uuid4())
            }

            response = await client.post("http://127.0.0.1:10002/", json=raw_request)
            response.raise_for_status()
            logger.info(f"Task sent to vacation planner: {response.json()}")

            for _ in range(20):
                await asyncio.sleep(1)
                get_task_request = {
                    "jsonrpc": "2.0",
                    "method": "tasks/get",
                    "params": {"id": task_id},
                    "id": str(uuid4())
                }
                get_task_response = await client.post("http://127.0.0.1:10002/", json=get_task_request)
                get_task_response.raise_for_status()
                task_data = get_task_response.json()['result']
                logger.info(f"Polling vacation planner status: {task_data['status']['state']}")
                if task_data['status']['state'] == "completed":
                    logger.info(f"Vacation plan received: {task_data['status']['message']['parts'][0]['text']}")
                    break

        except Exception as e:
            logger.error(f"An error occurred: {e}")

    logger.info("Terminating agent processes")
    p1.terminate()
    p2.terminate()
    p1.join()
    p2.join()
    logger.info("Processes terminated")

if __name__ == "__main__":
    asyncio.run(main())

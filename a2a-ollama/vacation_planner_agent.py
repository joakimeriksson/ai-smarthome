from fastapi import FastAPI, BackgroundTasks, HTTPException
from common.types import AgentCard, AgentSkill, JSONRPCRequest, JSONRPCResponse, SendTaskRequest, GetTaskRequest, Task, TaskState, TaskStatus, Message, TextPart, A2ARequest
import logging
import uuid
import asyncio
from typing import Dict
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

tasks: Dict[str, Task] = {}

agent_card = AgentCard(
    name="Vacation Planner Agent",
    description="An agent that plans vacations based on weather preferences.",
    url="http://127.0.0.1:10002/",
    version="0.1.0",
    skills=[
        AgentSkill(
            id="plan_vacation",
            name="Plan Vacation",
            description="Plan a vacation to a city with a specific weather.",
            examples=["I want to go to a windy city."],
        )
    ],
    capabilities={"streaming": False},
)

async def plan_vacation(task_id: str):
    task = tasks[task_id]
    user_query = task.history[0].parts[0].text
    logger.info(f"Planning vacation for: {user_query}")

    if "windy" in user_query:
        city = "chicago"
    elif "rainy" in user_query:
        city = "tokyo"
    else:
        city = "london"

    async with httpx.AsyncClient() as client:
        try:
            weather_task_id = str(uuid.uuid4())
            weather_request = SendTaskRequest(
                params=dict(
                    id=weather_task_id,
                    sessionId=str(uuid.uuid4()),
                    message=Message(
                        role="user",
                        parts=[TextPart(text=city)]
                    )
                )
            )

            # The A2A server expects a raw JSON-RPC request.
            raw_request = {
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": weather_request.params.model_dump(),
                "id": str(uuid.uuid4())
            }

            response = await client.post("http://127.0.0.1:10003/", json=raw_request)
            response.raise_for_status()

            for _ in range(10):
                await asyncio.sleep(1)
                get_task_request = {
                    "jsonrpc": "2.0",
                    "method": "tasks/get",
                    "params": {"id": weather_task_id},
                    "id": str(uuid.uuid4())
                }
                get_task_response = await client.post("http://127.0.0.1:10003/", json=get_task_request)
                get_task_response.raise_for_status()
                weather_task_data = get_task_response.json()['result']
                if weather_task_data['status']['state'] == "completed":
                    weather_response = weather_task_data['status']['message']['parts'][0]['text']
                    response_text = f"I have planned your vacation to {city.capitalize()}. {weather_response}"
                    break
            else:
                response_text = "I could not get the weather for your vacation."

        except Exception as e:
            logger.error(f"Error planning vacation: {e}")
            response_text = "Sorry, I could not plan your vacation."

    response_message = Message(
        role="agent",
        parts=[TextPart(text=response_text)]
    )
    task.status = TaskStatus(state=TaskState.COMPLETED, message=response_message)
    tasks[task_id] = task

@app.get("/")
async def get_agent_card():
    return agent_card.model_dump()

@app.post("/")
async def handle_a2a_request(request: JSONRPCRequest, background_tasks: BackgroundTasks):
    validated_request = A2ARequest.validate_python(request.model_dump())
    if validated_request.method == "tasks/send":
        params = SendTaskRequest.parse_obj(validated_request).params
        task_id = params.id
        task = Task(
            id=task_id,
            sessionId=params.sessionId,
            status=TaskStatus(state=TaskState.SUBMITTED),
            history=[params.message]
        )
        tasks[task_id] = task
        background_tasks.add_task(plan_vacation, task_id)
        return JSONRPCResponse(id=request.id, result=task)
    elif validated_request.method == "tasks/get":
        params = GetTaskRequest.parse_obj(validated_request).params
        task = tasks.get(params.id)
        if task:
            return JSONRPCResponse(id=request.id, result=task)
        else:
            raise HTTPException(status_code=404, detail="Task not found")
    else:
        raise HTTPException(status_code=400, detail="Method not supported")

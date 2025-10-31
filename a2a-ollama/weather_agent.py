from fastapi import FastAPI, BackgroundTasks, HTTPException
from common.types import AgentCard, AgentSkill, JSONRPCRequest, JSONRPCResponse, SendTaskRequest, GetTaskRequest, Task, TaskState, TaskStatus, Message, TextPart, A2ARequest
import logging
import uuid
import asyncio
from typing import Dict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

tasks: Dict[str, Task] = {}

agent_card = AgentCard(
    name="Weather Agent",
    description="An agent that provides weather forecasts.",
    url="http://127.0.0.1:10003/",
    version="0.1.0",
    skills=[
        AgentSkill(
            id="get_weather",
            name="Get Weather",
            description="Get the weather for a given city.",
            examples=["What's the weather in Chicago?"],
        )
    ],
    capabilities={"streaming": False},
)

def process_weather_request(task_id: str):
    task = tasks[task_id]
    city = task.history[0].parts[0].text
    logger.info(f"Processing weather request for {city}")
    if "chicago" in city.lower():
        weather = "windy"
    elif "tokyo" in city.lower():
        weather = "rainy"
    else:
        weather = "sunny"

    response_message = Message(
        role="agent",
        parts=[TextPart(text=f"The weather in {city} is {weather}.")]
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
        background_tasks.add_task(process_weather_request, task_id)
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

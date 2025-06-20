# A2A Ollama Example
# ------------------
# This is a simple example of an A2A server that uses Ollama to generate responses
# Most of the code is from Googles A2A repository and their examples.
#
from langchain_ollama import ChatOllama
from langgraph.prebuilt import create_react_agent
from langgraph.graph.graph import CompiledGraph
from langchain_core.messages import HumanMessage, SystemMessage
import logging
import click
import typing

from common.server import A2AServer
from common.types import AgentCapabilities,AgentCard, AgentSkill, JSONRPCResponse, Message, Artifact
from common.server.task_manager import InMemoryTaskManager, SendTaskRequest, SendTaskStreamingRequest, SendTaskStreamingResponse, SendTaskResponse, Task, TaskState, TaskStatus

# Configure logging
#logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("A2A Ollama Test")
logger.setLevel(logging.INFO)

handler = logging.StreamHandler()
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(levelname)s - %(asctime)s - %(name)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)



system = SystemMessage(content="You are a helpful assistant that likes to talk about the weather.")
# Some Ollama agent code
def create_ollama_agent(ollama_base_url: str, ollama_model: str):
  logger.info(f"Creating ollama agent: {ollama_base_url}, {ollama_model}")
  ollama_chat_llm = ChatOllama(
    base_url=ollama_base_url,
    model=ollama_model,
    temperature=0.2
  )
  agent = create_react_agent(ollama_chat_llm, tools=[])
  return agent

async def run_ollama(ollama_agent: CompiledGraph, prompt: str, image: typing.Union[None, bytes] = None):
  # Create a message with image content
  content = [{"type": "text", "text": prompt}]
  if image is not None:
    content.append({
      "type": "image_url",
      "image_url": {"url": f"data:image/jpeg;base64,{image}"},
    })

  message = HumanMessage(content=content)

  agent_response = await ollama_agent.ainvoke(
    {"messages": [
        system, message
    ]}
  )
  message = agent_response["messages"][-1].content
  return str(message)

# The Agent Task Manager
class MyAgentTaskManager(InMemoryTaskManager):
  def __init__(self, ollama_host: str, ollama_model: typing.Union[None, str]):
    super().__init__()
    if ollama_model is not None:
      self.ollama_agent = create_ollama_agent(
        ollama_base_url=ollama_host,
        ollama_model=ollama_model
      )
    else:
      self.ollama_agent = None

  async def on_send_task(self, request: SendTaskRequest) -> SendTaskResponse:
#    logger.info(f"on_send_task received: {request}")
    image_data = None

    for part in request.params.message.parts:
      if part.type == "text":
        logger.info(f"on_send_task TEXT received: {part.text[0:40]}")
      elif part.type == "file":
        logger.info(f"on_send_task FILE received: {part.file.name}")
        image_data = part.file.bytes

    # Upsert a task stored by InMemoryTaskManager
    await self.upsert_task(request.params)
    
    received_text = request.params.message.parts[0].text
    logger.info(f"on_send_task received: {received_text}")

    response_text = f"on_send_task received: {received_text}"
    if self.ollama_agent is not None:
      response_text = await run_ollama(ollama_agent=self.ollama_agent, prompt=received_text, image=image_data)

    task_id = request.params.id
    task = await self._update_task(
      task_id=task_id,
      task_state=TaskState.COMPLETED,
      response_text=response_text)
 
    return SendTaskResponse(id=request.id, result=task)
  
  async def on_send_task_subscribe(self, request: SendTaskStreamingRequest) -> typing.AsyncIterable[SendTaskStreamingResponse] | JSONRPCResponse:
    """
    This method subscribes the caller to future updates regarding a task.
    The caller will receive a response and additionally receive subscription
    updates over a session established between the client and the server
    """
    pass

  async def _update_task(self, task_id: str, task_state: TaskState, response_text: str) -> Task:
    task = self.tasks[task_id]
    agent_response_parts = [
      {
        "type": "text",
        "text": response_text,
      }
    ]
    task.status = TaskStatus(
      state=task_state,
      message=Message(
        role="agent",
        parts=agent_response_parts,
      )
    )
    task.artifacts = [
      Artifact(
        parts=agent_response_parts,
      )
    ]
    return task


# The main function - starting up the system
@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10002)
@click.option("--ollama-host", default="http://127.0.0.1:11434")
@click.option("--ollama-model", default="llama3.2")

def main(host, port, ollama_host, ollama_model):
  logger.info("Starting A2A server")

  capabilities = AgentCapabilities(
    streaming=False # We'll leave streaming capabilities as an exercise for the reader
  )
  skill = AgentSkill(
    id="Ollama-Chat-Skill",
    name="Ollama Chat Skill",
    description="Responds with the input given using Ollama",
    tags=["chat", "LLM response"],
    examples=["What is the meaning of life?"],
    inputModes=["text"],
    outputModes=["text"],
  )

  agent_card = AgentCard(
    name="Ollama Chat Agent",
    description="This agent responds with the input given using Ollama",
    url=f"http://{host}:{port}/",
    version="0.1.0",
    defaultInputModes=["text"],
    defaultOutputModes=["text"],
    capabilities=capabilities,
    skills=[skill]
  )

  task_manager = MyAgentTaskManager(
    ollama_host=ollama_host,
    ollama_model=ollama_model,
  )

  server = A2AServer(
    agent_card=agent_card,
    task_manager=task_manager,
    host=host,
    port=port,
  )
  server.start()

if __name__ == "__main__":
    main()

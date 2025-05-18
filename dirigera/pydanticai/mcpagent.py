#
# Minimal example of using The Dirigera MCP with Pydantic AI to turn on/off a specific light.
#
# Author: Joakim Eriksson
# Created: 2025
#
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
import os

# Use Logfire if the LOGFIRE_TOKEN environment variable is set
if os.getenv("LOGFIRE_TOKEN"):
    import logfire
    logfire.configure(token=os.getenv("LOGFIRE_TOKEN"))
    logfire.instrument_pydantic_ai()

# Start an MCP Server
server = MCPServerStdio(
    command="uv",
    args=[
        "--directory",
        "/Users/joakimeriksson/work/ai-smarthome/dirigera/fastmcp",
        "run",
        "dirigeramcp.py"
    ]
)
# Configure the model with Ollama's base URL
model = OpenAIModel(
    model_name='llama3.2',
    provider=OpenAIProvider(base_url='http://localhost:11434/v1')
)

# Create and configure the agent
agent = Agent(model, mcp_servers=[server], system_prompt="You are a helpful assistant that can control smart home devices.")

# Example chat automation of Lamp control
import asyncio

async def main():
    async with agent.run_mcp_servers():
        result = await agent.run("list my lights")
        print(result)
        result = await agent.run("Toggle the status of the lamp at the couch (Soffa)", message_history=result.new_messages())
        print(result)

if __name__ == "__main__":
    asyncio.run(main())
    
app = agent.to_a2a()

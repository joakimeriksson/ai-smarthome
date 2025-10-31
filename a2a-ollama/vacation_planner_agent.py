from pydantic_ai import Agent
from pydantic_ai.clients import A2AClient

weather_agent = A2AClient(base_url="http://localhost:10003")

agent = Agent(tools=[weather_agent])
app = agent.to_a2a()

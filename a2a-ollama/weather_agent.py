from pydantic_ai import Agent
from pydantic_ai.tool import tool

@tool
def get_weather(city: str) -> str:
    """
    Get the weather for a given city.
    """
    if "chicago" in city.lower():
        return "The weather in Chicago is windy."
    elif "tokyo" in city.lower():
        return "The weather in Tokyo is rainy."
    else:
        return f"I don't know the weather in {city}."

agent = Agent(tools=[get_weather])
app = agent.to_a2a()

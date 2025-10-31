# A2A Multi-Agent Communication Example

This example demonstrates a multi-agent communication scenario using the A2A (Agent-to-Agent) protocol. It features two agents: a "Vacation Planner Agent" and a "Weather Agent". The Vacation Planner Agent interacts with the Weather Agent to fulfill a user's request for a vacation destination with specific weather conditions.

## Prerequisites
- [UV](https://docs.astral.sh/uv/)

## Usage

1. **Set up the environment:**

   Create a virtual environment and install the required dependencies:
   ```console
   uv venv -p python3.11
   source .venv/bin/activate
   uv pip install -e .
   ```

2. **Run the multi-agent system:**

   Execute the main application to start both agents and see them interact:
   ```console
   cd a2a-ollama
   uv run python main.py
   ```

   This will start the Weather Agent on port 10003 and the Vacation Planner Agent on port 10002. The `main.py` script will then send a request to the Vacation Planner Agent, which in turn will query the Weather Agent.

3. **Expected Output:**

   You will see logs from both agents and the main application, culminating in a successful vacation plan:
   ```console
   INFO:__main__:Starting agent processes
   INFO:__main__:Starting Weather Agent
   INFO:__main__:Starting Vacation Planner Agent
   INFO:__main__:Waiting for agents to start...
   INFO:     Started server process [16408]
   INFO:     Waiting for application startup.
   INFO:     Application startup complete.
   INFO:     Uvicorn running on http://127.0.0.1:10003 (Press CTRL+C to quit)
   INFO:     Started server process [16409]
   INFO:     Waiting for application startup.
   INFO:     Application startup complete.
   INFO:     Uvicorn running on http://127.0.0.1:10002 (Press CTRL+C to quit)
   INFO:__main__:Sending request to Vacation Planner Agent
   INFO:vacation_planner_agent:Planning vacation for: I want to go to a windy city
   INFO:httpx:HTTP Request: POST http://127.0.0.1:10002/ "HTTP/1.1 200 OK"
   INFO:__main__:Task sent to vacation planner: {'jsonrpc': '2.0', 'id': '6de1dfa6-9208-41ae-a25d-b477d744a8c5', 'result': {'id': '5e666e6f-0f7c-48ba-9a2d-c8b73c694b6f', 'sessionId': 'f306fcbc-9c1b-4851-8a3a-a166ecfa031e', 'status': {'state': 'submitted', 'message': None, 'timestamp': '2025-10-31T10:49:28.372121'}, 'artifacts': None, 'history': [{'role': 'user', 'parts': [{'type': 'text', 'text': 'I want to go to a windy city', 'metadata': None}], 'metadata': None}], 'metadata': None}, 'error': None}
   INFO:httpx:HTTP Request: POST http://127.0.0.1:10003/ "HTTP/1.1 200 OK"
   INFO:weather_agent:Processing weather request for chicago
   INFO:httpx:HTTP Request: POST http://127.0.0.1:10002/ "HTTP/1.1 200 OK"
   INFO:__main__:Polling vacation planner status: submitted
   INFO:httpx:HTTP Request: POST http://127.0.0.1:10003/ "HTTP/1.1 200 OK"
   INFO:httpx:HTTP Request: POST http://127.0.0.1:10002/ "HTTP/1.1 200 OK"
   INFO:__main__:Polling vacation planner status: completed
   INFO:__main__:Vacation plan received: I have planned your vacation to Chicago. The weather in chicago is windy.
   INFO:__main__:Terminating agent processes
   INFO:     Shutting down
   INFO:     Shutting down
   INFO:     Waiting for application shutdown.
   INFO:     Application shutdown complete.
   INFO:     Finished server process [16408]
   INFO:     Waiting for application shutdown.
   INFO:     Application shutdown complete.
   INFO:     Finished server process [16409]
   INFO:__main__:Processes terminated
   ```

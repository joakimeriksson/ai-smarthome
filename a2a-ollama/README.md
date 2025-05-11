# A2A Example using Ollama as a backend
This is a simple example of an A2A server that uses Ollama to generate responses.

## Prerequisites
- uvicorn
- ollama
- A2A CLI client (e.g. googles repository A2A and t path A2A/samples/python/hosts/cli)

## Usage
Start up the A2A server:
```console
>uv run main.py
INFO:A2A Ollama Test:Starting A2A server
INFO:A2A Ollama Test:Creating ollama agent: http://127.0.0.1:11434, llama3.2
DEBUG:asyncio:Using selector: KqueueSelector
INFO:     Started server process [7733]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://localhost:10002 (Press CTRL+C to quit)
[...]
```

Then you can use the A2A client to send a task to the server. Move to the directory where the A2A CLI client is located and run:
(e.g. cd A2A/samples/python/hosts/cli).

```console
>uv run . --agent http://localhost:10002
======= Agent Card ========
{
    "name":"Ollama Chat Agent",
    "description":"This agent responds with the input given using Ollama",
    "url":"http://localhost:10002/",
    "version":"0.1.0",
    "capabilities":{"streaming":false,"pushNotifications":false,"stateTransitionHistory":false},
    "defaultInputModes":["text"],
    "defaultOutputModes":["text"],
    "skills":[
        {
            "id":"Ollama-Chat-Skill",
            "name":"Ollama Chat Skill",
            "description":"Responds with the input given using Ollama",
            "tags":["chat","LLM response"],
            "examples":["What is the meaning of life?"],
            "inputModes":["text"],
            "outputModes":["text"]
        }]
    }
=========  starting a new task ======== 
What do you want to send to the agent? (:q or quit to exit): 
```

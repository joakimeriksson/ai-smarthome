# A2A Example using Ollama as a backend
This is a simple example of an A2A server that uses Ollama to generate responses.
The Code in this repository is based on the [A2A](https://github.com/google/a2a) repository and the code in the common folder is a copy of the code in the 
common directory that repository.

## Prerequisites
- [UV](https://docs.astral.sh/uv/)
- [Ollama](https://ollama.com/)
- [A2A CLI client](https://github.com/google/a2a/tree/main/samples/python/hosts/cli)

## Usage
Start up the A2A server:
```console
>uv run main.py
INFO:A2A Ollama Test:Starting A2A server
INFO:A2A Ollama Test:Creating ollama agent: http://127.0.0.1:11434, gemma3:12b
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
What do you want to send to the agent? (:q or quit to exit): What model is running?
Select a file path to attach? (press enter to skip): 

{
        "jsonrpc":"2.0",
        "id":"7345b0d02d2f4d08afca94b634d25fe1",
        "result":
            {
                "id":"cbee5995923b4d999124f1ab93ef2b60",
                "sessionId":"d86c5b12242c4dc89ff64c398496f532",
                "status":
                    {
                        "state":"completed",
                        "message":{"role":"agent","parts":[{"type":"text","text":"I'm running on the Gemma family of models. Specifically, I'm Gemma 1.1 7B."}]},
                        "timestamp":"2025-05-11T22:08:19.073628"
                    },
                "artifacts":[{"parts":[{"type":"text","text":"I'm running on the Gemma family of models. Specifically, I'm Gemma 1.1 7B."}],"index":0}],
                "history":[{"role":"user","parts":[{"type":"text","text":"What model is running?"}]}]
            }
        }
=========  starting a new task ======== 
What do you want to send to the agent? (:q or quit to exit): 
```

**NOTE**: I was in fact running gemma 3 in this case (but it was not in the context).

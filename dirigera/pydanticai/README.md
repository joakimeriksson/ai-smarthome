# MCP Agent for controlling Dirigera devices (and reading out data from them)
Very basic example showing how to use pydantic-ai to create an Agent for controlling Dirigera devices via the Dirigera MCP Server.

# Running the example
```bash
uv run mcpagent.py
```

# Configuration
You will need a config file named dirigera_mcp_server_config.toml in the same directory as the ../fastmcp/dirigeramcp.py file (e.g. in the Dirigera FastMCP Implementation).

If you want logging to work you will need to set the LOGFIRE_TOKEN environment variable to your Logfire token.

# A2A Test

If you are interested in setting this up as an A2A Agent you can run it using the following:

```bash
uv run uvicorn mcpagent:app --host 0.0.0.0 --port 8000
```

You can then test it using the following curl command:

```bash
wget -q -O - http://localhost:8000/.well-known/agent.json | jq
{
  "name": "Agent",
  "url": "http://localhost:8000",
  "version": "1.0.0",
  "skills": [],
  "default_input_modes": [
    "application/json"
  ],
  "default_output_modes": [
    "application/json"
  ]
}
```

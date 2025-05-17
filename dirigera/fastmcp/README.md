# Dirigera MCP Server (FastMCP version)

The Dirigera MCP Server is an IoT device management server that interfaces with the Dirigera platform. It allows users to manage and interact with various IoT devices, such as environment sensors, lights and outlets.

## How to Run

You will have to setup a MCP LLM system - either Claude Desktop or MCP-CLI and configure them to use this server. You can also use the MCP Inspector to test the server.

```bash
npx @modelcontextprotocol/inspector uv --directory . run dirigeramcp.py
```
Assuming that you have the config file in the same directory as the dirigeramcp.py file.


## Configuration

You will need a config file named dirigera_mcp_server_config.toml in the following format:

```toml
[dirigera]
host = '<your dirigera host>'
token = "<your dirigera token>"

```

In Claude and other tools you will need something like this in your config.json:

```json
{
  "mcpServers": {
    "dirigera": {
      "command": "uv",
      "args": [
        "--directory",
        "/Users/joakimeriksson/work/ai-smarthome/dirigera/fastmcp",
        "run",
        "dirigeramcp.py"
      ]
    }
  }
}
```

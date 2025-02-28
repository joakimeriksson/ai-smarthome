# Dirigera MCP Server

The Dirigera MCP Server is an IoT device management server that interfaces with the Dirigera platform. It allows users to manage and interact with various IoT devices, such as environment sensors and outlets.

## How to Run

You will have to setup a MCP LLM system - either Claude Desktop or MCP-CLI and configure them to use this server.


## Configuration

You will need a config file named dirigera_mcp_server_config.toml in the following format:

```toml
[dirigera]
host = '<your dirigera host>'
token = "<your dirigera token>"

```

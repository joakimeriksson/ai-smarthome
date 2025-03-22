#
# Author: Joakim Eriksson
# Created: 2025
#
import logging
import argparse, toml
import dirigera
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource
from typing import Sequence 
from enum import Enum
import json

"""
This module serves as the main MCP server for the Dirigera application. 
It initializes the logging configuration, handles command-line arguments,
and integrates with the Dirigera library to manage the smart home functionalities.
"""
logger = logging.getLogger('mcp_dirigera_server')
logger.error("Starting MCP Dirigera Server")

class DirigeraTools(str, Enum):
    LIST_ENVIRONMENT_SENSORS = "list_environment_sensors"
    LIST_OUTLETS = "list_outlets"
    LIST_LIGHTS = "list_lights"

class DirigeraServer:
    def __init__(self, config_path: str):
        conf = toml.load(config_path)
        host = conf['dirigera']['host']
        token = conf['dirigera']['token']
        self.client = dirigera.Hub(token=token,
        ip_address=host)
        logger.info(f"Connected to Dirigera at {host}")
        # Additional initialization code

    def list_environment_sensors(self):
        return self.client.get_environment_sensors()

    def get_outlets(self):
        return self.client.get_outlets()

    def get_lights(self):
        return self.client.get_lights()

async def main(config_path: str):
    logger.error("Starting Dirigera MCP Server (main)")
    dirigera = DirigeraServer(config_path)
    server = Server("mcp-dirigera")
    @server.list_tools()
    async def list_tools() -> list[Tool]:
        """List available dirigera tools."""
        return [
            Tool(
                name= DirigeraTools.LIST_ENVIRONMENT_SENSORS.value,
                description="Get current environment sensors data, usually containing temperature, humidity, pressure, etc.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            Tool(
                name= DirigeraTools.LIST_OUTLETS.value,
                description="Get current outlets data, usually containing power, voltage, current, etc.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            Tool(
                name= DirigeraTools.LIST_LIGHTS.value,
                description="Get current status of all lights, including their names and on/off status, etc.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            )              
        ]

    @server.call_tool()
    async def call_tool(
        name: str, arguments: dict
    ) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
        """Handle tool calls for dirigera queries."""
        try:
            match name:
                case DirigeraTools.LIST_ENVIRONMENT_SENSORS.value:
                    sensors = dirigera.list_environment_sensors()
                    txt = ""
                    for sensor in sensors:
                        dict = {'id': sensor.id, 'name': sensor.attributes.custom_name,
                                'temperature': sensor.attributes.current_temperature, 
                                'humidity': sensor.attributes.current_r_h, 
                                'pm2.5': sensor.attributes.current_p_m25,
                                'voc': sensor.attributes.voc_index}
                        txt = txt + json.dumps(dict) + "\n"
                    return [
                        TextContent(type="text", text=txt)
                    ]
                
                case DirigeraTools.LIST_OUTLETS.value:
                    outlets = dirigera.get_outlets()
                    txt = ""
                    for outlet in outlets:
                        dict = {'id': outlet.id, 'name': outlet.attributes.custom_name,
                                'power': outlet.attributes.current_active_power,
                                'voltage': outlet.attributes.current_voltage,
                                'current': outlet.attributes.current_amps
                        }
                        txt = txt + json.dumps(dict) + "\n"
                    return [
                        TextContent(type="text", text=txt)
                    ]
                case DirigeraTools.LIST_LIGHTS.value:
                    lights = dirigera.get_lights()
                    txt = ""
                    for light in lights:
                        dict = {'id': light.id, 'name': light.attributes.custom_name,
                                'light_level': light.attributes.light_level,
                                'color_temperature': light.attributes.color_temperature,
                                'is_on': light.attributes.is_on
                        }
                        txt = txt + json.dumps(dict) + "\n"
                    return [
                        TextContent(type="text", text=txt)
                    ]
                case _:
                    raise ValueError(f"Unknown tool: {name}")

        except Exception as e:
            logger.error(f"Error processing mcp-server-dirigera query: {str(e)}")
            raise ValueError(f"Error processing mcp-server-dirigera query: {str(e)}")

    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Dirigera MCP Server for IoT device management')
    parser.add_argument('--config-path', default="./dirigera_mcp_server_config.toml", help='Path to Dirigera server configuration file (TOML format)')
    args = parser.parse_args()
    asyncio.run(main(args.config_path))
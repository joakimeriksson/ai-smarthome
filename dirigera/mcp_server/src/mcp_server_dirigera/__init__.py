from . import server
import asyncio
import argparse
import logging

logger = logging.getLogger('mcp_dirigera_server')
logger.debug("Starting MCP Dirigera Server")

def main():
    """Main entry point for the Dirigera MCP server."""
    logger.error("Starting MCP Dirigera Server")

    parser = argparse.ArgumentParser(description='Dirigera MCP Server for IoT device management')
    parser.add_argument('--config-path', 
                        default="./dirigera_mcp_server_config.toml",
                        help='Path to Dirigera server configuration file (TOML format)')
    
    args = parser.parse_args()
    asyncio.run(server.main(args.config_path))

# Optionally expose other important items at package level
__all__ = ["main", "server"]
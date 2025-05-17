from fastmcp import FastMCP
import toml, argparse, dirigera

mcp = FastMCP(name="Dirigera Server")
client = None

@mcp.tool()
def get_environment_sensors() -> list:
    """Lists all environment sensors with their current data such as temperature, humidity, etc."""
    return [
        {
            'id': sensor.id,
            'name': sensor.attributes.custom_name,
            'temperature': sensor.attributes.current_temperature,
            'humidity': sensor.attributes.current_r_h,
            'pm2.5': sensor.attributes.current_p_m25,
            'voc': sensor.attributes.voc_index,
        }
        for sensor in client.get_environment_sensors()
    ]

@mcp.tool()
def get_outlets() -> list:
    """Lists all outlets with their current data such as power, voltage, current, etc."""
    return [
        {
            'id': outlet.id,
            'name': outlet.attributes.custom_name,
            'power': outlet.attributes.current_active_power,
            'voltage': outlet.attributes.current_voltage,
            'current': outlet.attributes.current_amps
        }
        for outlet in client.get_outlets()
    ]

@mcp.tool()
def get_lights() -> list:
    """Lists all lights with their current data such as brightness, etc."""
    return [
        {
            'id': light.id,
            'name': light.attributes.custom_name,
            'light_level': light.attributes.light_level,
            'color_temperature': light.attributes.color_temperature,
            'color_saturation': light.attributes.color_saturation,
            'color_hue' : light.attributes.color_hue,
            'is_on': light.attributes.is_on
        }
        for light in client.get_lights()
    ]

@mcp.tool()
def set_outlet(name: str, is_on: bool) -> str:
    """Set outlet status of a named outlet. Arguments are on/off"""
    outlet = client.get_outlet_by_name(name)
    if outlet is None:
        return f"Outlet '{name}' not found"
    outlet.set_on(outlet_on=is_on)
    return f"outlet {name} set to {is_on}."

@mcp.tool()
def set_light(name: str, is_on: bool, light_level: int, color_saturation: float, color_hue: float) -> str:
    """Set light status of a named light. Arguments are on/off, intensity (int), color_saturation (float 0.0-1.0), color_hue (float, 0-360)"""
    light = client.get_light_by_name(name)
    if light is None:
        return f"Light '{name}' not found"
    light.set_light(lamp_on=is_on)
    light.set_light_level(light_level=light_level)
    light.set_light_color(hue=color_hue, saturation=color_saturation)
    return f"light {name} set to {is_on} with level {light_level} and color {color_saturation} and {color_hue}."


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Dirigera MCP Server for IoT device management')
    parser.add_argument('--config-path', default="./dirigera_mcp_server_config.toml", help='Path to Dirigera server configuration file (TOML format)')
    args = parser.parse_args()
    conf = toml.load(args.config_path)
    host = conf['dirigera']['host']
    token = conf['dirigera']['token']
    client = dirigera.Hub(token=token, ip_address=host)
    mcp.run()

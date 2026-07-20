#!/usr/bin/env python3

import sys
from xml.etree import ElementTree as ET
import os

def analyze_svg(filepath):
    """Analyze an SVG file and print its properties."""
    try:
        # Parse the SVG file
        tree = ET.parse(filepath)
        root = tree.getroot()
        
        # Get the SVG namespace
        namespace = root.tag.split('}')[0] + '}'
        
        # Basic file info
        print(f"\n=== SVG Analysis for {os.path.basename(filepath)} ===")
        print(f"File size: {os.path.getsize(filepath)} bytes")
        
        # Get SVG dimensions
        width = root.get('width', 'Not specified')
        height = root.get('height', 'Not specified')
        viewBox = root.get('viewBox', 'Not specified')
        print(f"\nDimensions:")
        print(f"  Width: {width}")
        print(f"  Height: {height}")
        print(f"  ViewBox: {viewBox}")
        
        # Count elements
        paths = root.findall(f'.//{namespace}path')
        circles = root.findall(f'.//{namespace}circle')
        rects = root.findall(f'.//{namespace}rect')
        
        print(f"\nElements:")
        print(f"  Paths: {len(paths)}")
        print(f"  Circles: {len(circles)}")
        print(f"  Rectangles: {len(rects)}")
        
        # Look for style attributes
        style = root.get('style', '')
        fill = root.get('fill', '')
        stroke = root.get('stroke', '')
        
        print(f"\nStyle attributes:")
        if style:
            print(f"  Style: {style}")
        if fill:
            print(f"  Fill: {fill}")
        if stroke:
            print(f"  Stroke: {stroke}")
            
        # Check for embedded scripts or links
        scripts = root.findall(f'.//{namespace}script')
        links = root.findall(f'.//{namespace}a')
        
        if scripts or links:
            print("\nEmbedded elements:")
            if scripts:
                print(f"  Scripts found: {len(scripts)}")
            if links:
                print(f"  Links found: {len(links)}")

    except ET.ParseError:
        print(f"Error: Could not parse {filepath} as SVG file")
    except FileNotFoundError:
        print(f"Error: File {filepath} not found")
    except Exception as e:
        print(f"Error: {str(e)}")

def main():
    if len(sys.argv) != 2:
        print("Usage: python analyze_svg.py <path_to_svg_file>")
        sys.exit(1)
    
    svg_path = sys.argv[1]
    analyze_svg(svg_path)

if __name__ == "__main__":
    main() 
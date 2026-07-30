#!/usr/bin/env python3
"""Click and screenshot a plugin window that macOS will not let us focus.

The editor is hosted by a bare python process with no app bundle, so it gets no
Dock icon and cannot be activated normally. It IS a real window though, so we
can locate it, screenshot it by window id, and post synthetic clicks at
coordinates inside it.

    uv run --with pyobjc-framework-Quartz webui/compare/uiclick.py find
    uv run --with pyobjc-framework-Quartz webui/compare/uiclick.py shot out.png
    uv run --with pyobjc-framework-Quartz webui/compare/uiclick.py click 120 80

Coordinates for `click` are relative to the window's top-left, in POINTS (the
same units the screenshot reports after dividing by the retina scale factor).
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyobjc-framework-Quartz"]
# ///

import subprocess
import sys
import time

import Quartz

TITLE = "ZENOLOGY"


def find(owner_hint="python"):
    for w in Quartz.CGWindowListCopyWindowInfo(
            Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID):
        owner = str(w.get("kCGWindowOwnerName", ""))
        name = str(w.get("kCGWindowName", ""))
        if owner_hint in owner.lower() and TITLE in name:
            b = w["kCGWindowBounds"]
            return {"id": w["kCGWindowNumber"], "owner": owner, "name": name,
                    "x": b["X"], "y": b["Y"], "w": b["Width"], "h": b["Height"]}
    return None


def click(win, dx, dy, double=False):
    x, y = win["x"] + dx, win["y"] + dy
    pos = Quartz.CGPointMake(x, y)
    for _ in range(2 if double else 1):
        for kind in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
            ev = Quartz.CGEventCreateMouseEvent(None, kind, pos,
                                                Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
            time.sleep(0.03)
        time.sleep(0.05)
    return x, y


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    win = find()
    if not win:
        print("no ZENOLOGY window found", file=sys.stderr)
        return 2

    if cmd == "find":
        print(f"id={win['id']} owner={win['owner']!r} "
              f"at {win['x']:.0f},{win['y']:.0f} size {win['w']:.0f}x{win['h']:.0f}")
    elif cmd == "shot":
        out = sys.argv[2]
        subprocess.run(["screencapture", "-x", "-o", "-l", str(win["id"]), out],
                       check=True)
        print(f"wrote {out}")
    elif cmd == "click":
        dx, dy = float(sys.argv[2]), float(sys.argv[3])
        x, y = click(win, dx, dy, double="--double" in sys.argv)
        print(f"clicked window+({dx},{dy}) = screen({x:.0f},{y:.0f})")
    else:
        print(f"unknown command {cmd}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

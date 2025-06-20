# C64 Chat Client (using virtualc64web)

This project is a web-based application that simulates a chat client running on a Commodore 64 (C64), interacting with a modern chat API (like OpenAI's). It uses `virtualc64web` for C64 emulation, loaded via the `vc64web_player.js`.

## Overview

The project consists of:
1.  An HTML page (`index.html`) that hosts the application.
2.  Javascript code (`main.js`) that:
    *   Loads and initializes the `virtualc64web` C64 emulator using `vc64web_player.js`. The player script is loaded remotely.
    *   Loads a predefined C64 program (`chatinput.prg`, embedded as a base64 string) into the emulator.
    *   Manages communication between the C64 environment (via `virtualc64web`'s memory access functions) and a chat API.
    *   Provides a visual chat log in the HTML page.
3.  A simple C64 program (`chatinput.prg`) which automatically:
    *   Writes a sample prompt ("HI") to a specific C64 memory location (`PROMPT_BUFFER_ADDRESS`).
    *   Sets a "prompt ready" flag in another memory location (`PROMPT_READY_FLAG_ADDRESS`).
    *   Prints a message to the C64 screen.

## Prerequisites for Running

No special emulator file downloads are required by the user. The `virtualc64web` emulator is loaded via a remote script referenced in `index.html`. You just need a modern web browser (Firefox or Chrome recommended).

## Interaction Flow

1.  When `index.html` is loaded, `main.js` includes `vc64web_player.js` (from `vc64web.github.io`).
2.  `main.js` configures `vc64web_player.samesite_file` with `chatinput.prg` (from an embedded base64 string).
3.  It then calls `vc64web_player.load()` to render the emulator in a designated `<div>` and automatically start `chatinput.prg`.
4.  `chatinput.prg` executes on the C64:
    *   Writes "HI" (as PETSCII bytes) to `PROMPT_BUFFER_ADDRESS` (0xC000).
    *   Writes `0x01` to `PROMPT_READY_FLAG_ADDRESS` (0xCFFF).
5.  The Javascript (`main.js`) polls the `PROMPT_READY_FLAG_ADDRESS` using its `readC64Memory` function (which now internally uses `virtualc64web`'s mechanisms, e.g., `vc64web_player.peek()`).
6.  When the flag is detected:
    *   Javascript reads the prompt ("HI") from `PROMPT_BUFFER_ADDRESS`.
    *   The prompt is displayed in the HTML chat log.
    *   Javascript sends the prompt to a (currently mocked) Chat API.
    *   The Chat API's response is received.
    *   The response is displayed in the HTML chat log.
    *   Javascript converts the response to PETSCII bytes and writes it to `RESPONSE_BUFFER_ADDRESS` (0xC100) and sets `RESPONSE_READY_FLAG_ADDRESS` (0xCFFE) using its `writeC64Memory` function (internally using e.g. `vc64web_player.poke()`). (The current `chatinput.prg` does not read this response).

## Memory Map (JS <-> C64 Interaction)

(This section remains the same as it defines our application's protocol)
*   **Prompt Buffer:** `0xC000` (49152) - C64 writes, JS reads.
*   **Prompt Ready Flag:** `0xCFFF` (53247) - C64 writes `0x01`, JS reads and should reset to `0x00` after processing.
*   **Response Buffer:** `0xC100` (49408) - JS writes, C64 can read.
*   **Response Ready Flag:** `0xCFFE` (53246) - JS writes `0x01`, C64 can read.

## How to Test

1.  Open `c64-chat-client/index.html` in a modern web browser.
2.  Open the browser's Developer Console.
3.  **Observe:**
    *   Console logs showing `virtualc64web` being initialized and `chatinput.prg` being loaded.
    *   The C64 emulator should appear on the page and briefly show output from `chatinput.prg` (e.g., "SENT HI").
    *   After a few seconds (due to polling), console logs from `main.js` should indicate:
        *   The prompt ready flag was detected.
        *   The prompt "HI" was read from C64 memory.
        *   The flag was cleared.
        *   The prompt "HI" was sent to the (mocked) Chat API.
        *   The mocked response was received and processed.
    *   The HTML "Chat Log" section should display:
        *   "User (C64): HI"
        *   "Assistant: Mocked C64 reply to: 'HI'"
4.  **Debug Utility (Optional):**
    *   You can use `window.simulateC64Prompt("YOUR MESSAGE");` in the console to manually trigger the JS-to-API logic with a custom message. This uses the current `writeC64Memory` functions to interact with `virtualc64web`.

This provides a basic framework. Future development would involve creating a more interactive C64 program for inputting custom prompts and displaying responses from the Chat API on the C64 screen.

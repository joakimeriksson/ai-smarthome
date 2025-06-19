# C64 Chat Client (with vice.js)

This project is a web-based application that aims to simulate a chat client running on a Commodore 64 (C64), interacting with a modern chat API (like OpenAI's). It now uses `vice.js` for C64 emulation.

## Overview

The project consists of:
1.  An HTML page (`index.html`) that hosts the application and the `vice.js` emulator canvas.
2.  Javascript code (`main.js`) that:
    *   Initializes and configures the `vice.js` C64 emulator.
    *   Loads a predefined C64 program (`chatinput.prg`) into the emulator.
    *   Manages communication between the C64 environment (via `vice.js` memory access) and a chat API.
    *   Provides a visual chat log in the HTML page.
3.  A simple C64 program (`chatinput.prg`, embedded as a base64 string in `main.js`) which automatically:
    *   Writes a sample prompt ("HI") to a specific C64 memory location (`PROMPT_BUFFER_ADDRESS`).
    *   Sets a "prompt ready" flag in another memory location (`PROMPT_READY_FLAG_ADDRESS`).
    *   Prints a message to the C64 screen.

## Prerequisites for Running

**Manual Setup Required:**
You must obtain the core `vice.js` emulator files and place them in the `c64-chat-client/js/` directory. These files are:
*   `x64.js`
*   `x64.wasm` (WebAssembly file, usually loaded by `x64.js`)

These files can be found in the `js` folder of the `rjanicek/vice.js` GitHub repository: [https://github.com/rjanicek/vice.js/tree/master/js](https://github.com/rjanicek/vice.js/tree/master/js).

## Interaction Flow

1.  When `index.html` is loaded, `main.js` initializes `vice.js`.
2.  `main.js` loads `chatinput.prg` (from an embedded base64 string) into the `vice.js` virtual filesystem.
3.  `vice.js` is configured to auto-run `chatinput.prg`.
4.  `chatinput.prg` executes on the C64:
    *   Writes "HI" (as PETSCII bytes) to `PROMPT_BUFFER_ADDRESS` (0xC000).
    *   Writes `0x01` to `PROMPT_READY_FLAG_ADDRESS` (0xCFFF).
5.  The Javascript (`main.js`) polls the `PROMPT_READY_FLAG_ADDRESS` using `readC64Memory` (which accesses `vice.js`'s `Module.HEAPU8`).
6.  When the flag is detected:
    *   Javascript reads the prompt ("HI") from `PROMPT_BUFFER_ADDRESS`.
    *   The prompt is displayed in the HTML chat log.
    *   Javascript sends the prompt to a (currently mocked) Chat API.
    *   The Chat API's response is received.
    *   The response is displayed in the HTML chat log.
    *   Javascript converts the response to PETSCII bytes and writes it to `RESPONSE_BUFFER_ADDRESS` (0xC100) and sets `RESPONSE_READY_FLAG_ADDRESS` (0xCFFE) using `writeC64Memory`. (The current `chatinput.prg` does not read this response).

## Memory Map (JS <-> C64 Interaction)

*   **Prompt Buffer:** `0xC000` (49152) - C64 writes, JS reads.
*   **Prompt Ready Flag:** `0xCFFF` (53247) - C64 writes `0x01`, JS reads and resets to `0x00`.
*   **Response Buffer:** `0xC100` (49408) - JS writes, C64 can read.
*   **Response Ready Flag:** `0xCFFE` (53246) - JS writes `0x01`, C64 can read.

## How to Test

1.  **Complete Prerequisites:** Ensure `x64.js` and `x64.wasm` are in the `c64-chat-client/js/` directory.
2.  Open `c64-chat-client/index.html` in a modern web browser (Firefox or Chrome recommended for Emscripten compatibility).
3.  Open the browser's Developer Console.
4.  **Observe:**
    *   Console logs showing `vice.js` initialization, `chatinput.prg` loading, and emulator startup.
    *   The C64 screen should appear in the canvas and briefly show output from `chatinput.prg` (e.g., "SENT HI").
    *   After a few seconds (due to polling), console logs from `main.js` should indicate:
        *   The prompt ready flag was detected.
        *   The prompt "HI" was read from C64 memory.
        *   The flag was cleared.
        *   The prompt "HI" was sent to the (mocked) Chat API.
        *   The mocked response was received and processed (written to C64 response memory).
    *   The HTML "Chat Log" section should display:
        *   "User (C64): HI"
        *   "Assistant: Mocked C64 reply to: 'HI'" (or similar, based on current mock)
5.  **Debug Utility (Optional):**
    *   You can still use `window.simulateC64Prompt("YOUR MESSAGE");` in the console to manually trigger the JS-to-API logic with a custom message, bypassing the C64 program's input. This uses the same `writeC64Memory` functions to interact with `vice.js`.

This provides a basic framework. Future development would involve creating a more interactive C64 program for inputting custom prompts and displaying responses.

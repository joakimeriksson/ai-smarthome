# C64 Chat Client

This project is a web-based application that aims to simulate a chat client running on a Commodore 64 (C64), interacting with a modern chat API (like OpenAI's).

## Overview

The project consists of:
1.  An HTML page (`index.html`) that hosts the application.
2.  Javascript code (`main.js`) that:
    *   Simulates the presence of a C64 emulator.
    *   Manages communication between the (conceptual) C64 environment and a chat API.
    *   Provides a visual chat log in the HTML page.
3.  A conceptual C64 program (not implemented here) that would:
    *   Allow users to type prompts on the C64.
    *   Store these prompts in a specific C64 memory location.
    *   Signal to the Javascript that a prompt is ready.
    *   Optionally, read a response from another memory location (written by Javascript) and display it on the C64 screen.

## Interaction Flow (Simulated)

1.  A C64 program (conceptual) writes the user's chat prompt to a specific memory address and sets a "prompt ready" flag.
2.  The Javascript (`main.js`) polls this flag.
3.  When the flag is detected, Javascript reads the prompt from C64 memory.
4.  The prompt is displayed in the HTML chat log.
5.  Javascript sends the prompt to a (currently mocked) Chat API.
6.  The Chat API's response is received.
7.  The response is displayed in the HTML chat log.
8.  Javascript converts the response to PETSCII bytes and writes it to a designated C64 memory area, then sets a "response ready" flag for the C64 program to pick up.

## Memory Map (for JS <-> C64 Interaction)

The following C64 memory addresses are used for communication between the Javascript environment and the conceptual C64 program:

*   **Prompt Buffer:** `0xC000` (49152)
    *   Purpose: C64 program writes the user's PETSCII prompt here. Javascript reads from here.
    *   Max Length: 255 bytes (defined in `main.js` as `PROMPT_MAX_LENGTH`).
*   **Prompt Ready Flag:** `0xCFFF` (53247)
    *   Purpose: C64 program writes `0x01` when a prompt is ready in the buffer. Javascript reads this flag and should reset it to `0x00` after processing the prompt.
*   **Response Buffer:** `0xC100` (49408)
    *   Purpose: Javascript writes the chat API's PETSCII response here. C64 program would read from here.
    *   Max Length: 255 bytes (defined in `main.js` as `RESPONSE_MAX_LENGTH`).
*   **Response Ready Flag:** `0xCFFE` (53246)
    *   Purpose: Javascript writes `0x01` when a response is ready in the buffer. C64 program would read this flag and reset it.

## How to Test (Current Mocked Version)

1.  Open `c64-chat-client/index.html` in a modern web browser.
2.  Open the browser's Developer Console.
3.  You should see log messages indicating the system is initialized and polling for C64 prompts.
4.  To simulate a C64 user entering a prompt, type the following into the console and press Enter:
    ```javascript
    window.simulateC64Prompt("YOUR TEST MESSAGE HERE");
    ```
    For example:
    ```javascript
    window.simulateC64Prompt("Hello assistant, how are you?");
    ```
5.  Observe the console logs. You'll see the simulated interaction: prompt detection, API call (mocked), response handling, and writing data to the (mocked) C64 memory locations.
6.  Check the "Chat Log" section on the HTML page. Your prompt and the assistant's mocked response should appear there.
7.  You can inspect the shared memory (mocked) by typing these in the console:
    *   `window.c64PromptReady` (should be `0` after JS processes it)
    *   `window.c64PromptBuffer` (shows the last prompt sent from C64)
    *   `window.c64ResponseReady` (should be `1` after JS processes an API response)
    *   `window.c64ResponseBuffer` (shows the last response written for C64)

This provides a basic framework. To make it fully functional, a real JS/WASM C64 emulator would need to be integrated, and a corresponding C64 assembly/BASIC program would need to be developed.

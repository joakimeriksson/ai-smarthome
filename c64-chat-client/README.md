# C64 Chat Client (using virtualc64web and Serial Communication)

This project demonstrates a web-based application where a Commodore 64 (C64) emulator, powered by `virtualc64web` (via `vc64web_player.js`), interacts with a modern chat API (e.g., Ollama, OpenAI). The communication between the C64 program and the JavaScript environment is achieved through emulated RS232 serial communication.

## Project Purpose

The primary goal is to enable a user to "chat" with an AI assistant from within a C64 emulator running in their web browser. The C64 program sends user input to the JavaScript environment, which then forwards it to a chat API. The API's response is relayed back to the C64 program and displayed on the emulated screen. This showcases a bridge between vintage computing and modern AI capabilities.

## How it Works

The system operates through a combination of C64 emulation, JavaScript bridging, and API communication:

1.  **C64 Emulation**: `test_emulator.html` uses the `vc64web_player.js` library to embed and run a C64 emulator in the browser. This emulator loads necessary C64 ROMs (Kernal, Basic, Charset) and a specific C64 program (`chatinput.prg`, embedded within `test_emulator.html`).
2.  **C64 Program (`chatinput.prg`)**: This BASIC program running on the emulated C64 is responsible for:
    *   Accepting user input from the C64 keyboard.
    *   Sending this input out via the emulated RS232 serial port.
    *   Listening for responses on the serial port.
    *   Displaying received responses on the C64 screen.
3.  **JavaScript Orchestration (`test_emulator.html`)**:
    *   Initializes the C64 emulator and loads the `chatinput.prg`.
    *   Periodically checks for data sent from the C64 program via the emulated serial port (specifically, it looks for a global variable `rs232_message` within the emulator's iframe).
4.  **API Communication (`main.js`)**:
    *   When `test_emulator.html` detects a message from the C64, it calls the `send_chat()` function in `main.js`.
    *   `send_chat()` then calls `sendPromptToChatAPI()`, which formats the C64's message and sends it to an OpenAI-compatible chat API (e.g., a local Ollama instance).
5.  **Response Relay**:
    *   The chat API's response is received by `main.js`.
    *   `test_emulator.html` takes this response and writes it back to the C64 emulator's serial input using `vc64web_player.exec("wasm_write_string_to_ser", ...)`.
    *   The `chatinput.prg` on the C64 reads this serial data and displays it.

This creates a loop where the user types on the C64, the message goes to the AI, and the AI's reply appears back on the C64 screen.

## Key Files

*   **`test_emulator.html`**:
    *   The main HTML page that hosts the C64 emulator.
    *   Contains JavaScript logic to initialize `vc64web_player.js`, load the C64 program, and manage the communication loop.
    *   Includes UI elements for manual serial port testing (sending text to C64 and reading output).
    *   Orchestrates the periodic checking of C64 serial output and relaying messages to/from `main.js`.
*   **`main.js`**:
    *   Defines `sendPromptToChatAPI()`: Handles the actual communication with an OpenAI-compatible chat API (defaults to local Ollama). This function takes the user's text, system prompt, and other parameters to make an API request.
    *   Defines `send_chat()`: A global JavaScript function called by `test_emulator.html` to initiate the chat process with a prompt string received from the C64.
*   **`vc64web_player.js`** (and associated `vc64.js`, `vc64.wasm`):
    *   The core C64 emulator library. It's responsible for emulating the C64 hardware, running C64 programs, and providing JavaScript interfaces for interaction (like reading/writing to serial, memory, etc.). These files are expected to be in the same directory or their paths correctly configured.
*   **`chatinput.prg`** (embedded as base64 in `test_emulator.html`):
    *   The C64 BASIC program that runs inside the emulator.
    *   Its role is to take input from the user on the C64, send it via the emulated serial port, wait for a response on the serial port, and then print that response to the C64 screen.
*   **`roms/` directory (not included in repo, user-provided)**:
    *   This directory must contain the C64 ROM files: `basic.rom`, `kernal.rom`, and `chargen.rom`. The emulator (`test_emulator.html`) is configured to load these from a `roms/` subdirectory.

## Setup and Usage

1.  **Obtain C64 ROM Files**:
    *   You need the standard Commodore 64 ROM files: `basic.rom`, `kernal.rom`, and `chargen.rom`. These are copyrighted and not provided with this project.
    *   Create a subdirectory named `roms` within the `c64-chat-client` directory.
    *   Place the three ROM files into this `c64-chat-client/roms/` directory.

2.  **Ensure Chat API Availability**:
    *   The `main.js` script is configured by default to connect to an OpenAI-compatible API at `http://localhost:11434/v1/chat/completions`. This is the standard endpoint for a locally running Ollama instance.
    *   Make sure you have Ollama (or another compatible API service) running and accessible at this address.
    *   You can modify the `CHAT_API_ENDPOINT` and `model` (default "gemma3:4b") constants in `main.js` if your API is located elsewhere or if you wish to use a different model.

3.  **Run the Application**:
    *   Open the `c64-chat-client/test_emulator.html` file in a modern web browser (e.g., Chrome, Firefox).
    *   The C64 emulator should load and automatically start the `chatinput.prg` program. You should see the C64 BASIC "READY." prompt, followed by messages from the chat program.

4.  **Interact with the Chat Client**:
    *   The C64 program `chatinput.prg` will prompt you with "CHAT>".
    *   Type your message to the AI assistant and press `RETURN`.
    *   The C64 program will display "SENDING: [your message]".
    *   It will then show "WAITING FOR RESPONSE...".
    *   The JavaScript code in `test_emulator.html` will detect this message via the emulated serial port, pass it to `main.js`, which sends it to the chat API.
    *   When the API responds, the response is sent back to the C64 program via serial input.
    *   The C64 program will then print the AI's response on the screen.
    *   You can then type another message. To quit the C64 input loop, you can type "QUIT" (case-sensitive) and press `RETURN`.

5.  **Developer Console**:
    *   Open your browser's developer console to see log messages from both `test_emulator.html` and `main.js`, which can be helpful for debugging. This includes messages about serial data being sent/received and interactions with the chat API.

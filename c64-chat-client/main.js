// --- C64 Emulator Integration ---
const CHAT_API_KEY = 'YOUR_API_KEY_HERE'; // Placeholder
const CHAT_API_ENDPOINT = 'YOUR_CHAT_API_ENDPOINT_HERE'; // Placeholder

// --- C64 Memory Map ---
const PROMPT_BUFFER_ADDRESS = 0xC000; // 49152
const PROMPT_MAX_LENGTH = 255; // Max length for the prompt
const PROMPT_READY_FLAG_ADDRESS = 0xCFFF; // 53247

const RESPONSE_BUFFER_ADDRESS = 0xC100; // 49408
const RESPONSE_MAX_LENGTH = 255;     // Max length for the response
const RESPONSE_READY_FLAG_ADDRESS = 0xCFFE; // 53246


// --- PETSCII Conversion ---
const PETSCII_TO_ASCII = {
    0x0D: '\n', // RETURN key
    0x20: ' ', // Space
};
for (let i = 0x41; i <= 0x5A; i++) { // A-Z
    PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x41 + 65);
}
for (let i = 0x30; i <= 0x39; i++) { // 0-9
    PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x30 + 48);
}
PETSCII_TO_ASCII[0x21] = '!';
PETSCII_TO_ASCII[0x2E] = '.';
PETSCII_TO_ASCII[0x3F] = '?';

const ASCII_TO_PETSCII = {};
for (const key in PETSCII_TO_ASCII) {
    ASCII_TO_PETSCII[PETSCII_TO_ASCII[key]] = parseInt(key);
}
for (let i = 65; i <= 90; i++) { // A-Z
    const char = String.fromCharCode(i);
    if (PETSCII_TO_ASCII[0x41 + i - 65] === char) {
         ASCII_TO_PETSCII[char] = 0x41 + i - 65;
    }
}
for (let i = 97; i <= 122; i++) { // a-z
    const charUpper = String.fromCharCode(i).toUpperCase();
    if (ASCII_TO_PETSCII[charUpper]) {
        ASCII_TO_PETSCII[String.fromCharCode(i)] = ASCII_TO_PETSCII[charUpper];
    }
}
ASCII_TO_PETSCII['!'] = ASCII_TO_PETSCII['!'] || 0x21;
ASCII_TO_PETSCII['.'] = ASCII_TO_PETSCII['.'] || 0x2E;
ASCII_TO_PETSCII['?'] = ASCII_TO_PETSCII['?'] || 0x3F;
ASCII_TO_PETSCII[' '] = ASCII_TO_PETSCII[' '] || 0x20;
ASCII_TO_PETSCII['\n'] = ASCII_TO_PETSCII['\n'] || 0x0D;

function convertStringToPETSCIIBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length && bytes.length < RESPONSE_MAX_LENGTH -1 ; i++) {
        const char = str[i];
        const petsciiCode = ASCII_TO_PETSCII[char];
        if (petsciiCode !== undefined) {
            bytes.push(petsciiCode);
        } else {
            bytes.push(ASCII_TO_PETSCII['?'] || 0x3F);
        }
    }
    bytes.push(0x0D);
    if (bytes.length < RESPONSE_MAX_LENGTH) {
         bytes.push(0x00);
    }
    return new Uint8Array(bytes.slice(0, RESPONSE_MAX_LENGTH));
}

function convertPETSCIIBytesToString(byteArray) {
    let str = "";
    for (let i = 0; i < byteArray.length; i++) {
        const byte = byteArray[i];
        if (byte === 0x00 || byte === 0x0D) {
            break;
        }
        str += PETSCII_TO_ASCII[byte] || '?';
    }
    return str;
}

// --- Global testing variables ---
window.c64PromptReady = 0x00;
window.c64PromptBuffer = [];
window.c64ResponseBuffer = new Uint8Array(RESPONSE_MAX_LENGTH);
window.c64ResponseReady = 0x00;

window.simulateC64Prompt = function(text) {
    window.c64PromptBuffer = Array.from(text).map(char => {
        const upperChar = char.toUpperCase();
        if (ASCII_TO_PETSCII[char]) return ASCII_TO_PETSCII[char];
        if (ASCII_TO_PETSCII[upperChar]) return ASCII_TO_PETSCII[upperChar];
        return ASCII_TO_PETSCII['?'] || 0x3F;
    });
    window.c64PromptBuffer = window.c64PromptBuffer.slice(0, PROMPT_MAX_LENGTH -1);
    window.c64PromptBuffer.push(0x0D);
    window.c64PromptReady = 0x01;
    console.log(`Simulated C64: Set prompt to "${text}" (Buffer: ${window.c64PromptBuffer.map(b => "0x"+b.toString(16)).join(',')}) and raised flag.`);
}

function initializeEmulator() {
    console.log("Emulator initialization logic would go here.");
    console.log("Attaching emulator to #emulator-container");
}

async function readC64Memory(address, length) {
    // console.log(`JS: Reading ${length} bytes from C64 memory address 0x${address.toString(16)}`); // Too noisy for polling
    if (address === PROMPT_READY_FLAG_ADDRESS) {
        return new Uint8Array([window.c64PromptReady]);
    } else if (address === PROMPT_BUFFER_ADDRESS) {
        const buffer = new Uint8Array(length);
        for(let i=0; i < length; i++) {
            buffer[i] = window.c64PromptBuffer[i] || 0;
        }
        return buffer;
    } else if (address === RESPONSE_READY_FLAG_ADDRESS) {
        return new Uint8Array([window.c64ResponseReady]);
    } else if (address === RESPONSE_BUFFER_ADDRESS) {
        const buffer = new Uint8Array(length);
        for(let i=0; i < length; i++) {
            buffer[i] = window.c64ResponseBuffer[i] || 0;
        }
        return buffer;
    }
    return new Uint8Array(length);
}

async function writeC64Memory(address, data) {
    console.log(`JS: Writing data to C64 memory address 0x${address.toString(16)}: ${Array.from(data).map(b => "0x"+b.toString(16)).join(',')}`);
    if (address === PROMPT_READY_FLAG_ADDRESS && data[0] === 0x00) {
        window.c64PromptReady = 0x00;
        console.log("JS: Prompt flag reset in mock C64 memory by JS writing 0x00.");
    } else if (address === RESPONSE_BUFFER_ADDRESS) {
        window.c64ResponseBuffer.set(data.slice(0, RESPONSE_MAX_LENGTH));
        console.log(`Mock C64: Response buffer updated at 0x${address.toString(16)}. View with 'window.c64ResponseBuffer'.`);
    } else if (address === RESPONSE_READY_FLAG_ADDRESS) {
        window.c64ResponseReady = data[0];
        console.log(`Mock C64: Response ready flag set to 0x${data[0].toString(16)} at 0x${address.toString(16)}. View with 'window.c64ResponseReady'.`);
    }
}

// --- Chat API Connector ---
async function sendPromptToChatAPI(promptText) {
    console.log(`Sending prompt to Chat API: "${promptText}"`);
    const requestPayload = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful C64 assistant. Respond in clear, concise text suitable for a C64 display." },
        { role: "user", content: promptText }
      ]
    };
    // console.log("Request payload:", requestPayload); // Can be noisy
    // console.log(`Using API Key (placeholder): ${CHAT_API_KEY}`);
    // console.log(`Using API Endpoint (placeholder): ${CHAT_API_ENDPOINT}`);

    return new Promise(resolve => {
        setTimeout(() => {
            const mockResponse = {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "Mocked C64 reply to: '" + promptText + "'"
                        }
                    }
                ]
            };
            console.log("Mock API call successful. Response:", mockResponse);
            resolve(mockResponse);
        }, 1000);
    });
}

// --- HTML Chat Log Display ---
function appendToChatLog(speaker, text) {
    const chatLogContainer = document.getElementById('chat-log-container');
    if (chatLogContainer) {
        const messageElement = document.createElement('p');
        // Basic sanitization for HTML display
        const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        messageElement.innerHTML = `<strong>${speaker}:</strong> ${sanitizedText.replace(/\n/g, '<br>')}`;
        chatLogContainer.appendChild(messageElement);
        chatLogContainer.scrollTop = chatLogContainer.scrollHeight; // Scroll to bottom
    } else {
        console.warn("Chat log container not found in HTML.");
    }
}

async function checkC64Prompt() {
    const flagArray = await readC64Memory(PROMPT_READY_FLAG_ADDRESS, 1);
    const flag = flagArray[0];

    if (flag === 0x01) {
        console.log("JS: Prompt ready flag is set (0x01)!");
        const promptBytes = await readC64Memory(PROMPT_BUFFER_ADDRESS, PROMPT_MAX_LENGTH);
        const promptText = convertPETSCIIBytesToString(promptBytes);

        console.log(`JS: Read prompt from C64: "${promptText}"`);
        if (promptText.trim().length > 0) { // Only process if not empty
            appendToChatLog("User (C64)", promptText);
        }

        await writeC64Memory(PROMPT_READY_FLAG_ADDRESS, new Uint8Array([0x00]));

        if (promptText.trim().length > 0) {
            sendPromptToChatAPI(promptText)
                .then(async response => {
                    console.log("JS: Chat API response received:", response);
                    const assistantResponse = response.choices[0].message.content;
                    console.log("JS: Assistant says:", assistantResponse);
                    appendToChatLog("Assistant", assistantResponse);

                    console.log("JS: Preparing to write response back to C64 memory...");
                    const responseBytes = convertStringToPETSCIIBytes(assistantResponse);
                    console.log("JS: Converted response to PETSCII bytes:", responseBytes);

                    await writeC64Memory(RESPONSE_BUFFER_ADDRESS, responseBytes);
                    await writeC64Memory(RESPONSE_READY_FLAG_ADDRESS, new Uint8Array([0x01]));
                })
                .catch(error => {
                    console.error("JS: Error calling Chat API:", error);
                    appendToChatLog("System", `Error: ${error.message || error}`);
                });
        } else {
            console.log("JS: Prompt was empty or only whitespace, not sending to API and not logging to chat.");
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeEmulator();
    setInterval(checkC64Prompt, 3000);
    console.log("Started polling for C64 prompts. Call simulateC64Prompt('YOUR TEXT') to test the flow.");
    console.log("To view C64 mock memory: window.c64PromptReady, window.c64PromptBuffer, window.c64ResponseReady, window.c64ResponseBuffer");
    appendToChatLog("System", "Chat client initialized. Waiting for C64 prompts or API responses.");
});

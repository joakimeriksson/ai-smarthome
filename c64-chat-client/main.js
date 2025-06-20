// --- Global C64 Program Data ---
const c64ProgramBase64 = 'AQgYCApOIDQ5MTUyLDcyup4gNDkxNTMsNzO6niA0OTE1NCwwABQIFJ4gNTMyNDcsMQADDggepCITU0VOVCBISSIABA==';
const c64ProgramName = 'chatinput.prg';

// --- API Placeholders ---
const CHAT_API_KEY = 'YOUR_API_KEY_HERE'; // Placeholder
const CHAT_API_ENDPOINT = 'YOUR_CHAT_API_ENDPOINT_HERE'; // Placeholder

// --- C64 Memory Map ---
const PROMPT_BUFFER_ADDRESS = 0xC000;
const PROMPT_MAX_LENGTH = 255;
const PROMPT_READY_FLAG_ADDRESS = 0xCFFF;

const RESPONSE_BUFFER_ADDRESS = 0xC100;
const RESPONSE_MAX_LENGTH = 255;
const RESPONSE_READY_FLAG_ADDRESS = 0xCFFE;

// --- PostMessage Read Globals ---
let pendingC64Reads = {};
let c64ReadRequestId = 0;
const C64_READ_TIMEOUT_MS = 5000; // 5 seconds for read timeout


// --- PETSCII Conversion ---
const PETSCII_TO_ASCII = {
    0x0D: '\n',
    0x20: ' ',
    0x48: 'H',
    0x49: 'I',
};
for (let i = 0x41; i <= 0x5A; i++) {
    if (!PETSCII_TO_ASCII[i]) PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x41 + 65);
}
for (let i = 0x30; i <= 0x39; i++) {
    if (!PETSCII_TO_ASCII[i]) PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x30 + 48);
}
PETSCII_TO_ASCII[0x21] = PETSCII_TO_ASCII[0x21] || '!';
PETSCII_TO_ASCII[0x2E] = PETSCII_TO_ASCII[0x2E] || '.';
PETSCII_TO_ASCII[0x3F] = PETSCII_TO_ASCII[0x3F] || '?';

const ASCII_TO_PETSCII = {};
for (const key in PETSCII_TO_ASCII) {
    ASCII_TO_PETSCII[PETSCII_TO_ASCII[key]] = parseInt(key);
}
for (let i = 65; i <= 90; i++) {
    const char = String.fromCharCode(i);
    if (PETSCII_TO_ASCII[0x41 + i - 65] === char && !ASCII_TO_PETSCII[char]) {
         ASCII_TO_PETSCII[char] = 0x41 + i - 65;
    }
}
for (let i = 97; i <= 122; i++) {
    const charUpper = String.fromCharCode(i).toUpperCase();
    if (ASCII_TO_PETSCII[charUpper] && !ASCII_TO_PETSCII[String.fromCharCode(i)]) {
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
    const inputStr = String(str || "");
    for (let i = 0; i < inputStr.length && bytes.length < RESPONSE_MAX_LENGTH -1 ; i++) {
        const char = inputStr[i];
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
        if (byte === 0x00) {
            break;
        }
        if (byte === 0x0D && i === byteArray.length -1 ) {
             break;
        }
        str += PETSCII_TO_ASCII[byte] || `[${byte.toString(16)}]`;
    }
    return str;
}

window.simulateC64Prompt = async function(text) {
    appendToChatLog("Debug", `JS simulating C64 prompt: "${text}"`);
    const promptPetsciiBytes = convertStringToPETSCIIBytes(text);
    await writeC64Memory(PROMPT_BUFFER_ADDRESS, promptPetsciiBytes);
    console.log(`Debug: JS Wrote prompt "${text}" (PETSCII) to 0x${PROMPT_BUFFER_ADDRESS.toString(16)}`);
    await writeC64Memory(PROMPT_READY_FLAG_ADDRESS, new Uint8Array([0x01]));
    console.log(`Debug: JS Set prompt ready flag at 0x${PROMPT_READY_FLAG_ADDRESS.toString(16)}`);
};

function initializeEmulator() {
    console.log("Initializing virtualc64web emulator...");
    appendToChatLog("System", "Initializing virtualc64web emulator...");

    const targetElement = document.getElementById('emulator_target');
    if (!targetElement) {
        console.error("Emulator target element 'emulator_target' not found!");
        appendToChatLog("System Error", "Emulator target HTML element not found.");
        return;
    }

    if (typeof vc64web_player === 'undefined') {
        console.error("vc64web_player is not defined. Ensure vc64web_player.js is loaded before main.js.");
        appendToChatLog("System Error", "Emulator player script (vc64web_player.js) not loaded.");
        return;
    }

    vc64web_player.samesite_file = {
      base64: c64ProgramBase64,
      name: c64ProgramName
    };

    const config = {
      openROMS: true,
      navbar: 'hidden',
      wide: false,
      border: 0.1,
      autostart: true,
      mute: false,
      wait_for_assets: false,
      hide_utils: true,
    };

    console.log(`Loading virtualc64web with samesite_file: \${vc64web_player.samesite_file.name} and config:`, config);
    appendToChatLog("System", `Loading \${c64ProgramName} into virtualc64web...`);
    try {
        vc64web_player.load(targetElement, config);
        console.log(`virtualc64web emulator loaded with \${c64ProgramName}. Autostart is true.`);
        appendToChatLog("System", `\${c64ProgramName} loaded, emulator starting.`);
    } catch (e) {
        console.error("Error calling vc64web_player.load():", e);
        appendToChatLog("System Error", `Failed to load emulator: \${e.message || String(e)}\`);
    }
}

async function readC64Memory(address, length) {
    return new Promise((resolve, reject) => {
        if (typeof vc64web_player === 'undefined' || typeof vc64web_player.exec !== 'function') {
            appendToChatLog("System Warning", "Emulator exec function not available for reading memory.");
            reject(new Error("vc64web_player.exec is not available. Emulator not ready or script not loaded."));
            return;
        }

        const readLength = Math.max(0, length);
        const requestId = `readReq${c64ReadRequestId++}`;

        pendingC64Reads[requestId] = { resolve, reject };

        const codeToExecute = `
            (function() {
                const addr = ${address};
                const len = ${readLength};
                const reqId = '${requestId}';
                const result = [];
                try {
                    if (typeof wasm_peek !== 'function') {
                        throw new Error('wasm_peek is not defined in iframe.');
                    }
                    for (let i = 0; i < len; i++) {
                        result.push(wasm_peek(addr + i));
                    }
                    window.parent.postMessage({ type: 'c64ReadResult', id: reqId, data: result }, '*');
                } catch (e) {
                    window.parent.postMessage({ type: 'c64ReadResult', id: reqId, error: e.message || String(e) }, '*');
                }
            })();
        `;

        try {
            vc64web_player.exec(codeToExecute);
            setTimeout(() => {
                if (pendingC64Reads[requestId]) {
                    appendToChatLog("System Error", `C64 Read Timeout (ID: \${requestId})`);
                    pendingC64Reads[requestId].reject(new Error(`C64 read operation timed out for ID: \${requestId}`));
                    delete pendingC64Reads[requestId];
                }
            }, C64_READ_TIMEOUT_MS);

        } catch (e) {
            console.error(\`Error executing vc64web_player.exec for read (ID: \${requestId}):\`, e);
            appendToChatLog("System Error", `Failed to initiate C64 read: \${e.message}`);
            delete pendingC64Reads[requestId];
            reject(e);
        }
    });
}


async function writeC64Memory(address, dataArray) {
    if (typeof vc64web_player === 'undefined' || typeof vc64web_player.exec !== 'function') {
        appendToChatLog("System Warning", "Emulator exec function not available for writing memory.");
        console.warn("JS: writeC64Memory - vc64web_player.exec not available.");
        return Promise.reject(new Error("vc64web_player.exec is not available for writing.")); // Return a rejected promise
    }

    if (!dataArray || dataArray.length === 0) {
        // console.warn("JS: writeC64Memory - No data provided to write.");
        return Promise.resolve(); // Or reject, depending on desired behavior for empty writes
    }

    // Convert Uint8Array to a string representation of a JS array, e.g., "[72,73,0]"
    const dataString = `[${Array.from(dataArray).join(',')}]`;

    const codeToExecute = `
        (function() {
            const addr = ${address};
            const data = ${dataString};
            try {
                if (typeof wasm_poke !== 'function') {
                    // console.error('wasm_poke is not defined in iframe.'); // Log in iframe console
                    throw new Error('wasm_poke is not defined in iframe.');
                }
                for (let i = 0; i < data.length; i++) {
                    wasm_poke(addr + i, data[i]);
                }
                // console.log('Wrote ' + data.length + ' bytes to ' + addr + ' in iframe.'); // Log in iframe console
            } catch (e) {
                // console.error('Error in iframe during wasm_poke: ' + (e.message || String(e))); // Log in iframe console
                // Optionally, could try to postMessage an error back if write confirmation is needed,
                // but current spec for write doesn't involve a response.
            }
        })();
    `;

    try {
        // console.log(\`Executing code in iframe for write to address: 0x\${address.toString(16)}\`);
        vc64web_player.exec(codeToExecute);
        return Promise.resolve(); // Indicate success of dispatching the write command
    } catch (e) {
        console.error(\`Error executing vc64web_player.exec for write to 0x\${address.toString(16)}:\`, e);
        appendToChatLog("System Error", `Failed to initiate C64 write: \${e.message}`);
        return Promise.reject(e); // Propagate the error
    }
}


async function sendPromptToChatAPI(promptText) {
    console.log(`Sending prompt to Chat API: "${promptText}"`);
    const requestPayload = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful C64 assistant. Respond in clear, concise text suitable for a C64 display." },
        { role: "user", content: promptText }
      ]
    };
    return new Promise(resolve => {
        setTimeout(() => {
            const mockResponse = {
                choices: [ { message: { role: "assistant", content: "Mocked C64 reply to: '" + promptText + "'" } } ]
            };
            console.log("Mock API call successful. Response:", mockResponse);
            resolve(mockResponse);
        }, 1000);
    });
}

function appendToChatLog(speaker, text) {
    const chatLogContainer = document.getElementById('chat-log-container');
    if (chatLogContainer) {
        const messageElement = document.createElement('p');
        const sanitizedText = String(text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        messageElement.innerHTML = `<strong>${speaker}:</strong> ${sanitizedText.replace(/\n/g, '<br>')}`;
        chatLogContainer.appendChild(messageElement);
        chatLogContainer.scrollTop = chatLogContainer.scrollHeight;
    } else {
        console.warn("Chat log container not found in HTML.");
    }
}

async function checkC64Prompt() {
    if (typeof vc64web_player === 'undefined' ||
        (typeof vc64web_player.exec !== 'function' && (typeof vc64web_player.peek !== 'function' || typeof vc64web_player.poke !== 'function'))) {
        return;
    }

    try {
        const flagArray = await readC64Memory(PROMPT_READY_FLAG_ADDRESS, 1);
        const flag = flagArray[0];

        if (flag === 0x01) {
            console.log("JS: Prompt ready flag is set (0x01) by C64 program!");
            appendToChatLog("System", "C64 program signaled prompt is ready (flag is 1).");

            const promptBytes = await readC64Memory(PROMPT_BUFFER_ADDRESS, PROMPT_MAX_LENGTH);
            const promptText = convertPETSCIIBytesToString(promptBytes);

            console.log(`JS: Read prompt from C64 memory (0x${PROMPT_BUFFER_ADDRESS.toString(16)}): "${promptText}"`);

            if (promptText.trim().length > 0) {
                appendToChatLog("User (C64)", promptText);
            } else {
                console.log("JS: Prompt text from C64 buffer is empty. Not sending to API.");
                appendToChatLog("System", "Detected ready flag from C64, but prompt buffer was empty.");
            }

            await writeC64Memory(PROMPT_READY_FLAG_ADDRESS, new Uint8Array([0x00]));
            console.log("JS: Prompt ready flag reset to 0x00.");
            appendToChatLog("System", "Prompt flag reset to 0 by JS.");

            if (promptText.trim().length > 0) {
                sendPromptToChatAPI(promptText)
                    .then(async response => {
                        console.log("JS: Chat API response received:", response);
                        const assistantResponse = response.choices[0].message.content;
                        console.log("JS: Assistant says:", assistantResponse);
                        appendToChatLog("Assistant", assistantResponse);

                        console.log("JS: Preparing to write response back to C64 memory...");
                        const responseBytes = convertStringToPETSCIIBytes(assistantResponse);

                        await writeC64Memory(RESPONSE_BUFFER_ADDRESS, responseBytes);
                        await writeC64Memory(RESPONSE_READY_FLAG_ADDRESS, new Uint8Array([0x01]));
                        appendToChatLog("System", `Response written to C64 memory (0x${RESPONSE_BUFFER_ADDRESS.toString(16)}) and response flag set (0x${RESPONSE_READY_FLAG_ADDRESS.toString(16)}).`);
                    })
                    .catch(error => {
                        console.error("JS: Error calling Chat API:", error);
                        appendToChatLog("System", `Error calling API: ${error.message || String(error)}`);
                    });
            }
        }
    } catch (error) {
        console.error("JS: Error in checkC64Prompt polling cycle:", error);
        appendToChatLog("System Error", `Polling cycle error: ${error.message || String(error)}`);
    }
}

// --- PostMessage Event Listener ---
window.addEventListener('message', event => {
    if (event.data && event.data.type === 'c64ReadResult') {
        const { id, data, error } = event.data;
        if (pendingC64Reads[id]) {
            if (error) {
                console.error(`C64 Read Error via postMessage (ID: \${id}):\`, error);
                appendToChatLog("System Error", `C64 Read Error (postMessage ID \${id}): \${error}`);
                pendingC64Reads[id].reject(new Error(error));
            } else {
                pendingC64Reads[id].resolve(new Uint8Array(data));
            }
            delete pendingC64Reads[id];
        }
    }
});


document.addEventListener('DOMContentLoaded', () => {
    initializeEmulator();

    setInterval(checkC64Prompt, 3000);
    console.log("Started polling for C64 prompts.");
    console.log(`The C64 program '\${c64ProgramName}' should autostart with virtualc64web.`);
    appendToChatLog("System", `Chat client initialized. virtualc64web emulator configured with \${c64ProgramName}. Polling for C64 prompts.`);
});

// --- Global C64 Program Data ---
// Program: 10 POKE 49152,72:POKE 49153,73:POKE 49154,0  (Writes "HI" then null to 0xC000)
//          20 POKE 53247,1 (Sets flag 0xCFFF to 1)
//          30 PRINT "SENT HI" (Prints to C64 screen)
const c64ProgramBase64 = 'AQgYCApOIDQ5MTUyLDcyup4gNDkxNTMsNzO6niA0OTE1NCwwABQIFJ4gNTMyNDcsMQADDggepCITU0VOVCBISSIABA==';
const c64ProgramName = 'chatinput.prg';

// --- API Placeholders ---
const CHAT_API_KEY = 'YOUR_API_KEY_HERE'; // Placeholder
const CHAT_API_ENDPOINT = 'YOUR_CHAT_API_ENDPOINT_HERE'; // Placeholder

// --- C64 Memory Map ---
const PROMPT_BUFFER_ADDRESS = 0xC000; // 49152 (chatinput.prg writes "HI" here)
const PROMPT_MAX_LENGTH = 255;
const PROMPT_READY_FLAG_ADDRESS = 0xCFFF; // 53247 (chatinput.prg POKEs this to 1)

const RESPONSE_BUFFER_ADDRESS = 0xC100;
const RESPONSE_MAX_LENGTH = 255;
const RESPONSE_READY_FLAG_ADDRESS = 0xCFFE;


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

    // samesite_file tells vc64web_player to load this program from base64 data
    // instead of fetching from a URL.
    vc64web_player.samesite_file = {
      base64: c64ProgramBase64,
      name: c64ProgramName
    };

    const config = {
      navbar: 'hidden',
      wide: false,
      border: 0.1,
      autostart: true,
      wait_for_assets: false, // true if you have separate .d64, .crt etc. For samesite_file, false is fine.
      hide_utils: true,
      // turbo: true, // Could enable for faster loading/execution if needed.
    };

    console.log(`Loading virtualc64web with samesite_file: \${vc64web_player.samesite_file.name}`);
    appendToChatLog("System", `Loading \${c64ProgramName} into virtualc64web...`);
    try {
        // vc64web_player.load() will replace the content of targetElement with the emulator
        vc64web_player.load(targetElement, config);
        // Note: virtualc64web does not have a direct postRun equivalent like Emscripten's Module.
        // We assume autostart handles running the program.
        // Further interaction (like knowing when it's truly "ready") might require polling memory
        // or specific player events if available.
        console.log(`virtualc64web emulator loaded with \${c64ProgramName}. Autostart is true.`);
        appendToChatLog("System", `\${c64ProgramName} loaded, emulator starting.`);
    } catch (e) {
        console.error("Error calling vc64web_player.load():", e);
        appendToChatLog("System Error", `Failed to load emulator: \${e.message || String(e)}\`);
    }
}

// --- C64 Memory Access (now for virtualc64web) ---
// vc64web_player provides peek() and poke()
async function readC64Memory(address, length) {
    const readLength = Math.max(0, length);
    const data = new Uint8Array(readLength);
    if (typeof vc64web_player !== 'undefined' && vc64web_player.peek) {
        try {
            for (let i = 0; i < readLength; i++) {
                data[i] = vc64web_player.peek(address + i);
            }
            // console.log(`JS: Read \${readLength} bytes from C64 memory address 0x\${address.toString(16)}`);
            return data;
        } catch (e) {
            console.error(`JS: Error reading C64 memory at 0x\${address.toString(16)} for length ${readLength}: ${e.message}`);
            appendToChatLog("System Error", `Failed to read C64 memory: ${e.message}`);
            return data; // Returns zeroed array on error
        }
    } else {
        // console.warn("JS: readC64Memory - vc64web_player.peek not available. Emulator not ready?");
        appendToChatLog("System Warning", "Emulator peek function not available for reading memory.");
        return data; // Returns zeroed array
    }
}

async function writeC64Memory(address, dataArray) { // dataArray should be Uint8Array or array of bytes
    if (!dataArray || dataArray.length === 0) {
        return;
    }
    if (typeof vc64web_player !== 'undefined' && vc64web_player.poke) {
        try {
            for (let i = 0; i < dataArray.length; i++) {
                vc64web_player.poke(address + i, dataArray[i]);
            }
            // console.log(`JS: Wrote \${dataArray.length} bytes to C64 memory address 0x\${address.toString(16)}`);
        } catch (e) {
            console.error(`JS: Error writing to C64 memory at 0x\${address.toString(16)}: ${e.message}`);
            appendToChatLog("System Error", `Failed to write to C64 memory: ${e.message}`);
        }
    } else {
        // console.warn("JS: writeC64Memory - vc64web_player.poke not available. Emulator not ready?");
        appendToChatLog("System Warning", "Emulator poke function not available for writing memory.");
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
}

document.addEventListener('DOMContentLoaded', () => {
    initializeEmulator();

    setInterval(checkC64Prompt, 3000);
    console.log("Started polling for C64 prompts.");
    console.log(`The C64 program '\${c64ProgramName}' should autostart with virtualc64web.`);
    appendToChatLog("System", `Chat client initialized. virtualc64web emulator configured with \${c64ProgramName}. Polling for C64 prompts.`);
});

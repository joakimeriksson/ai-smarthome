var Module = {}; // Declare Module at global scope for vice.js

// --- C64 Emulator Integration ---
const CHAT_API_KEY = 'YOUR_API_KEY_HERE'; // Placeholder
const CHAT_API_ENDPOINT = 'YOUR_CHAT_API_ENDPOINT_HERE'; // Placeholder

// New program: 10 POKE 49152,72:POKE 49153,73:POKE 49154,0  (Writes "HI" then null to 0xC000)
//              20 POKE 53247,1 (Sets flag 0xCFFF to 1)
//              30 PRINT "SENT HI" (Prints to C64 screen)
// Original BASIC:
// 10 POKE 49152,72 : POKE 49153,73 : POKE 49154,0
// 20 POKE 53247,1
// 30 PRINT "SENT HI"
// PRG file (binary for CBM, starts with load address $0801 = 2049)
// Hex: 01 08 18 08 0A 00 9E 20 34 39 31 35 32 2C 37 32 BA 9E 20 34 39 31 35 33 2C 37 33 BA 9E 20 34 39 31 35 34 2C 30 00 14 08 14 00 9E 20 35 33 32 34 37 2C 31 00 1E 08 1E 00 99 20 22 53 45 4E 54 20 48 49 22 00 00 00
const c64ProgramBase64 = 'AQgYCApOIDQ5MTUyLDcyup4gNDkxNTMsNzO6niA0OTE1NCwwABQIFJ4gNTMyNDcsMQADDggepCITU0VOVCBISSIABA==';
const c64ProgramName = 'chatinput.prg';

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
    0x48: 'H', // H
    0x49: 'I', // I
};
// Populate A-Z and 0-9 if not already present by specific chars above
for (let i = 0x41; i <= 0x5A; i++) { // A-Z
    if (!PETSCII_TO_ASCII[i]) PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x41 + 65);
}
for (let i = 0x30; i <= 0x39; i++) { // 0-9
    if (!PETSCII_TO_ASCII[i]) PETSCII_TO_ASCII[i] = String.fromCharCode(i - 0x30 + 48);
}
PETSCII_TO_ASCII[0x21] = PETSCII_TO_ASCII[0x21] || '!';
PETSCII_TO_ASCII[0x2E] = PETSCII_TO_ASCII[0x2E] || '.';
PETSCII_TO_ASCII[0x3F] = PETSCII_TO_ASCII[0x3F] || '?';


const ASCII_TO_PETSCII = {};
for (const key in PETSCII_TO_ASCII) {
    ASCII_TO_PETSCII[PETSCII_TO_ASCII[key]] = parseInt(key);
}
for (let i = 65; i <= 90; i++) { // A-Z
    const char = String.fromCharCode(i);
    if (PETSCII_TO_ASCII[0x41 + i - 65] === char && !ASCII_TO_PETSCII[char]) {
         ASCII_TO_PETSCII[char] = 0x41 + i - 65;
    }
}
for (let i = 97; i <= 122; i++) { // a-z
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
        if (byte === 0x00) { // Stop at null terminator
            break;
        }
        if (byte === 0x0D && i === byteArray.length -1 ) { // Ignore trailing CR if it's the last char before potential null
             break;
        }
        str += PETSCII_TO_ASCII[byte] || `[${byte.toString(16)}]`; // Show unknown byte hex
    }
    return str;
}

// This function is for JS-side testing to manually trigger the prompt logic.
// It simulates a C64 program having written to memory and set the flag.
window.simulateC64Prompt = async function(text) {
    appendToChatLog("Debug", `JS simulating C64 prompt: "${text}"`);
    const promptPetsciiBytes = convertStringToPETSCIIBytes(text);

    await writeC64Memory(PROMPT_BUFFER_ADDRESS, promptPetsciiBytes);
    console.log(`Debug: JS Wrote prompt "${text}" (PETSCII) to 0x${PROMPT_BUFFER_ADDRESS.toString(16)}`);

    await writeC64Memory(PROMPT_READY_FLAG_ADDRESS, new Uint8Array([0x01]));
    console.log(`Debug: JS Set prompt ready flag at 0x${PROMPT_READY_FLAG_ADDRESS.toString(16)}`);
};


function initializeEmulator() {
    console.log("Initializing vice.js emulator Module...");

    Module.canvas = document.getElementById('canvas');
    if (!Module.canvas) {
        console.error("Canvas element not found for vice.js!");
        appendToChatLog("System", "Error: Canvas element for emulator not found. Vice.js cannot start.");
        return;
    }
    console.log("Canvas element for vice.js found and assigned to Module.canvas.");

    Module.arguments = Module.arguments || ['+sound'];

    Module.preRun = Module.preRun || [];
    Module.postRun = Module.postRun || [];

    Module.preRun.push(function() {
        console.log(`JS: Attempting to load \${c64ProgramName} into emulator's filesystem...`);
        try {
            const binaryString = window.atob(c64ProgramBase64); // Use new program base64
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            if (typeof FS === 'undefined') {
                throw new Error("FS (Emscripten File System) is not defined. Emulator not ready?");
            }
            FS.createDataFile('/', c64ProgramName, bytes, true, true); // Use new program name
            console.log(`JS: Successfully created \${c64ProgramName} in virtual FS.`);
            appendToChatLog("System", `C64 program (\${c64ProgramName}) prepared for emulator.`);

            Module.arguments.push('-autostart', c64ProgramName); // Use new program name
            console.log("Vice.js arguments updated for autostart:", Module.arguments);

        } catch (e) {
            console.error('JS: Error loading ' + c64ProgramName + ' into virtual FS: ' + e.message);
            appendToChatLog("System Error", 'Failed to load C64 program (' + c64ProgramName + '): ' + e.message);
        }
    });

    Module.postRun.push(function() {
        console.log("Vice.js emulator (x64) has started (postRun).");
        appendToChatLog("System", "C64 Emulator (vice.js) started.");
    });

    Module.print = Module.print || function(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
        console.log("vice.js stdout:", text);
    };
    Module.printErr = Module.printErr || function(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
        console.error("vice.js stderr:", text);
        appendToChatLog("System Error (Emulator)", text);
    };

    console.log("Vice.js Module configured. Emulator will start once x64.js is loaded and executed.");
}

async function readC64Memory(address, length) {
    const readLength = Math.max(0, length);
    if (Module && Module.HEAPU8 && typeof FS !== 'undefined') {
        try {
            const data = Module.HEAPU8.slice(address, address + readLength);
            return data;
        } catch (e) {
            console.error('JS: Error reading C64 memory at 0x' + address.toString(16) + ' for length ' + readLength + ': ' + e.message);
            appendToChatLog("System Error", 'Failed to read C64 memory: ' + e.message);
            return new Uint8Array(readLength);
        }
    } else {
        appendToChatLog("System Warning", "Emulator memory (HEAPU8 or FS) not available for reading.");
        return new Uint8Array(readLength);
    }
}

async function writeC64Memory(address, dataArray) {
    if (!dataArray || dataArray.length === 0) {
        return;
    }
    if (Module && Module.HEAPU8 && typeof FS !== 'undefined') {
        try {
            Module.HEAPU8.set(dataArray, address);
        } catch (e) {
            console.error('JS: Error writing to C64 memory at 0x' + address.toString(16) + ': ' + e.message);
            appendToChatLog("System Error", 'Failed to write to C64 memory: ' + e.message);
        }
    } else {
        appendToChatLog("System Warning", "Emulator memory (HEAPU8 or FS) not available for writing.");
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
        messageElement.innerHTML = '<strong>' + speaker + ':</strong> ' + sanitizedText.replace(/\n/g, '<br>');
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
        console.log('JS: C64 prompt ready: ' + promptText + " (0x01) by C64 program!");
        appendToChatLog("System", "C64 program signaled prompt is ready (flag is 1).");

        const promptBytes = await readC64Memory(PROMPT_BUFFER_ADDRESS, PROMPT_MAX_LENGTH);
        const promptText = convertPETSCIIBytesToString(promptBytes);

        console.log("JS: Read prompt from C64 memory (0x" + PROMPT_BUFFER_ADDRESS.toString(16) + "): \"" + promptText + "\" (bytes: " + Array.from(promptBytes).map(b => b.toString(16)).join(',') + ")");

        if (promptText.trim().length > 0) {
            appendToChatLog("User (C64)", promptText);
        } else {
            // This case handles if the C64 program sets the flag but the buffer is empty or unreadable.
            // The previous "C64 signaled ready! (Test Poke Program)" was a specific placeholder for testpoke.prg.
            // Now we rely on actual buffer content. If it's empty, we log it.
            console.log("JS: Prompt text from C64 buffer is empty. Not sending to API.");
            appendToChatLog("System", "Detected ready flag from C64, but prompt buffer was empty or unreadable.");
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
                    appendToChatLog("System", "Response written to C64 memory (0x" + RESPONSE_BUFFER_ADDRESS.toString(16) + ") and response flag set (0x" + RESPONSE_READY_FLAG_ADDRESS.toString(16) + ").");
                })
                .catch(error => {
                    console.error('JS: Error in sendPromptToChatAPI: ' + error);
                    appendToChatLog("System Error", 'Failed to get response from chat API: ' + error);
                });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeEmulator();

    setInterval(checkC64Prompt, 3000);
    console.log("Started polling for C64 prompts using real memory functions (if emulator loaded).");
    console.log("The C64 program '" + c64ProgramName + "' should autostart, write 'HI' to 0x" + PROMPT_BUFFER_ADDRESS.toString(16) + ", and set flag 0x" + PROMPT_READY_FLAG_ADDRESS.toString(16) + " to 1.");
    appendToChatLog("System", "Chat client initialized. Vice.js emulator configured with " + c64ProgramName + ". Polling for C64 prompts.");
});

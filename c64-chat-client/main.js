// --- API Placeholders ---
const CHAT_API_KEY = 'YOUR_API_KEY_HERE'; // Placeholder
const CHAT_API_ENDPOINT = 'http://localhost:11434/v1/chat/completions'; // Placeholder

/* --- Chat API Connector -------------------------------------------- */
/**
 * sendPromptToChatAPI – talk to an OpenAI-compatible /v1/chat/completions route.
 * @param {string} userText    – the user’s prompt.
 * @param {Object} [opts]      – optional overrides.
 *        opts.model           – model name (default "gemma3:4b").
 *        opts.system          – system prompt text.
 *        opts.endpoint        – endpoint URL (default Ollama localhost).
 *        opts.apiKey          – bearer token if the server requires one.
 *        opts.stream          – true ⇒ stream tokens incrementally.
 * @returns {Promise<string>}  – assistant reply (full text if !stream).
 */
async function sendPromptToChatAPI(userText, opts = {}) {
    const {
      model     = "gemma3:4b",
      system    = "You are a helpful C64 assistant. Respond in clear, concise text suitable for a C64 display. Avoid multi-line responses.",
      endpoint  = "http://localhost:11434/v1/chat/completions",   // Ollama’s OpenAI-style route  [oai_citation:0‡apidog.com](https://apidog.com/blog/how-to-use-ollama/?utm_source=chatgpt.com)
      apiKey    = null,
      stream    = false
    } = opts;
  
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: userText }
      ],
      stream
    };
  
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;   // OpenAI pattern  [oai_citation:1‡reqbin.com](https://reqbin.com/code/javascript/ricgaie0/javascript-fetch-bearer-token?utm_source=chatgpt.com)
  
    const resp = await fetch(endpoint, {                    // Fetch is built-in to browsers  [oai_citation:2‡developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch?utm_source=chatgpt.com)
      method : "POST",
      headers: headers,
      body   : JSON.stringify(body)
    });
  
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0,120)}`);
    }
  
    /* ────────────────────────────
       Non-stream mode: just return the
       assistant’s full reply string.
    ──────────────────────────── */
    if (!stream) {
      const json = await resp.json();     // Response shape mirrors OpenAI  [oai_citation:3‡ollama.com](https://ollama.com/blog/openai-compatibility?utm_source=chatgpt.com)
      return json.choices[0].message.content.trim();
    }
  
    /* ────────────────────────────
       Stream mode: parse Server-Sent
       Events line-by-line and yield tokens.
    ──────────────────────────── */
    const reader = resp.body
                   .pipeThrough(new TextDecoderStream())
                   .getReader();
  
    let buffer = "";
    let done   = false;
    const tokens = [];        // collect for callers that want the full text too
  
    while (!done) {
      const { value, done: d } = await reader.read();
      if (d) { done = true; continue; }
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();   // keep last (possibly incomplete) line
      for (const l of lines) {
        if (!l.startsWith("data:")) continue;
        const data = l.slice(5).trim();
        if (data === "[DONE]") { done = true; break; }
        const obj  = JSON.parse(data);
        const t    = obj.choices?.[0]?.delta?.content ?? "";
        if (t) { tokens.push(t); console.log(t); }          // live update
      }
    }
    return tokens.join("").trim();
  }

// --- Global function for C64 to call ---
async function send_chat(promptString) {
    if (!promptString || String(promptString).trim().length === 0) { // Ensure promptString is treated as a string
        console.warn("send_chat called with empty prompt.");
        return "Error: Empty prompt."; 
    }

    const currentPrompt = String(promptString); // Ensure it's a string
    console.log(`send_chat: Received prompt: "${currentPrompt}"`);
    
    try {
        const apiResponse = await sendPromptToChatAPI(currentPrompt); 
        
        if (apiResponse) {
            console.log("send_chat: OpenAI Response:", apiResponse);
            return apiResponse;
        } else {
            console.error("send_chat: Invalid API response structure:", apiResponse);
            return "Error: Invalid response from Chat API.";
        }
    } catch (error) {
        console.error("send_chat: Error calling Chat API:", error);
        return "Error: Could not get response from assistant.";
    }
}


document.addEventListener('DOMContentLoaded', () => {
    console.log("Chat Client main.js loaded. Call send_chat(prompt) to interact with the Chat API.");
    // No C64 initialization or chat loop started from here anymore.
});

# Gemma 4 STT & Response Example (Pixi-based)

This project demonstrates how to set up a local, private pipeline that records audio from your microphone, transcribes it using a local, optimized Whisper model, and feeds the transcription to a local **Gemma 4** model running on Ollama.

The environment and native dependencies (such as `portaudio` and `ffmpeg`) are managed completely and automatically by **Pixi**.

## Features
- **Zero system dependencies**: PortAudio (audio library) and FFmpeg (audio decoding) are installed inside the project environment by Pixi—no `brew install` required.
- **Fast Local Transcription**: Uses `faster-whisper` (CTranslate2 implementation of OpenAI's Whisper) running efficiently on CPU.
- **Streaming Response**: Streams responses directly from your local Ollama `gemma4:latest` model.
- **Configurable**: Easily switch Whisper model sizes (`tiny` up to `large-v3`) or Ollama models.

---

## What is Needed & Prerequisites

1. **Pixi Package Manager**:
   You already have `pixi` installed! If you ever need to set it up on another machine, run:
   ```bash
   curl -fsSL https://pixi.sh/install.sh | bash
   ```

2. **Ollama**:
   Ensure you have Ollama installed and running.
   - Run the Ollama app or start the daemon: `ollama serve`
   - Make sure you have the model pulled:
     ```bash
     ollama pull gemma4:latest
     ```
     *(You can check your local models with `ollama list`)*

3. **Microphone Access**:
   Make sure the terminal/editor you are running this from has permission to access your microphone (macOS System Settings -> Privacy & Security -> Microphone).

---

## How to Run

1. **Start the Application**:
   Run the following command in this directory:
   ```bash
   pixi run start
   ```
   *Note: On first run, Pixi will download and set up the Python environment, dependencies, and download the Whisper model. This may take a minute.*

2. **Interact**:
   - The program will wait for you to speak:
     ```
     🎙️  Recording started. Speak into your microphone...
     👉 Press [ENTER] to stop recording and send to transcription.
     ```
   - Speak your prompt/question, then press **[ENTER]**.
   - It will save the audio, run transcription, and stream the response from Gemma 4:
     ```
     ✅ Audio recording saved successfully (4.2 seconds).

     🌀 Loading Whisper 'base' model...
     ⚡ Transcribing audio...
     🗣️  Detected language: 'en' (confidence: 99.41%)

     💬 Sending transcription to Gemma 4 via Ollama (gemma4:latest)...
     👉 Transcription: "what is the capital of France?"
     --------------------------------------------------
     The capital of France is Paris.
     --------------------------------------------------
     ```

---

## Customization & Arguments

You can pass arguments to the script via `pixi run start`. To do this, add `--` before the arguments so Pixi passes them to the python script:

### Change Whisper Model size
By default, the script uses the `base` Whisper model which balances speed and accuracy well on CPU. You can change this (e.g., to `tiny` for maximum speed, or `medium` for higher accuracy):
```bash
pixi run start -- -w tiny
```

### Change the Ollama Model
If you want to use a different model that you have installed in Ollama (e.g. `mistral-nemo:12b` or `qwen3:14b`):
```bash
pixi run start -- -m mistral-nemo:12b
```

### All CLI Options
```text
options:
  -h, --help            show this help message and exit
  --whisper-model, -w {tiny,base,small,medium,large-v3}
                        Whisper model size to use for transcription (default: base)
  --ollama-model, -m OLLAMA_MODEL
                        Ollama model name to send query to (default: gemma4:latest)
  --sample-rate, -r SAMPLE_RATE
                        Microphone sampling rate in Hz (default: 16000)
  --output-wav, -o OUTPUT_WAV
                        Path where the recorded WAV file will be temporarily saved
```

---

## Testing Gemma 4 Native Speech-to-Text

Gemma 4 models (like `gemma4:latest`) feature native audio understanding, meaning you can send the raw audio bytes directly to the model without transcribing them first.

We have added a testing utility to run this:

### 1. Test via Microphone (Fixed-duration by default)
By default, the testing script will record from your microphone for **5 seconds** with a visual countdown, and then automatically send it to Gemma 4:
```bash
pixi run test-audio
```

* **Interactive Mode**: If you prefer to press Enter to stop the recording instead of using a timer, set the duration to `0`:
  ```bash
  pixi run test-audio -- -d 0
  ```

* **Custom Duration**: Set a custom recording length in seconds:
  ```bash
  pixi run test-audio -- -d 10
  ```

### 2. Test with a Pre-recorded File
You can also run the test script directly against any pre-recorded WAV file (must be 16kHz, mono):
```bash
pixi run test-audio -- -f path/to/your/audio.wav
```

### 3. Customize Prompt or Model
You can customize the prompt sent along with the audio (e.g. asking for translation or explanation) or change the Ollama model:
```bash
pixi run test-audio -- -p "Translate this audio to Spanish" -m gemma4:latest
```

---

## Interactive vs. Fixed-Duration in `pixi run start`

The main application pipeline (`pixi run start`) also supports these recording behaviors:
* **Interactive (Default)**: Press `[ENTER]` to stop recording:
  ```bash
  pixi run start
  ```
* **Fixed-duration**: Record for exactly `N` seconds (e.g. 5 seconds) and stop automatically:
  ```bash
  pixi run start -- -d 5
  ```

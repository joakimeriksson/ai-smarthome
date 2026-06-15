import argparse
import os
import sys
import queue
import time
import numpy as np
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel
import ollama

def record_audio(filename, duration=0, sample_rate=16000):
    """
    Records audio from the microphone.
    If duration > 0, records for a fixed duration with a countdown.
    If duration == 0, records until the user presses Enter (interactive).
    """
    if duration > 0:
        print(f"\n🎙️  Recording started. Speak into your microphone for {duration} seconds...")
        try:
            # Record audio for the specified duration
            audio_data = sd.rec(int(duration * sample_rate), samplerate=sample_rate, channels=1, dtype='float32')
            
            # Show a countdown
            for remaining in range(duration, 0, -1):
                print(f"⏱️  {remaining} seconds remaining...", end="\r", flush=True)
                time.sleep(1)
            
            sd.wait()  # Wait until the recording is finished
            print("                                      ", end="\r")  # Clear line
            print("✅ Recording finished.")
            sf.write(filename, audio_data, sample_rate)
            print(f"✅ Audio recording saved successfully ({duration:.1f} seconds).")
            return True
        except Exception as e:
            print(f"\n❌ Error accessing microphone: {e}")
            print("Please check that your terminal has microphone permissions enabled.")
            return False
    else:
        print("\n🎙️  Recording started. Speak into your microphone...")
        print("👉 Press [ENTER] to stop recording and send to transcription.")
        
        q = queue.Queue()
        
        def callback(indata, frames, time_cb, status):
            if status:
                print(f"Status warning: {status}", file=sys.stderr)
            q.put(indata.copy())
            
        try:
            stream = sd.InputStream(samplerate=sample_rate, channels=1, callback=callback)
            with stream:
                # Use standard input() instead of sys.stdin.readline() for terminal compatibility
                input()
        except Exception as e:
            print(f"\n❌ Error accessing microphone: {e}")
            print("Please check that your terminal has microphone permissions enabled.")
            return False
            
        # Retrieve and concatenate all audio blocks
        audio_data = []
        while not q.empty():
            audio_data.append(q.get())
            
        if audio_data:
            audio_data = np.concatenate(audio_data, axis=0)
            sf.write(filename, audio_data, sample_rate)
            print(f"✅ Audio recording saved successfully ({len(audio_data)/sample_rate:.1f} seconds).")
            return True
        else:
            print("❌ No audio data was captured.")
            return False

def transcribe_audio(audio_path, model_size="base"):
    """
    Transcribes a WAV file using the local faster-whisper model.
    """
    print(f"\n🌀 Loading Whisper '{model_size}' model...")
    # float32 is safe for macOS CPU computation
    model = WhisperModel(model_size, device="cpu", compute_type="float32")
    
    print("⚡ Transcribing audio...")
    segments, info = model.transcribe(audio_path, beam_size=5)
    
    print(f"🗣️  Detected language: '{info.language}' (confidence: {info.language_probability:.2%})")
    
    text = ""
    for segment in segments:
        text += segment.text + " "
        
    text = text.strip()
    return text

def get_ollama_response(prompt, model_name="gemma4:latest"):
    """
    Sends transcribed text to Ollama and streams the response.
    """
    print(f"\n💬 Sending transcription to Gemma 4 via Ollama ({model_name})...")
    print(f"👉 Transcription: \"{prompt}\"")
    print("-" * 50)
    
    try:
        response = ollama.chat(
            model=model_name,
            messages=[{'role': 'user', 'content': prompt}],
            stream=True
        )
        
        full_response = ""
        for chunk in response:
            content = chunk['message']['content']
            print(content, end="", flush=True)
            full_response += content
        print()
        print("-" * 50)
        return full_response
    except Exception as e:
        print(f"\n❌ Error calling Ollama: {e}")
        print("Please ensure:")
        print(f"  1. Ollama is running (`ollama serve` or open the Ollama app).")
        print(f"  2. You have pulled the model (`ollama pull {model_name}`).")
        return None

def main():
    parser = argparse.ArgumentParser(description="Gemma 4 Speech-to-Text and LLM response example using Pixi")
    parser.add_argument(
        "--whisper-model", "-w",
        default="base",
        choices=["tiny", "base", "small", "medium", "large-v3"],
        help="Whisper model size to use for transcription (default: base)"
    )
    parser.add_argument(
        "--ollama-model", "-m",
        default="gemma4:latest",
        help="Ollama model name to send query to (default: gemma4:latest)"
    )
    parser.add_argument(
        "--duration", "-d",
        type=int,
        default=0,
        help="Duration to record in seconds. Default is 0 (interactive, press Enter to stop)."
    )
    parser.add_argument(
        "--sample-rate", "-r",
        type=int,
        default=16000,
        help="Microphone sampling rate in Hz (default: 16000)"
    )
    parser.add_argument(
        "--output-wav", "-o",
        default="recorded_input.wav",
        help="Path where the recorded WAV file will be temporarily saved"
    )
    
    args = parser.parse_args()
    
    # 1. Record Audio
    if not record_audio(args.output_wav, args.duration, args.sample_rate):
        sys.exit(1)
        
    # 2. Transcribe Audio
    try:
        transcription = transcribe_audio(args.output_wav, args.whisper_model)
    except Exception as e:
        print(f"\n❌ Error during transcription: {e}")
        # Clean up audio file
        if os.path.exists(args.output_wav):
            os.remove(args.output_wav)
        sys.exit(1)
        
    # Clean up audio file
    if os.path.exists(args.output_wav):
        os.remove(args.output_wav)
        
    if not transcription:
        print("\n⚠️  No speech was detected or transcribed. Exiting.")
        sys.exit(0)
        
    # 3. Get LLM response
    get_ollama_response(transcription, args.ollama_model)

if __name__ == "__main__":
    main()

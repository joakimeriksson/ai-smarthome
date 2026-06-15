import argparse
import os
import sys
import queue
import time
import numpy as np
import sounddevice as sd
import soundfile as sf
import ollama

def record_audio(filename, duration=5, sample_rate=16000):
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
        print("👉 Press [ENTER] to stop recording and send to Ollama.")
        
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

def test_native_audio(audio_path, model_name="gemma4:latest", prompt="Transcribe the following audio exactly:", think=False, speaker=None):
    """
    Sends the audio file directly to Ollama using the native multimodal support (images field).
    """
    print(f"\n💬 Sending audio file to Ollama ({model_name}) using native audio support...")
    print(f"👉 File: {audio_path}")
    print(f"👉 Prompt: \"{prompt}\"")
    print(f"👉 Thinking Mode: {'Enabled' if think else 'Disabled'}")
    print("-" * 50)
    
    start_time = time.time()
    
    try:
        # Read the file bytes
        with open(audio_path, "rb") as f:
            audio_bytes = f.read()
            
        load_time = time.time() - start_time
        print(f"⚡ File loaded in {load_time:.3f} seconds. Calling Ollama API...")
        
        # Send to Ollama using chat endpoint with audio bytes inside the images field
        api_start = time.time()
        response = ollama.chat(
            model=model_name,
            messages=[
                {
                    'role': 'user',
                    'content': prompt,
                    'images': [audio_bytes]
                }
            ],
            think=think,
            stream=True
        )
        
        if speaker:
            speaker.start()

        full_response = ""
        first_token_time = None
        chunk_count = 0

        for chunk in response:
            if first_token_time is None:
                first_token_time = time.time() - api_start
                print(f"⏱️ Time to first token: {first_token_time:.3f} seconds\n")

            content = chunk['message']['content']
            print(content, end="", flush=True)
            full_response += content
            chunk_count += 1
            if speaker:
                speaker.feed(content)

        if speaker:
            speaker.finish()

        print()
        print("-" * 50)
        
        total_api_time = time.time() - api_start
        print(f"📊 Performance stats:")
        print(f"  - Load time: {load_time:.3f}s")
        print(f"  - Time to first token: {first_token_time:.3f}s" if first_token_time else "  - Time to first token: N/A")
        print(f"  - Total generation time: {total_api_time:.3f}s")
        if chunk_count > 0 and total_api_time > 0:
            print(f"  - Avg chunk generation speed: {chunk_count / total_api_time:.1f} chunks/sec")
            
        return full_response
    except Exception as e:
        print(f"\n❌ Error calling Ollama: {e}")
        print("Please ensure:")
        print("  1. Ollama is running (`ollama serve`).")
        print(f"  2. You have pulled the model (`ollama pull {model_name}`).")
        print("  3. The model architecture supports audio input (e.g. gemma4:latest).")
        return None

def main():
    parser = argparse.ArgumentParser(description="Test Gemma 4 Native Speech-to-Text via Ollama")
    parser.add_argument(
        "--file", "-f",
        default=None,
        help="Path to an existing 16kHz mono WAV file. If not provided, microphone recording will start."
    )
    parser.add_argument(
        "--duration", "-d",
        type=int,
        default=5,
        help="Duration to record in seconds. Set to 0 for interactive mode (press Enter to stop)."
    )
    parser.add_argument(
        "--ollama-model", "-m",
        default="gemma4:latest",
        help="Ollama model name to send query to (default: gemma4:latest)"
    )
    parser.add_argument(
        "--prompt", "-p",
        default="Transcribe the following audio exactly. Output only the transcription, nothing else.",
        help="Prompt to send along with the audio file"
    )
    parser.add_argument(
        "--think",
        action="store_true",
        help="Enable reasoning/thinking mode (default: disabled to improve latency)"
    )
    parser.add_argument(
        "--speak", "-s",
        action="store_true",
        help="Speak Gemma's response aloud via streaming Piper TTS as it is generated."
    )
    parser.add_argument(
        "--voice",
        default="voices/sv_SE-nst-medium.onnx",
        help="Path to the Piper .onnx voice model used when --speak is set."
    )
    parser.add_argument(
        "--sample-rate", "-r",
        type=int,
        default=16000,
        help="Microphone sampling rate in Hz (default: 16000)"
    )
    parser.add_argument(
        "--output-wav", "-o",
        default="test_audio_input.wav",
        help="Path where the recorded WAV file will be temporarily saved"
    )
    
    args = parser.parse_args()
    
    audio_file = args.file
    
    # If no file is provided, record from the microphone
    if not audio_file:
        audio_file = args.output_wav
        if not record_audio(audio_file, args.duration, args.sample_rate):
            sys.exit(1)
            
    # Optionally build a streaming Piper speaker to voice the response.
    speaker = None
    if args.speak:
        from streaming_tts import StreamingSpeaker
        print(f"🔊 Streaming speech enabled (voice: {args.voice})")
        speaker = StreamingSpeaker(args.voice)

    # Send audio natively to Ollama
    test_native_audio(audio_file, args.ollama_model, args.prompt, args.think, speaker)
    
    # Clean up the recorded WAV file if we generated a temporary one
    if not args.file and os.path.exists(args.output_wav):
        try:
            os.remove(args.output_wav)
            print(f"🧹 Cleaned up temporary file: {args.output_wav}")
        except Exception as e:
            print(f"⚠️ Warning: Could not remove temporary file: {e}")

if __name__ == "__main__":
    main()

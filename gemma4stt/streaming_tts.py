"""Streaming Piper TTS — speak text live, sentence-by-sentence, as it arrives.

Designed to be fed an incremental text stream (e.g. tokens from an LLM). As soon
as a full sentence has been accumulated it is synthesized with Piper and its audio
chunks are pushed to the speaker, so playback starts before the text is complete.

Two threads sit behind a pair of queues:

    feed(text) --> [text buffer] --split sentences--> synth thread --> [audio queue] --> playback thread --> speaker

Usage:
    speaker = StreamingSpeaker("voices/sv_SE-nst-medium.onnx")
    speaker.start()
    for token in llm_stream:
        speaker.feed(token)
    speaker.finish()   # flush remaining text, wait for playback, stop
"""
from __future__ import annotations

import queue
import re
import threading

import numpy as np
import sounddevice as sd
from piper import PiperVoice

# Sentence-ending punctuation we flush on. We keep the delimiter with the sentence.
_SENTENCE_END = re.compile(r"[^.!?…\n]*[.!?…\n]+", re.UNICODE)
# A short minimum so we don't synthesize tiny fragments like "Hej." too eagerly
# when more is clearly still streaming in.
_MIN_FLUSH_CHARS = 2


class StreamingSpeaker:
    def __init__(self, model_path: str):
        self.voice = PiperVoice.load(model_path)
        self.sample_rate = self.voice.config.sample_rate

        self._text_q: "queue.Queue[str | None]" = queue.Queue()
        self._audio_q: "queue.Queue[np.ndarray | None]" = queue.Queue(maxsize=64)
        self._buffer = ""
        self._synth_thread: threading.Thread | None = None
        self._play_thread: threading.Thread | None = None
        self.first_audio_event = threading.Event()

    # --- public API -------------------------------------------------------
    def start(self):
        self._synth_thread = threading.Thread(target=self._synth_loop, daemon=True)
        self._play_thread = threading.Thread(target=self._play_loop, daemon=True)
        self._synth_thread.start()
        self._play_thread.start()

    def feed(self, text: str):
        """Add a chunk of text. Whole sentences are dispatched to synthesis immediately."""
        self._buffer += text
        while True:
            match = _SENTENCE_END.match(self._buffer)
            if not match:
                break
            sentence = match.group(0).strip()
            self._buffer = self._buffer[match.end():]
            if len(sentence) >= _MIN_FLUSH_CHARS:
                self._text_q.put(sentence)

    def finish(self):
        """Flush any trailing partial sentence, then block until playback drains."""
        tail = self._buffer.strip()
        self._buffer = ""
        if tail:
            self._text_q.put(tail)
        self._text_q.put(None)          # signal end-of-text to synth loop
        if self._synth_thread:
            self._synth_thread.join()
        if self._play_thread:
            self._play_thread.join()

    # --- worker threads ---------------------------------------------------
    def _synth_loop(self):
        while True:
            sentence = self._text_q.get()
            if sentence is None:
                break
            for chunk in self.voice.synthesize(sentence):
                audio = np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16)
                self._audio_q.put(audio)
        self._audio_q.put(None)         # signal end-of-audio to playback loop

    def _play_loop(self):
        with sd.OutputStream(samplerate=self.sample_rate, channels=1, dtype="int16") as stream:
            while True:
                audio = self._audio_q.get()
                if audio is None:
                    break
                if not self.first_audio_event.is_set():
                    self.first_audio_event.set()
                stream.write(audio)

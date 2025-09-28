// Preload and initialize the audio engine at page load
// This helps ensure the AudioWorklet module is loaded before first playback,
// reducing timing hiccups and avoiding first-click latency.

import { initSynth } from './synth.js';

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    try {
      initSynth();
    } catch (e) {
      // Non-fatal: main flow can still initialize on first user interaction
      console.warn('Audio pre-initialization failed (will retry on user action):', e);
    }
  });
}


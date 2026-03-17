// Shared keyboard module for all synths
// Handles: on-screen piano, computer keyboard, MIDI input
//
// Usage:
//   const kb = new SynthKeyboard('piano-keyboard', {
//     noteOn(note, velocity) { ... },
//     noteOff(note) { ... },
//     pitchBend(value) { ... },        // optional, -1 to +1
//     sustainChange(on) { ... },       // optional
//     modWheel(value) { ... },         // optional, 0-1
//   });

class SynthKeyboard {
  constructor(containerId, callbacks) {
    this.callbacks = callbacks;
    this.octaveShift = 0;
    this.activeKeys = new Set(); // computer keyboard keys currently held
    this.isMouseDown = false;

    // Computer keyboard → note offset mapping (C3 base = MIDI 48)
    this.keyMap = {
      // Lower row: C3-B3
      'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5,
      'g': 6, 'b': 7, 'h': 8, 'n': 9, 'j': 10, 'm': 11,
      // Upper row: C4-C5
      'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17,
      '5': 18, 't': 19, '6': 20, 'y': 21, '7': 22, 'u': 23,
      'i': 24
    };

    this._buildPiano(containerId);
    this._bindComputerKeyboard();
    this._initMIDI();
  }

  // ─── On-Screen Piano ────────────────────────────────────────────────────

  _buildPiano(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    this._pianoContainer = container;

    const startNote = 48; // C3
    const numOctaves = 4;
    const whiteNotes = [0, 2, 4, 5, 7, 9, 11];
    const blackNotes = [1, 3, -1, 6, 8, 10, -1];

    for (let oct = 0; oct < numOctaves; oct++) {
      const octBase = startNote + oct * 12;

      // White keys
      for (let i = 0; i < 7; i++) {
        const note = octBase + whiteNotes[i];
        const key = document.createElement('div');
        key.className = 'white-key';
        key.dataset.note = note;
        if (i === 0) {
          const label = document.createElement('span');
          label.className = 'key-label';
          label.textContent = `C${3 + oct}`;
          key.appendChild(label);
        }
        container.appendChild(key);
        this._bindPianoKey(key, note);
      }

      // Black keys
      for (let i = 0; i < 7; i++) {
        if (blackNotes[i] === -1) continue;
        const note = octBase + blackNotes[i];
        const key = document.createElement('div');
        key.className = 'black-key';
        key.dataset.note = note;
        const whiteStride = 39;
        const blackW = 24;
        key.style.left = (oct * 7 * whiteStride + (i + 1) * whiteStride - blackW / 2) + 'px';
        container.appendChild(key);
        this._bindPianoKey(key, note);
      }
    }

    // Global mouse-up: release all held piano keys
    document.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      container.querySelectorAll('.white-key.active, .black-key.active').forEach(k => {
        const n = parseInt(k.dataset.note);
        this.callbacks.noteOff(n);
        k.classList.remove('active');
      });
    });
  }

  _bindPianoKey(key, note) {
    key.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isMouseDown = true;
      this.callbacks.noteOn(note, 100);
      key.classList.add('active');
    });
    key.addEventListener('mouseenter', () => {
      if (this.isMouseDown) {
        this.callbacks.noteOn(note, 80);
        key.classList.add('active');
      }
    });
    key.addEventListener('mouseleave', () => {
      if (this.isMouseDown) {
        this.callbacks.noteOff(note);
        key.classList.remove('active');
      }
    });
    key.addEventListener('mouseup', () => {
      this.callbacks.noteOff(note);
      key.classList.remove('active');
      this.isMouseDown = false;
    });
    // Touch support
    key.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.callbacks.noteOn(note, 100);
      key.classList.add('active');
    }, { passive: false });
    key.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.callbacks.noteOff(note);
      key.classList.remove('active');
    }, { passive: false });
  }

  highlightKey(note, on) {
    if (!this._pianoContainer) return;
    const key = this._pianoContainer.querySelector(`[data-note="${note}"]`);
    if (key) key.classList.toggle('active', on);
  }

  // ─── Computer Keyboard ──────────────────────────────────────────────────

  _bindComputerKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === '[') {
        this.octaveShift = Math.max(-3, this.octaveShift - 1);
        this._updateOctaveDisplay();
        return;
      }
      if (e.key === ']') {
        this.octaveShift = Math.min(3, this.octaveShift + 1);
        this._updateOctaveDisplay();
        return;
      }

      const k = e.key.toLowerCase();
      if (k in this.keyMap && !this.activeKeys.has(k)) {
        this.activeKeys.add(k);
        const note = 48 + this.octaveShift * 12 + this.keyMap[k];
        this.callbacks.noteOn(note, 100);
      }
    });

    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keyMap && this.activeKeys.has(k)) {
        this.activeKeys.delete(k);
        const note = 48 + this.octaveShift * 12 + this.keyMap[k];
        this.callbacks.noteOff(note);
      }
    });
  }

  _updateOctaveDisplay() {
    const el = document.getElementById('octave-display');
    if (el) el.textContent = `Oct: ${this.octaveShift >= 0 ? '+' : ''}${this.octaveShift}`;
  }

  // ─── MIDI ───────────────────────────────────────────────────────────────

  _initMIDI() {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then(midi => {
      const midiStatus = document.getElementById('midi-status');

      const onMessage = (e) => {
        const [status, d1, d2] = e.data;
        const cmd = status & 0xF0;

        if (cmd === 0x90 && d2 > 0) {
          this.callbacks.noteOn(d1, d2);
        } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
          this.callbacks.noteOff(d1);
        } else if (cmd === 0xB0) {
          const val = d2 / 127;
          switch (d1) {
            case 1: // Mod wheel
              if (this.callbacks.modWheel) this.callbacks.modWheel(val);
              break;
            case 64: // Sustain
              if (this.callbacks.sustainChange) this.callbacks.sustainChange(d2 >= 64);
              break;
            case 71: // Resonance CC
              if (this.callbacks.cc) this.callbacks.cc(71, val);
              break;
            case 74: // Cutoff CC
              if (this.callbacks.cc) this.callbacks.cc(74, val);
              break;
          }
        } else if (cmd === 0xE0) {
          const bend = ((d2 << 7) | d1) / 8192 - 1;
          if (this.callbacks.pitchBend) this.callbacks.pitchBend(bend);
        }
      };

      const updateStatus = () => {
        if (!midiStatus) return;
        const count = [...midi.inputs.values()].length;
        midiStatus.textContent = count > 0 ? `MIDI: ${count} device(s)` : 'MIDI: --';
      };

      for (const input of midi.inputs.values()) input.onmidimessage = onMessage;
      midi.onstatechange = () => {
        for (const input of midi.inputs.values()) input.onmidimessage = onMessage;
        updateStatus();
      };
      updateStatus();
    }).catch(() => {});
  }
}

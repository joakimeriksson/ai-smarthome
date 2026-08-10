// Capture reference audio from an external synth (e.g. Cherry Audio Elka-X).
//
// How it works:
//   1. Sends MIDI notes via IAC Driver to the target synth
//   2. Records audio from a specified input device using ffmpeg
//   3. Saves WAV files to tools/compare/refs/<scenario-id>.wav
//
// Prerequisites:
//   - IAC Driver enabled in Audio MIDI Setup (already done)
//   - A virtual audio loopback (BlackHole 2ch) OR set the target synth's
//     audio output to an aggregate device that includes BlackHole
//   - OR: route via a hardware loopback cable (headphone out → line in)
//   - OR: on macOS 14+, use "screen capture" audio (device index may vary)
//
// Usage:
//   node --experimental-transform-types tools/compare/capture.ts [options]
//
// Options:
//   --scenario <id>      Run one scenario (default: all with note events)
//   --list               List available scenarios and exit
//   --midi-port <n>      IAC Driver port index (default: 0)
//   --audio-device <n>   ffmpeg avfoundation audio device index (default: auto-detect BlackHole)
//   --list-devices       List audio devices and MIDI ports, then exit
//   --lead-in <s>        Seconds of silence before first note (default: 1.0)
//   --tail <s>           Extra seconds after last note-off for reverb tail (default: 1.5)
//   --dry-run            Send MIDI but don't record (test MIDI routing)

import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS, type Scenario } from './scenarios.ts'

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// Native addon needs CJS require
const midi = require('@julusian/midi')

const HERE = dirname(fileURLToPath(import.meta.url))
const REFS = resolve(HERE, 'refs')
mkdirSync(REFS, { recursive: true })

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(name)
const opt = (name: string, def: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : def
}

if (flag('--list')) {
  console.log('Available scenarios with note events:')
  for (const sc of SCENARIOS) {
    if (sc.events.length === 0) continue
    console.log(`  ${sc.id.padEnd(24)} ${sc.title}  (${sc.durationSec}s)`)
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// MIDI setup
// ---------------------------------------------------------------------------

function listMidiPorts(): { name: string; index: number }[] {
  const output = new midi.Output()
  const ports: { name: string; index: number }[] = []
  for (let i = 0; i < output.getPortCount(); i++) {
    ports.push({ index: i, name: output.getPortName(i) })
  }
  output.closePort()
  return ports
}

// ---------------------------------------------------------------------------
// Audio device detection
// ---------------------------------------------------------------------------

function listAudioDevices(): string[] {
  try {
    const raw = execSync(
      'ffmpeg -f avfoundation -list_devices true -i "" 2>&1',
      { encoding: 'utf8' },
    )
    const lines = raw.split('\n')
    const audioDevices: string[] = []
    let inAudio = false
    for (const line of lines) {
      if (line.includes('AVFoundation audio devices')) { inAudio = true; continue }
      if (line.includes('AVFoundation video devices')) { inAudio = false; continue }
      if (inAudio) {
        const m = line.match(/\[(\d+)\]\s+(.+)/)
        if (m) audioDevices.push(`${m[1]}: ${m[2]}`)
      }
    }
    return audioDevices
  } catch {
    return []
  }
}

function findBlackHoleIndex(): number | null {
  const devices = listAudioDevices()
  for (const d of devices) {
    if (d.toLowerCase().includes('blackhole')) {
      const m = d.match(/^(\d+):/)
      if (m) return parseInt(m[1]!, 10)
    }
  }
  return null
}

if (flag('--list-devices')) {
  console.log('\nMIDI output ports:')
  for (const p of listMidiPorts()) console.log(`  ${p.index}: ${p.name}`)
  console.log('\nAudio input devices (ffmpeg avfoundation):')
  for (const d of listAudioDevices()) console.log(`  ${d}`)
  const bh = findBlackHoleIndex()
  if (bh !== null) console.log(`\n→ BlackHole detected at index ${bh}`)
  else console.log('\n→ BlackHole not found. Install it: brew install --cask blackhole-2ch')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// MIDI note sender
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

interface MidiPort {
  sendMessage(msg: number[]): void
  closePort(): void
}

function openMidiOut(portIndex: number): MidiPort {
  const output = new midi.Output()
  if (portIndex >= output.getPortCount()) {
    console.error(`MIDI port ${portIndex} not found. Available:`)
    for (let i = 0; i < output.getPortCount(); i++) {
      console.error(`  ${i}: ${output.getPortName(i)}`)
    }
    process.exit(1)
  }
  output.openPort(portIndex)
  return output
}

async function sendScenarioMidi(
  port: MidiPort,
  events: Scenario['events'],
  leadIn: number,
  channel = 0,
): Promise<void> {
  // Sort by time
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const startTime = Date.now()

  for (const ev of sorted) {
    const targetMs = (ev.t + leadIn) * 1000
    const elapsed = Date.now() - startTime
    if (targetMs > elapsed) await sleep(targetMs - elapsed)

    if (ev.kind === 'on') {
      const vel = Math.round((ev.velocity ?? 1) * 127)
      port.sendMessage([0x90 | channel, ev.note, vel])
    } else {
      port.sendMessage([0x80 | channel, ev.note, 0])
    }
  }
}

// ---------------------------------------------------------------------------
// Audio recorder (ffmpeg)
// ---------------------------------------------------------------------------

function recordAudio(
  outPath: string,
  durationSec: number,
  deviceIndex: number,
  sampleRate = 48000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'avfoundation',
      '-i', `:${deviceIndex}`,
      '-t', durationSec.toFixed(1),
      '-ar', sampleRate.toString(),
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      outPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`))
    })
    proc.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const midiPortIndex = parseInt(opt('--midi-port', '0'), 10)
  const leadIn = parseFloat(opt('--lead-in', '1.0'))
  const tail = parseFloat(opt('--tail', '1.5'))
  const dryRun = flag('--dry-run')
  const scenarioFilter = opt('--scenario', '')

  // Determine audio device
  let audioDevice = -1
  if (!dryRun) {
    const deviceOpt = opt('--audio-device', '')
    if (deviceOpt) {
      audioDevice = parseInt(deviceOpt, 10)
    } else {
      const bh = findBlackHoleIndex()
      if (bh !== null) {
        audioDevice = bh
        console.log(`Using BlackHole at audio device index ${bh}`)
      } else {
        console.error(
          'No --audio-device specified and BlackHole not found.\n' +
          'Options:\n' +
          '  1. Install BlackHole: brew install --cask blackhole-2ch\n' +
          '  2. Specify a device: --audio-device <index>\n' +
          '  3. Use --dry-run to test MIDI only\n' +
          '\nRun with --list-devices to see available devices.',
        )
        process.exit(1)
      }
    }
  }

  const port = openMidiOut(midiPortIndex)
  const portName = listMidiPorts()[midiPortIndex]?.name ?? `port ${midiPortIndex}`
  console.log(`MIDI out: ${portName}`)

  const scenarios = scenarioFilter
    ? SCENARIOS.filter(s => s.id === scenarioFilter)
    : SCENARIOS.filter(s => s.events.length > 0)

  if (scenarios.length === 0) {
    console.error(scenarioFilter ? `Scenario "${scenarioFilter}" not found.` : 'No scenarios.')
    process.exit(1)
  }

  // Send all-notes-off before starting
  for (let n = 0; n < 128; n++) port.sendMessage([0x80, n, 0])
  await sleep(200)

  for (const sc of scenarios) {
    const totalDuration = leadIn + sc.durationSec + tail
    const outPath = resolve(REFS, `${sc.id}.wav`)
    console.log(`\n─── ${sc.id} (${totalDuration.toFixed(1)}s) ───`)
    console.log(`  ${sc.title}`)

    if (!dryRun) {
      // Start recording and MIDI in parallel
      console.log(`  Recording from device ${audioDevice}...`)
      const recordPromise = recordAudio(outPath, totalDuration, audioDevice)

      // Small delay to let ffmpeg initialize
      await sleep(300)

      console.log(`  Sending MIDI...`)
      await sendScenarioMidi(port, sc.events, leadIn)

      // Wait for tail + recording to finish
      await recordPromise
      console.log(`  Saved: refs/${sc.id}.wav`)
    } else {
      console.log(`  Sending MIDI (dry run)...`)
      await sendScenarioMidi(port, sc.events, leadIn)
      await sleep(tail * 1000)
      console.log(`  Done (no audio recorded)`)
    }

    // All notes off between scenarios
    for (let n = 0; n < 128; n++) port.sendMessage([0x80, n, 0])
    await sleep(500)
  }

  port.closePort()
  console.log('\nCapture complete. Run `npm run compare` to generate comparison report.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

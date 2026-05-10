// I/O helpers for the comparison harness — pure Node, no deps.

import { writeFileSync, existsSync, readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// 16-bit PCM mono WAV writer
// ---------------------------------------------------------------------------

export function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const numSamples = samples.length
  const bytesPerSample = 2
  const dataSize = numSamples * bytesPerSample
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)              // PCM chunk size
  buf.writeUInt16LE(1, 20)                // PCM format
  buf.writeUInt16LE(1, 22)                // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buf.writeUInt16LE(bytesPerSample, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    let v = samples[i]!
    if (v > 1) v = 1
    if (v < -1) v = -1
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// Mono 16-bit PCM WAV reader. Returns null if the file doesn't exist.
// Resamples via naive linear interpolation if the source rate differs.
export function readWav(path: string, targetSampleRate: number): Float32Array | null {
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
  // Walk chunks to find fmt and data
  let offset = 12
  let sr = 0, channels = 1, bitsPerSample = 16
  let data: Buffer | null = null
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10)
      sr = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      data = buf.subarray(offset + 8, offset + 8 + size)
    }
    offset += 8 + size + (size & 1)
  }
  if (!data || sr === 0) return null

  // Decode → mono Float32 in source SR
  const bps = bitsPerSample / 8
  const frameCount = Math.floor(data.length / (bps * channels))
  const mono = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const off = i * bps * channels + c * bps
      let v = 0
      if (bitsPerSample === 16) v = data.readInt16LE(off) / 32768
      else if (bitsPerSample === 24) {
        const b0 = data[off]!, b1 = data[off+1]!, b2 = data[off+2]!
        let s = (b2 << 16) | (b1 << 8) | b0
        if (s & 0x800000) s |= ~0xffffff
        v = s / 8388608
      } else if (bitsPerSample === 32) v = data.readFloatLE(off)
      sum += v
    }
    mono[i] = sum / channels
  }

  if (sr === targetSampleRate) return mono
  // Linear-interp resample
  const ratio = sr / targetSampleRate
  const outLen = Math.floor(mono.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio
    const i0 = Math.floor(x), i1 = Math.min(i0 + 1, mono.length - 1)
    const f = x - i0
    out[i] = mono[i0]! * (1 - f) + mono[i1]! * f
  }
  return out
}

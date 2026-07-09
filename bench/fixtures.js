// Shared bench fixtures — a deterministic N-minute 44.1k stereo signal with real
// spectral content (mixed tones + shaped noise + an amplitude-modulated beat pulse),
// so analysis ops (LUFS, FFT, MFCC, beat) have something to measure, not silence.
// Written once as WAV (+ MP3 via ffmpeg) into a cache dir; reused across runners.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const SR = 44100

/** Deterministic stereo signal, `dur` seconds. Left = 220/440/880 tone stack +
 *  pink-ish noise; right = detuned + 120bpm kick pulse for beat tracking. */
export function signal(dur, sr = SR) {
  let n = Math.round(dur * sr)
  let L = new Float32Array(n), R = new Float32Array(n)
  let seed = 0x9e3779b9 >>> 0
  let rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1 }
  let lp = 0, beatHz = 2 // 120 bpm
  for (let i = 0; i < n; i++) {
    let t = i / sr
    let tone = 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 880 * t)
    lp = lp * 0.96 + rand() * 0.04 // shaped (low-passed) noise ≈ pink-ish
    let noise = lp * 0.5
    let phase = (t * beatHz) % 1
    let kick = Math.exp(-phase * 40) * Math.sin(2 * Math.PI * 60 * t) * 0.6 // decaying 60Hz pulse
    L[i] = tone + noise
    R[i] = 0.25 * Math.sin(2 * Math.PI * 221 * t) + 0.18 * Math.sin(2 * Math.PI * 442 * t) + noise + kick
  }
  return [L, R]
}

/** Ensure {dir}/bench-{dur}s.wav and .mp3 exist. Returns their paths. */
export async function ensureFixtures(dir, dur) {
  mkdirSync(dir, { recursive: true })
  let wav = join(dir, `bench-${dur}s.wav`), mp3 = join(dir, `bench-${dur}s.mp3`)
  if (!existsSync(wav)) {
    let { default: audio } = await import('../audio.js')
    let a = audio.from(signal(dur), { sampleRate: SR })
    await a.save(wav)
  }
  if (!existsSync(mp3)) execFileSync('ffmpeg', ['-y', '-i', wav, '-b:a', '192k', mp3], { stdio: 'ignore' })
  return { wav, mp3 }
}

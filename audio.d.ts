/**
 * audio — indexed, paged audio document with immutable source and declarative ops.
 */

export const PAGE_SIZE: number
export const BLOCK_SIZE: number

/** Audio instance — the paged audio document */
export interface AudioInstance {
  /** Decoded PCM pages */
  pages: Array<{ data: Float32Array[] | null }>
  /** Always-resident index: per-channel, per-block min/max/energy */
  index: AudioIndex
  /** Sample rate in Hz */
  sampleRate: number
  /** Source channel count (before edits) */
  numberOfChannels: number
  /** Effective channel count (reflects remix edits) */
  readonly channels: number
  /** @internal Source sample count (before edits) */
  _len: number
  /** Effective sample count (reflects structural edits) */
  readonly length: number
  /** Effective duration in seconds (reflects structural edits) */
  readonly duration: number
  /** Original source reference (URL/path string, or null for PCM-backed) */
  source: string | null
  /** Storage mode: 'memory' | 'persistent' | 'auto' */
  storage: string
  /** Edit list (inspectable) */
  edits: EditOp[]
  /** Monotonic counter, increments on edit/undo */
  version: number
  /** Callback fired on edit/undo */
  onchange: (() => void) | null

  // ── Structural ops ───────────────────────────────────────────
  /** Trim to sub-range in place */
  crop(offset?: number, duration?: number): this
  /** Insert other audio at position (seconds) */
  insert(other: AudioInstance, offset?: number): this
  /** Delete range */
  remove(offset: number, duration: number): this
  /** Repeat N times */
  repeat(times: number): this

  // ── Sample ops ───────────────────────────────────────────────
  /** Adjust volume in dB, optionally within range */
  gain(db: number, offset?: number, duration?: number): this
  /** Fade in (positive duration, from start) or out (negative duration, from end). curve: 'linear'|'exp'|'log'|'cos' */
  fade(duration: number, curve?: 'linear' | 'exp' | 'log' | 'cos'): this
  /** Reverse sample order, optionally within range */
  reverse(offset?: number, duration?: number): this
  /** Overlay other audio */
  mix(other: AudioInstance, offset?: number, duration?: number): this
  /** Overwrite region with data */
  write(data: Float32Array[] | Float32Array, offset?: number): this

  /** Remix channels: mono→stereo, stereo→mono, etc. */
  remix(channels: number): this

  // ── Smart ops ────────────────────────────────────────────────
  /** Remove silence from edges (auto-detects floor from energy if threshold undefined) */
  trim(threshold?: number): this
  /** Normalize to target level (default 0 dBFS). Mode: 'peak' (default) or 'lufs'. Preset shorthand: 'streaming' (-14 LUFS), 'podcast' (-16 LUFS), 'broadcast' (-23 LUFS). */
  normalize(preset: 'streaming' | 'podcast' | 'broadcast'): this
  normalize(targetDb?: number, opts?: 'lufs' | { mode?: 'peak' | 'lufs' }): this

  // ── Output ───────────────────────────────────────────────────
  /** Read audio data. Format determines return type: PCM (default), codec ('wav','mp3',...) → Uint8Array, or typed ('int16','uint8'). Meta passed to encoder. */
  read(offset?: number, duration?: number, opts?: { format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Int16Array[] | Uint8Array[] | Uint8Array>
  read(opts?: { format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Uint8Array>
  /** Save to file path (Node) or FileSystemFileHandle (browser). Format inferred from extension or opts.format. */
  save(target: string | FileSystemWritableFileStream, opts?: { format?: string, meta?: Record<string, any> }): Promise<void>

  // ── Analysis ─────────────────────────────────────────────────
  /** Aggregate statistics for a range. Instant from index when clean, materializes dirty blocks. */
  stat(offset?: number, duration?: number): Promise<AudioStat>
  /** Downsampled waveform peaks. Sub-range via offset/duration; per-channel via opts.channels. */
  peaks(count: number, offset?: number, duration?: number, opts?: { channel?: number, channels?: boolean }): Promise<{ min: Float32Array | Float32Array[], max: Float32Array | Float32Array[] }>

  // ── Playback ─────────────────────────────────────────────────
  /** Start playback. Returns controller. Parallel by default. */
  play(offset?: number, duration?: number): PlaybackController

  // ── Streaming ────────────────────────────────────────────────
  /** Async iterator over materialized blocks (Float32Array[] per page) */
  stream(offset?: number, duration?: number): AsyncGenerator<Float32Array[], void, unknown>

  // ── History ──────────────────────────────────────────────────
  /** Pop edit(s). n=1 (default) returns single edit or null; n>1 returns array. */
  undo(n?: number): EditOp | EditOp[] | null
  /** Re-apply a previously undone edit */
  apply(...edits: EditOp[]): this

  // ── Views ────────────────────────────────────────────────────
  /** Create a shared-page view, optionally scoped to a range. */
  view(offset?: number, duration?: number): AudioInstance
  /** Split at offsets, returning views. No copies. */
  split(...offsets: number[]): AudioInstance[]
  /** Serialize document to JSON */
  toJSON(): { source: string | null, edits: EditOp[], sampleRate: number, channels: number, duration: number }

  /** Playback hint — preloads nearby pages */
  cursor: number
}

export interface AudioStat {
  /** Minimum sample amplitude */
  min: number
  /** Maximum sample amplitude */
  max: number
  /** Root mean square (from K-weighted energy) */
  rms: number
  /** Peak amplitude in dBFS */
  peak: number
  /** Integrated loudness in LUFS (BS.1770, K-weighted) */
  loudness: number
}

export interface AudioIndex {
  blockSize: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
  [field: string]: number | Float32Array[]
}

export interface EditOp {
  type: string
  [key: string]: any
}

export interface PlaybackController {
  playing: boolean
  currentTime: number
  ontimeupdate: ((time: number) => void) | null
  onended: (() => void) | null
  pause(): void
  stop(): void
}

export interface AudioOpts {
  sampleRate?: number
  channels?: number
  storage?: 'memory' | 'persistent' | 'auto'
  /** 'worker' decodes in a Web Worker (browser), 'main' decodes on current thread (default) */
  decode?: 'worker' | 'main'
  onprogress?: (event: { delta: ProgressDelta, offset: number, total: number }) => void
}

export interface ProgressDelta {
  fromBlock: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
}

/** Serialized audio document (from toJSON) */
export interface AudioDocument {
  source: string | null
  edits: EditOp[]
  sampleRate: number
  channels: number
  duration: number
}

/** Async entry — decode from file/URL/bytes, wrap PCM/silence, or restore from JSON document */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | Float32Array[] | number | AudioDocument, opts?: AudioOpts): Promise<AudioInstance>

declare namespace audio {
  /** Sync entry — from PCM data, AudioBuffer, audio instance (structural copy), or silence */
  function from(source: Float32Array[] | AudioBuffer | AudioInstance | number, opts?: AudioOpts): AudioInstance
  /** Concatenate multiple sources into one audio instance */
  function concat(...sources: (AudioInstance | Float32Array[] | number)[]): AudioInstance
  /** Register custom op. Init function takes params, returns block processor. */
  function op(name: string, init: (...args: any[]) => (block: Float32Array[], ctx: { offset: number, sampleRate: number, blockSize: number, blockOffset?: number }) => Float32Array[] | false | null): void
  /** Register custom index field. Receives all channels per block. Return number (cross-channel) or number[] (per-channel). */
  function index(name: string, fn: (channels: Float32Array[]) => number | number[]): void
}

export default audio

/** Decode encoded buffer into pages + index. Shared engine for main thread and worker. */
export function decodeBuf(buf: ArrayBuffer | Uint8Array, onprogress?: (event: { delta: ProgressDelta, offset: number, total: number }) => void): Promise<{
  pages: Float32Array[][]
  index: AudioIndex
  sampleRate: number
  channels: number
  length: number
}>

/** OPFS-backed cache backend for large files (browser only) */
export function opfsCache(dirName?: string): Promise<{
  read(i: number): Promise<Float32Array[]>
  write(i: number, data: Float32Array[]): Promise<void>
  has(i: number): Promise<boolean>
  evict(i: number): Promise<void>
  clear(): Promise<void>
}>

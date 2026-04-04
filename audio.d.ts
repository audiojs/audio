/**
 * audio — paged audio instance with declarative ops.
 */

/** Core audio instance — properties and I/O. Ops, stats, and fns extend this via registration. */
export interface AudioInstance {
  /** Decoded PCM pages */
  pages: Float32Array[][]
  /** Per-channel, per-block stats (min/max/energy + registered fields) */
  stats: AudioStats
  /** Sample rate in Hz */
  sampleRate: number
  /** Effective channel count (reflects remix edits) */
  readonly channels: number
  /** Effective sample count (reflects structural edits) */
  readonly length: number
  /** Effective duration in seconds */
  readonly duration: number
  /** Original source reference (URL/path string, or null for PCM-backed) */
  source: string | null
  /** Storage mode */
  storage: string
  /** Whether source is fully decoded */
  decoded: boolean
  /** Edit list (inspectable) */
  edits: EditOp[]
  /** Monotonic counter, increments on edit/undo */
  version: number
  /** Callback fired on edit/undo */
  onchange: (() => void) | null
  /** Playback hint — preloads nearby pages */
  cursor: number

  // ── Core I/O ────────────────────────────────────────────────
  /** Read audio data. Format determines return type. */
  read(offset?: number, duration?: number, opts?: { format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Int16Array[] | Uint8Array[] | Uint8Array>
  read(opts?: { format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Uint8Array>
  /** Async iterator over materialized blocks */
  stream(offset?: number, duration?: number): AsyncGenerator<Float32Array[], void, unknown>
  /** Ensure stats are fresh, return stats + block range */
  query(offset?: number, duration?: number): Promise<{ stats: AudioStats, channels: number, sampleRate: number, from: number, to: number }>
  /** Serialize to JSON */
  toJSON(): { source: string | null, edits: EditOp[], sampleRate: number, channels: number, duration: number }

  // ── Structural ops (registered via audio.op) ────────────────
  crop(offset?: number, duration?: number): this
  insert(other: AudioInstance, offset?: number): this
  remove(offset: number, duration: number): this
  repeat(times: number): this

  // ── Sample ops ──────────────────────────────────────────────
  gain(db: number, offset?: number, duration?: number): this
  fade(duration: number, curve?: 'linear' | 'exp' | 'log' | 'cos'): this
  reverse(offset?: number, duration?: number): this
  mix(other: AudioInstance, offset?: number, duration?: number): this
  write(data: Float32Array[] | Float32Array, offset?: number): this
  remix(channels: number): this

  // ── Smart ops ───────────────────────────────────────────────
  trim(threshold?: number): this
  normalize(preset: 'streaming' | 'podcast' | 'broadcast'): this
  normalize(targetDb?: number, opts?: 'lufs' | { mode?: 'peak' | 'lufs' }): this

  // ── Stats (registered via audio.stat) ───────────────────────
  db(offset?: number, duration?: number): Promise<number>
  rms(offset?: number, duration?: number): Promise<number>
  loudness(offset?: number, duration?: number): Promise<number>
  peaks(count: number, offset?: number, duration?: number, opts?: { channel?: number, channels?: boolean }): Promise<{ min: Float32Array | Float32Array[], max: Float32Array | Float32Array[] }>

  // ── Fns (registered via audio.fn) ───────────────────────────
  view(offset?: number, duration?: number): AudioInstance
  split(...offsets: number[]): AudioInstance[]
  undo(n?: number): EditOp | EditOp[] | null
  apply(...edits: (EditOp | ((channels: Float32Array[], ctx: any) => Float32Array[] | false | null))[]): this
  play(offset?: number, duration?: number): PlaybackController
  save(target: string | FileSystemWritableFileStream, opts?: { format?: string, meta?: Record<string, any> }): Promise<void>
  concat(...sources: (AudioInstance | Float32Array[] | number)[]): AudioInstance
}

export interface AudioStats {
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
  decode?: 'worker' | 'main'
  onprogress?: (event: { delta: ProgressDelta, offset: number, total: number }) => void
}

export interface ProgressDelta {
  fromBlock: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
}

/** Serialized audio instance (from toJSON) */
export interface AudioDocument {
  source: string | null
  edits: EditOp[]
  sampleRate: number
  channels: number
  duration: number
}

/** Async entry — decode from file/URL/bytes, wrap PCM/silence, or restore from JSON */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | Float32Array[] | number | AudioDocument, opts?: AudioOpts): Promise<AudioInstance>

declare namespace audio {
  /** Samples per page */
  const PAGE_SIZE: number
  /** Samples per stat block */
  const BLOCK_SIZE: number
  /** OPFS-backed cache backend for large files (browser only) */
  function opfsCache(dirName?: string): Promise<{
    read(i: number): Promise<Float32Array[]>
    write(i: number, data: Float32Array[]): Promise<void>
    has(i: number): Promise<boolean>
    evict(i: number): Promise<void>
    clear(): Promise<void>
  }>
  /** Sync entry — from PCM data, AudioBuffer, audio instance (structural copy), or silence */
  function from(source: Float32Array[] | AudioBuffer | AudioInstance | number, opts?: AudioOpts): AudioInstance
  /** Concatenate multiple sources into one audio instance */
  function concat(...sources: (AudioInstance | Float32Array[] | number)[]): AudioInstance
  /** Register custom op */
  function op(name: string, init: (...args: any[]) => (block: Float32Array[], ctx: { offset: number, sampleRate: number, blockSize: number, blockOffset?: number }) => Float32Array[] | false | null): void
  /** Register custom stat */
  function stat(name: string, init: () => (channels: Float32Array[], ctx: { sampleRate: number }) => number | number[]): void
  function stat(name: string, fn: (channels: Float32Array[]) => number | number[]): void
  /** Register a plain method on audio proto */
  function fn(name: string, fn: Function): void
}

export default audio

/** Audio instance prototype — extensible */
export const fn: Record<string, any>

/** All registered ops */
export const op: Record<string, Function>

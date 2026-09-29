/** audio/worker — main-thread facade over an audio engine running in a Worker. */

/** Serializable automation: value sampled by linear interpolation over breakpoints. */
export interface Curve { t: number[] | Float32Array, v: number[] | Float32Array }

export interface WorkerFacade extends PromiseLike<WorkerFacade> {
  readonly sampleRate: number
  readonly channels: number
  readonly length: number
  readonly duration: number
  readonly version: number
  readonly decoded: boolean
  readonly edits: [string, Record<string, unknown>][]
  readonly ready: Promise<true>

  // transport: rendered in the worker straight into the page's AudioWorklet (Node: @audio/speaker), as the local API
  readonly playing: boolean
  readonly paused: boolean
  readonly ended: boolean
  readonly seeking: boolean
  /** What the speakers play now, in seconds (their latency compensated); held at pause where playback resumes */
  currentTime: number
  volume: number
  muted: boolean
  playbackRate: number
  /** Settable while playing: the span repeats, each seam a 10 ms equal-power crossfade */
  loop: boolean
  /** Resolves when playback sounds */
  readonly played: Promise<void> | null
  /** Same options as the local play(); `from` takes over another instance's or facade's playback where it is */
  play(opts?: { at?: number, duration?: number, loop?: boolean, volume?: number, rate?: number, paused?: boolean, from?: { currentTime: number } }): Promise<void>
  pause(): WorkerFacade
  resume(): WorkerFacade
  /** Live stats of what plays: measured in the worker, delivered on the page as heard */
  meter(what: string | string[] | Record<string, unknown>, cb?: (value: any) => void): { value: any, stop(): void }

  /** PCM read — Float32Array per channel, transferred (zero-copy). */
  read(opts?: { at?: number | string, duration?: number | string, channel?: number, format?: string }): Promise<Float32Array[] | Float32Array>
  stat(name: string | string[], opts?: Record<string, unknown>): Promise<unknown>
  encode(format?: string, opts?: Record<string, unknown>): Promise<Uint8Array>
  save(target: string, opts?: Record<string, unknown>): Promise<unknown>
  detect(opts?: Record<string, unknown>): Promise<{ bpm: number, confidence: number, beats: Float64Array, onsets: Float64Array }>
  toJSON(): Promise<{ source: string | null, edits: unknown[], sampleRate: number, channels: number, duration: number }>
  undo(n?: number): Promise<unknown>
  seek(t: number): Promise<unknown>
  stop(): Promise<unknown>
  push(data: Float32Array | Float32Array[] | ArrayBufferView, format?: string | Record<string, unknown>): Promise<unknown>

  /** Boundary deviation: sub-instances arrive async. */
  clip(opts?: { at?: number, duration?: number }): Promise<WorkerFacade>
  clone(): Promise<WorkerFacade>
  split(...at: (number | string)[]): Promise<WorkerFacade[]>

  /** Clipboard edits are chainable and execute inside the worker. */
  copy(opts?: { at?: number | string, duration?: number | string }): this
  copy(at: number | string, duration?: number | string): this
  cut(opts?: { at?: number | string, duration?: number | string }): this
  cut(at: number | string, duration?: number | string): this
  paste(opts?: { at?: number | string }): this
  paste(at: number | string): this

  /** Strict single edit — rejects on op error (chained ops are fire-and-forget). */
  run(edit: [string, Record<string, unknown>?]): Promise<void>
  /** Resolves after all previously posted ops settled. */
  flush(): Promise<void>

  stream(opts?: { at?: number | string, duration?: number | string }): AsyncGenerator<Float32Array[]>

  on(event: string, cb: (...args: unknown[]) => void): WorkerFacade
  off(event?: string, cb?: (...args: unknown[]) => void): WorkerFacade
  dispose(): Promise<unknown>

  /** Every op in the worker's registry (gain, crop, fade, filter, …) is a chainable method. */
  [op: string]: any
}

export interface WorkerOptions extends Record<string, unknown> {
  /** Bring your own worker: an entry importing 'audio/worker' (it self-hosts in worker scope) beside your codecs,
   *  plugins and code. The engine talks on a port of its own; the Worker's messages stay yours. */
  worker?: Worker | { postMessage(msg: unknown, transfer?: unknown[]): void }
}

/** Open a source in the engine worker — same shape as audio(source, opts). */
declare function audioWorker(source?: unknown, opts?: WorkerOptions): WorkerFacade

declare namespace audioWorker {
  /** A facade for an instance your worker's own code made: expose(a) there gives the id. */
  function adopt(id: number, opts: { worker: Worker | { postMessage(msg: unknown, transfer?: unknown[]): void } }): WorkerFacade
  /** The page's AudioContext, which playback uses (the same as audio.context); set your own before playing. */
  let context: AudioContext | null
}

export default audioWorker

/** In a worker importing 'audio/worker': register an instance the app made, for the page to adopt. Returns its id
 *  (the same id again for the same instance). */
export function expose(a: object): number

/** Terminate the shared default worker. */
export function close(): Promise<void>

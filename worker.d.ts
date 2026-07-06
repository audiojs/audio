/** audio/worker — main-thread facade over an audio engine running in a Worker. */

export interface WorkerFacade extends PromiseLike<WorkerFacade> {
  readonly sampleRate: number
  readonly channels: number
  readonly length: number
  readonly duration: number
  readonly version: number
  readonly decoded: boolean
  readonly edits: [string, Record<string, unknown>][]
  readonly ready: Promise<true>

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
  /** Bring your own worker (custom codecs/plugins entry importing 'audio/worker-host'). */
  worker?: Worker | { postMessage(msg: unknown, transfer?: unknown[]): void }
}

/** Open a source in the engine worker — same shape as audio(source, opts). */
export default function audioWorker(source?: unknown, opts?: WorkerOptions): WorkerFacade

/** Terminate the shared default worker. */
export function close(): Promise<void>

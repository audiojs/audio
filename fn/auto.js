/**
 * Auto: the take repaired and finished by what it carries, @audio/chain's analyze → plan → apply (the registry's `auto`,
 * its manifest '@audio/chain/audio': the parameters, the recipe), hosted here for the one stage the chain can't run.
 *
 * a.auto()                            → speech: repaired, −16 LUFS, true peak under −1 dBTP
 * a.auto('music', { intensity: 0.5 })
 *
 * Where @audio/neural-denoise is installed, a bed under speech goes to DeepFilterNet3 (deepfilter()'s model), not OM-LSA:
 * the plan names it (its `neural` option), the stages before it run, the model's whole removal of what they leave is
 * made (kept as deepfilter() keeps it: core.js memo) and mixed back by the package's mixback(), the noise 60 dB ×
 * intensity down, then the stages after it. On the tuning takes of bench/rx/assistant.mjs that carry a bed, repairs
 * alone: PESQ 1.99 → 2.74, DNSMOS OVRL 2.87 → 3.20 (chain.js NEURAL). Under 'speech' the voice is what is kept: a music
 * bed goes with the noise. Music and voice-music keep chain's own denoiser (the model takes a music bed under a voice for
 * noise), and so does a take the model passes as music in its larger part, its guard leaving it as it came (the plan
 * made again on that share, saying so): lena, a film's voice over its score, under white noise 10 dB down, all of it
 * (SI-SDR 10.0 dB, as in; OM-LSA 17.5). A model that won't load is an error, as deepfilter()'s; without the package,
 * OM-LSA. The take is rendered whole ahead of rendering (deepfilter()'s way: a live stream waits for its end), and its
 * recipe, chain's code() included, names the denoiser that ran.
 */
import audio, { arrived, emit } from '../core.js'
import { fingerprint } from './vocals.js'
import { removal, playback } from './deepfilter.js'

export const NEURAL = '@audio/neural-denoise'
const RENDERED = Symbol('auto.rendered'), neural = () => audio.import(NEURAL).catch(() => null)

/**
 * @audio/chain's recipe for the take as auto() plans it → { analysis, recipe, at, x, y }. Where @audio/neural-denoise
 * loads (`nn`, its exports) and the plan puts the neural stage at `at`, the take is run there by `run` (stages, channels)
 * → channels (the stages before it: their output x) and DeepFilterNet3's whole removal y of x is made (deepfilter()'s,
 * kept as it keeps it); where its guard passed most of x as music (y is x there, sample for sample) the plan is made
 * again with that share, and puts chain's own denoiser there. `chain`: its exports. `say(names)`: each part as it
 * starts, by the stages it runs ('analysis' first).
 */
export async function planned(chain, nn, channels, fs, opts, run, say = () => {}) {
  say(['analysis'])
  let analysis = chain.analyze(channels, { fs, type: opts.type }), recipe = chain.plan(analysis, { ...opts, neural: !!nn })
  let at = recipe.stages.findIndex(s => s.atom === NEURAL), x = null, y = null
  if (at < 0) return { analysis, recipe, at, x, y }
  if (at) say(names(recipe.stages.slice(0, at)))
  x = await run(recipe.stages.slice(0, at), channels)
  say(['denoise'])
  y = await removal(nn, x, fs).catch(e => { throw new Error(`auto: ${e.message}`) })
  let same = 0, n = 0
  for (let c = 0; c < x.length; c++) for (let i = 0; i < x[c].length; i++, n++) if (x[c][i] === y[c][i]) same++
  if (same > n / 2) recipe = chain.plan(analysis, { ...opts, neural: { music: same / n } })
  return { analysis, recipe, at, x, y }
}

/** The neural denoise stage on x, the model's whole removal y of it mixed back by the package's mixback() at the stage's
 *  limit and floor. */
export const denoise = (nn, x, y, { limit, floor }, sampleRate) => x.map((v, c) => nn.mixback(v, y[c], { limit, floor, sampleRate }))

// the stages' names, a step's each once (chain's denoise is one stage, its own and the model's)
const names = stages => [...new Set(stages.map(s => s.name))]

/** The take through @audio/chain's recipe → { channels, recipe }, as planned(). `opts`: plan()'s (type, intensity,
 *  targetLufs, ceiling); `say`: planned()'s. */
export async function render(channels, { sampleRate: fs, ...opts }, say = () => {}) {
  let [chain, nn] = await Promise.all([audio.import(audio.plugins.auto), neural()])
  let { recipe, at, x, y } = await planned(chain, nn, channels, fs, opts, async (stages, c) => chain.apply(c, { stages }, { fs }), say)
  if (at < 0) { say(names(recipe.stages)); return { channels: chain.apply(channels, recipe, { fs }), recipe } }
  let s = recipe.stages[at], on = s.atom === NEURAL, rest = recipe.stages.slice(on ? at + 1 : at)
  if (rest.length) say(names(rest))
  return { channels: chain.apply(on ? denoise(nn, x, y, s.params, fs) : x, { ...recipe, stages: rest }, { fs }), recipe }
}

/** The edit's options as its manifest takes them (a number into its range, an unknown choice its default) */
const params = (specs, o) => Object.fromEntries(Object.entries(specs).map(([k, sp]) => {
  let v = o[k] ?? sp.default
  return [k, sp.type === 'enum' ? (sp.values.includes(v) ? v : sp.default) : typeof v === 'number' ? Math.min(sp.max, Math.max(sp.min, v)) : sp.default]
}))

/** The take rendered whole from the edit's input (the audio as the edits before it leave it), ahead of rendering; the
 *  instance hears each part as it starts (its 'doing' event: { op, stages }), the run taking minutes on a long take. */
async function prepare(a, index, specs) {
  let o = a.edits[index][1], { options } = await audio.import(audio.plugins.auto), opts = options(params(specs, o))
  await arrived(a)
  // the channels it runs on, in the order the engine hands them to process(); same instance state as last time: the
  // input is too (read() and stream() both prepare)
  let chs = o.channel == null ? null : [o.channel].flat(), own = `${JSON.stringify(opts)}:${chs ?? ''}`, stamp = `${a.version}:${a._.len}:${own}`, done = o[RENDERED]
  if (done?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read()
  if (chs) pcm = chs.map(c => pcm[c])
  let key = `${own}:${fingerprint(pcm)}`
  if (done?.key === key) { done.stamp = stamp; return }
  let say = stages => emit(a, 'doing', { op: 'auto', stages })
  o[RENDERED] = { key, stamp, pcm: pcm[0]?.length ? (await render(pcm, { sampleRate: input.sampleRate, ...opts }, say)).channels : pcm }
}

// the manifest's op, rendered here; its recipe stat, planned as auto() plans it (the model run where the plan puts it, the
// stages before it too: its guard's verdict is the plan's evidence)
audio.hosted.auto = ({ whole, ...op }) => ({ ...op, prepare: (a, index) => prepare(a, index, op.plugin.params), process: playback('auto', RENDERED) })
audio.hosted.chain = stat => ({ ...stat, compute: async (channels, { sampleRate: fs, ...o }) => {
  let [chain, nn] = await Promise.all([audio.import(audio.plugins.auto), neural()])
  return (await planned(chain, nn, channels, fs, o, async (stages, c) => chain.apply(c, { stages }, { fs }))).recipe
} })

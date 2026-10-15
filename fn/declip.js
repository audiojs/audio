/**
 * Declip on every core: @audio/denoise-declip's rebuild is a run of jobs, a block or a window each, each made from the
 * sound and the mask alone (declipAsync), so they go out to threads (parallel.js) and come back to the samples the
 * kernel makes in turn, bit for bit. The edit's input is declipped so ahead of rendering, each channel at once, and
 * rendering takes it as it is (its range kept as any whole-render op keeps it); a render the preparation did not see
 * (another input) makes it in turn. auto() runs its declip stage through declipped() too.
 */
import audio, { arrived, ranged } from '../core.js'
import parallel from '../parallel.js'

const MOD = '@audio/denoise/declip', MADE = Symbol('declip.made')

/** Each channel of `pcm` declipped by `opts` (the kernel's: fs, clipLevel, order), the jobs on threads. */
export async function declipped(pcm, opts) {
  const { declipAsync, solve } = await import('@audio/denoise/declip')
  const map = (shared, jobs) => parallel(MOD, shared, jobs, solve)
  return Promise.all(pcm.map(x => declipAsync(x, opts, map)))
}

// the edit's input declipped ahead of rendering, as the op renders it: its options as the host snaps them (float32
// numbers, the order whole), the channels it is given; again only once the input or the options change
async function prepare(a, index) {
  let o = a.edits[index][1]
  await arrived(a)
  let chs = o.channel == null ? null : [o.channel].flat(), stamp = `${a.version}:${a._.len}:${o.clipLevel}:${o.order}:${chs ?? ''}`
  if (o[MADE]?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read()
  if (chs) pcm = chs.map(c => pcm[c])
  let opts = { fs: input.sampleRate, clipLevel: Math.fround(o.clipLevel ?? 0), order: Math.round(Math.fround(o.order ?? 256)) }
  o[MADE] = { stamp, pcm: pcm[0]?.length ? await declipped(pcm, opts) : pcm }
}

audio.hosted.declip = op => ({ ...op, prepare, whole(input, output, ctx) {
  let made = ctx[MADE]?.pcm
  if (!made || made.length !== output.length || made[0].length !== input[0].length) return op.whole(input, output, ctx)
  for (let c = 0; c < output.length; c++) output[c].set(made[c])
  ranged(input, output, ctx)
} })

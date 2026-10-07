/**
 * audio --plugins [name] [--json]: the plugins @audio/host finds (VST3, CLAP, Audio Unit, LV2), or one plugin's
 * parameters and presets, as `audio in.wav plugin NAME key:value` takes them.
 */
import audio from '../audio.js'

export default async function plugins(args) {
  let json = args.includes('--json'), refresh = args.includes('--refresh'), name = args.filter(a => !a.startsWith('--')).join(' ')
  let host
  try { host = await audio.import('@audio/host') }
  catch (e) { console.error(`plugins need @audio/host: npm i @audio/host (${e.message})`); process.exit(1) }
  if (!name) {
    let list = host.scan({ refresh })
    if (json) return console.log(JSON.stringify(list, null, 2))
    let w = Math.max(...list.map(p => p.name.length), 4)
    for (let p of list.sort((a, b) => a.name.localeCompare(b.name) || a.format.localeCompare(b.format)))
      console.log(`${p.name.padEnd(w)}  ${p.format.padEnd(4)}  ${p.vendor}${p.instrument ? '  instrument' : ''}`)
    let bad = host.failures()
    if (bad.length) console.error(`\n${bad.length} didn't load: ${bad.map(b => `${b.path} (${b.error})`).join(', ')}`)
    return
  }
  let p = host.load(name)
  let params = p.params.filter(q => !q.hidden).map(q => ({ key: q.key, name: q.name, units: q.units, value: p.get(q.key), values: q.values, readonly: q.readonly }))
  if (json) { console.log(JSON.stringify({ name: p.name, vendor: p.vendor, format: p.format, version: p.version, latency: p.latency, tail: p.tail, inputs: p.inputs, outputs: p.outputs, params, presets: p.presets }, null, 2)); p.close(); return }
  console.log(`${p.name}, ${p.vendor} (${p.format} ${p.version})${p.instrument ? ', instrument' : ''}`)
  console.log(`${p.inputChannels} in, ${p.outputChannels} out${p.sidechainChannels ? `, ${p.sidechainChannels} sidechain (key:FILE)` : ''}; latency ${p.latency} samples at ${p.sampleRate} Hz`)
  let w = Math.max(...params.map(q => q.key.length), 3)
  for (let q of params) console.log(`  ${q.key.padEnd(w)}  ${q.values ? q.values.map(v => JSON.stringify(v)).join(' | ') : `${q.value}${q.units ? ' ' + q.units : ''}`}${q.readonly ? '  (read-only)' : ''}`)
  if (p.presets.length) console.log(`presets: ${p.presets.join(', ')}`)
  p.close()
}

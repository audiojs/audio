// The page's end of the local bridge (bin/bridge.js, `npx audio --bridge`): an agent the user runs on their own machine
// (Claude Code or Codex, as the bridge started with it) edits the sound open here through the page's tools, and the chat
// talks to it. Its events come as server-sent events; a tool call is answered by `tools[name](args)` posted back; a chat
// turn streams in. The key the bridge printed is the only credential, sent as a query parameter (EventSource can send no
// header).
export default function agent({ tools, onstatus = () => {}, onchat = () => {} }) {
  let source = null, base = '', key = ''
  const post = (path, body) => fetch(`${base}${path}?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  async function receive(m) {
    if (m.type === 'hello') onstatus('online', m)
    else if (m.type === 'replaced') { close(); onstatus('replaced') }
    else if (m.type === 'chat') onchat(m)
    else if (m.type === 'call') {
      let reply
      try {
        if (!tools[m.tool]) throw new Error(`No tool ${m.tool}`)
        reply = { id: m.id, result: await tools[m.tool](m.args || {}) }
      } catch (e) { reply = { id: m.id, error: e?.message || String(e) } }
      await post('/reply', reply).catch(() => {})
    }
  }
  function connect(url, k) {
    close()
    base = url.replace(/\/+$/, '')
    key = k
    if (!base || !key) return onstatus('off')
    onstatus('connecting')
    source = new EventSource(`${base}/events?key=${encodeURIComponent(key)}`)
    source.onmessage = event => { try { receive(JSON.parse(event.data)) } catch {} }
    source.onerror = () => { if (source?.readyState === EventSource.CLOSED) { close(); onstatus('offline') } else onstatus('connecting') }
  }
  function close() { source?.close(); source = null }
  return {
    connect, close,
    get connected() { return source?.readyState === EventSource.OPEN },
    // a message to the agent: the turn it starts, its answer streaming in as chat events. `session` goes on with the
    // agent's own conversation; `history`, what was said, is told to one that does not hold it
    async chat(text, session, history = []) {
      const r = await post('/chat', { text, session, history })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `The bridge answered ${r.status}`)
      return (await r.json()).turn
    },
    stop: turn => post('/chat/stop', { turn }).catch(() => {}),
    // a file on the bridge's machine, by its path, as a File
    async file(path) {
      const r = await fetch(`${base}/file?key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}`)
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `The bridge answered ${r.status}`)
      return new File([await r.blob()], path.split(/[\\/]/).pop(), { type: r.headers.get('content-type') || '' })
    }
  }
}

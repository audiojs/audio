import { chain } from '../code.js'
import agent from '../agent.js'
import doing, { measures, noted } from '../doing.js'
import { root, specs, stored, docsOf } from './config.js'
import { state, ed, rk } from './context.js'
import { ago, stamp, ruled, note } from './format.js'
import { store } from './persist.js'
import { page } from './tools.js'

// The agent and its conversations: the bridge it is reached through, the agent and model asked, the messages and the
// calls it makes, shown as they come

// The agent's conversations, the page's whichever tab shows (the chat, below): at most CHATS, the oldest first, the one
// open its `chatId`; those kept before as each tab's own, the closed ones' too, gathered
const CHATS = 30
const talk = (() => {
  const kept = Array.isArray(stored.chats) ? stored.chats : [...docsOf(stored.docs), ...docsOf(stored.closed)].flatMap(d => Array.isArray(d.chats) ? d.chats : [])
  const chats = kept.filter(c => Array.isArray(c?.messages)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-CHATS)
  return { chats, chatId: 'chats' in stored ? stored.chat ?? null : docsOf(stored.docs)[stored.doc ?? 0]?.chat ?? null }
})()
// The page's answers to the agent's last calls, by tool and arguments, and what a tool told the chat besides: what each
// came to, said beside its step (noted, measures)
const answers = []
const answering = (tool, args, at, result, error, told) => { answers.push({ tool, key: JSON.stringify(args ?? {}), at, result, error, told }); answers.splice(0, answers.length - 32) }
export let bridge
export function connectAgent() { store(); bridge.connect(state.bridgeUrl.trim(), state.bridgeKey.trim()) }
// The agent the next message goes to, among those the bridge found: the one just picked, else the open conversation's,
// else the one last picked, else the bridge's first; and its model, as it was picked with it, if the agent has it (none:
// the agent's own choice). Another agent than a conversation's own is told what was said
let picked = null, pickedModel = null
function askAgent() {
  const c = conversation(), a = state.agentInfo = [c?.agent, picked].map(id => state.agents.find(a => a.id === id)).find(Boolean) ?? state.agents[0] ?? null
  const model = c && a?.id === c.agent ? c.model : a?.id === picked ? pickedModel : null
  state.agentModel = a?.models?.some(m => m.id === model) ? model : null
}
export function pickAgent(id, model = null) { picked = id; pickedModel = model; state.agentInfo = state.agents.find(a => a.id === id) ?? state.agentInfo; state.agentModel = model; root.querySelector('#agents-menu')?.hidePopover() }
// The conversations (`talk`) are the page's, not a tab's: the agent goes on with one whichever tab it or the user shows,
// `open` and `tabs` included. Each { id, at, title, agent, session, messages }, the one open its `chatId` (null: a new
// one, begun by its first message), at most CHATS. A message is the
// user's { role, text }, or the agent's { role, parts, running, doing, since, started, pending, turn, error }: its
// words and its finished calls in the order they came ({ text } | { step, failed }), the calls running, what it does now.
// The agent's session goes on with a conversation where that agent began it; another agent, or one that lost it, is told
// what was said (bin/bridge.js)
const conversation = () => talk.chats.find(c => c.id === talk.chatId) ?? null
// as kept: an answer the page closed on says so
export function talks() { return talk.chats.length ? { chats: talk.chats.map(c => ({ ...c, messages: c.messages.map(({ role, text, parts, error, pending }) => ({ role, ...text != null && { text }, ...parts && { parts }, ...(error || pending) && { error: error || 'Cut off: the page closed before the answer ended' } })) })), chat: talk.chatId } : {} }
// an agent's message as it shows, its words and calls in turn; its words alone, as told to an agent that did not hear them
export function partsOf(m) { return m.role === 'user' ? [] : m.parts ?? (m.text ? [{ text: m.text }] : []) }
const wordsOf = m => m.role === 'user' ? m.text : partsOf(m).filter(p => p.text).map(p => p.text.trim()).join('\n\n')
// What shows: the open conversation, whether its agent is answering; the others, newest first
function showMessages(c) { state.chat = c?.messages ?? []; state.chatBusy = !!c?.messages.at(-1)?.pending }
export function showChat() {
  const c = conversation()
  showMessages(c)
  askAgent()
  state.chats = talk.chats.toReversed().map(x => ({ id: x.id, title: x.title, when: ago(x.at), open: x === c }))
  following = true
}
export function newChat() { talk.chatId = null; showChat(); store(); root.querySelector('.chat-form textarea')?.focus() }
export function openChat(id) { talk.chatId = id; showChat(); store(); root.querySelector('#chats-menu')?.hidePopover() }
// A conversation deleted, its answer under way stopped; the open one, a new one in its place
export function dropChat(id) {
  const c = talk.chats.find(x => x.id === id), last = c?.messages.at(-1)
  if (!c) return
  if (last?.pending && last.turn) bridge.stop(last.turn)
  talk.chats = talk.chats.filter(x => x !== c)
  if (talk.chatId === id) talk.chatId = null
  showChat()
  store()
  if (!state.chats.length) root.querySelector('#chats-menu')?.hidePopover()
}
// A turn under way → its conversation, wherever it is; a turn's events that come before the page knows it, held
const turns = new Map(), early = new Map()
function told(c, change) {
  c.messages = [...c.messages.slice(0, -1), { ...c.messages.at(-1), ...change(c.messages.at(-1)) }]
  if (c === conversation()) showMessages(c)
}
// The turn as it happens: its words as they come; each call said as the user would say it (doing.js), running, then
// done, or refused, in its place among the words; its session (to go on with); its end. Meanwhile what it does: its
// agent starting, thinking (or composing a call, or reading what a call answered), the call running, its words being
// written, said by themselves
const sayAs = { time: t => stamp(t), spec: k => specs.find(x => x.key === k)?.label ?? k }
function answer(m) {
  const tool = m.tool, c = turns.get(m.turn), call = tool && { ...doing(tool, m.input, sayAs), tool, input: m.input, id: m.id, at: Date.now() }
  if (!c) { if (early.size > 8) early.clear(); return early.set(m.turn, [...early.get(m.turn) ?? [], m]) }
  if (m.session) c.session = m.session
  told(c, last => {
    let parts = partsOf(last), running = last.running ?? []
    if (m.text) parts = parts.at(-1)?.text != null ? [...parts.slice(0, -1), { text: parts.at(-1).text + m.text }] : [...parts, { text: m.text }]
    if (call) running = [...running, call]
    // a call's answer, by its id: parallel calls answer in any order; what it came to, as the page answered the same call
    // begun since the agent said it makes it (a moment before, its events and the call racing to the page)
    const done = m.answered && (running.find(r => r.id === m.answered) ?? running[0])
    if (done) {
      const key = JSON.stringify(done.input ?? {}), a = answers.findLast(x => x.tool === done.tool && x.key === key && x.at > done.at - 250)
      const note = a ? a.error ?? noted(done.tool, done.input, a.result, a.told) : '', rows = a && !a.error && tabled(done.tool, a)
      parts = [...parts, { step: rows && done.tool === 'measure' ? 'Measured' : done.then, ...note && { note }, ...rows && { rows }, ...done.show && { show: done.show }, ...m.failed && { failed: true } }]
      running = running.filter(r => r !== done)
    }
    if (m.done) { parts = [...parts, ...running.map(r => ({ step: r.then, ...m.error && { failed: true } }))]; running = [] }
    return {
      parts, running, started: last.started || !!m.session,
      doing: m.done ? '' : running.length ? running[0].now : m.text ? '' : m.thinking || m.answered || m.session && !last.started ? 'Thinking' : last.doing,
      ...m.done && { pending: false, error: m.error || '' }
    }
  })
  if (m.done) { turns.delete(m.turn); c.at = Date.now(); store() }
}
// What a call came to, as a table under its step: a check's rules, as the Export tab shows them; what a measure measured,
// where it measured more than one thing; none else
function tabled(tool, { result, told }) {
  if (tool === 'check') return result?.rules?.length ? result.rules.map(ruled) : null
  const rows = tool === 'measure' ? measures(told, sayAs) : []
  return rows.length > 1 ? rows : null
}
// A step's place on the sound, gone to: its range (and band) selected, its time the caret, its edit chosen among the edits
export function visit(show) {
  if (show.range) page.select({ at: show.range[0], d: show.range[1] - show.range[0], low: show.band?.[0], high: show.band?.[1] })
  else if (show.caret != null) page.select({ cursor: show.caret })
  else if (show.edit) {
    const k = chain(ed.code)?.calls.findLast(k => ed.code.slice(k.dot + 1, k.to) === show.edit)
    if (!k) return note('That edit is no longer in the chain')
    state.side = 'edits'
    rk.choose(k.list.from)
  }
}
// How long a turn has run, kept current while one runs
export function elapsed(since, now) { const s = Math.floor((now - since) / 1000); return !since || s < 1 ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` }
// A message to the agent, or, while it answers, the agent stopped
export async function sendChat() {
  const open = conversation(), last = open?.messages.at(-1), id = state.agentInfo?.id, model = state.agentModel, text = state.chatText.trim()
  if (last?.pending) return last.turn && bridge.stop(last.turn)
  if (!text || !id) return
  const c = open ?? { id: Date.now(), title: text.replace(/\s+/g, ' ').slice(0, 120), agent: id, session: null, messages: [] }
  if (!open) { talk.chats.push(c); talk.chats.splice(0, talk.chats.length - CHATS); talk.chatId = c.id }
  const history = c.messages.map(m => ({ role: m.role, text: wordsOf(m) })).filter(m => m.text), session = c.agent === id ? c.session : null
  Object.assign(c, { agent: id, model, at: Date.now(), messages: [...c.messages, { role: 'user', text }, { role: 'agent', parts: [], running: [], doing: `Starting ${state.agentInfo.name}`, since: Date.now(), pending: true, turn: null, error: '' }] })
  state.chatText = ''
  showChat()
  store()
  try {
    const turn = await bridge.chat(text, session, history, id, model)
    turns.set(turn, c)
    told(c, () => ({ turn }))
    for (const m of early.get(turn) ?? []) answer(m)
    early.delete(turn)
  } catch (e) { told(c, () => ({ pending: false, error: e.message })); store() }
}
// Enter sends, Shift and Enter is a new line
export function chatKey(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChat() } }
let chatLog
let following = true

export function wire() {
  bridge = agent({
    tools: Object.fromEntries(Object.entries(page).map(([tool, f]) => [tool, async args => {
      const at = Date.now()
      let told
      try { const r = await f(args, x => told = x); answering(tool, args, at, r, null, told); return r } catch (e) { answering(tool, args, at, null, e.message); throw e }
    }])),
    // online, the agents the bridge found on its machine, its first one first (none: it found none)
    onstatus(status, hello) { state.agentStatus = status; if (hello) { state.agents = hello.agents ?? (hello.agent ? [hello.agent] : []); askAgent() } },
    onchat: answer
  })
  if (state.bridgeKey) connectAgent()
  setInterval(() => { if (state.chatBusy || turns.size) state.tick = Date.now() }, 1000)
  // The conversation keeps its newest words in sight as they come, unless scrolled up to read
  chatLog = root.querySelector('.chat-log')
  chatLog.addEventListener('scroll', () => { following = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 32 })
  new MutationObserver(() => { if (following) chatLog.scrollTop = chatLog.scrollHeight }).observe(chatLog, { childList: true, subtree: true, characterData: true })
  showChat()
}

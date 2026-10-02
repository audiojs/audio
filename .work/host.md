# Hosts: one session, wherever it runs

The goal: an agent, and the user beside it, drive the same thing whether the sound is open in a browser tab, in a VS Code editor, or nowhere at all (a file on disk, a batch job). One set of tools, one document format, one command language.

## What there is now

| Surface | Speaks | Holds state | Who uses it |
|---|---|---|---|
| Library, `audio.js` | JS calls, the chain | an instance | scripts, the CLI, the editor's worker |
| CLI, `bin/cli.js` | argv: `in.wav trim normalize podcast save out.wav` | none, one shot | people, shells, the `audio` MCP tool |
| MCP, `bin/mcp.js` | `audio` (the CLI as one tool); with `--editor`, the 14 editor tools | none: relays | agents |
| Bridge, `bin/bridge.js` | HTTP + SSE on 127.0.0.1, one key | the one page connected; chat turns | the editor page, `mcp --editor`, the agent CLIs it spawns |
| Editor page | the the editor's tools (`page` in editor/editor.js) | the session: tabs, each a script, its sources, its output, view, history, conversations | the user |

What is missing for "full control from anywhere":

1. A session exists only inside a page. Without one, an agent falls back to the CLI, which has no state, no eval, no picture: the analysis that started this work ran `audio` on a guessed path and never saw the sound the user had open.
2. The tools are described twice: argv grammar for the CLI, JSON schemas for the editor's. Nothing guarantees they say the same thing.
3. One page per bridge, and no way to name which document a call is for.
4. The page reaches its host only through `EventSource` and `fetch` (editor/agent.js), so it cannot live in a VS Code webview, which talks by `postMessage`.

## The shift: the script is the document

An editor tab is already a document: a script whose last expression is the sound, its sources by name. Make that a file, `name.audio.js`, and every host reads and writes the same thing:

- the editor opens it, saves it (today it lives in localStorage);
- the CLI runs it: `audio edit.audio.js` previews, `audio edit.audio.js save out.wav` renders (the CLI and the script are already the same chain: code.js `cli()`, tested to make the same audio);
- VS Code opens it as text with the editor beside it, so undo, dirty state, save, hot exit, git diff and every agent's plain file tools come free;
- an agent can edit it with no audio tool at all, and every view follows.

Opening `voice.wav` in VS Code makes (or finds) `voice.audio.js` next to it, `audio('voice.wav')` its first line. The audio file is never overwritten unless the user exports over it.

Sources resolve relative to the script's folder in every host; the page asks its host for a name it does not hold (it already does: `missing`, "Open it…").

## One session protocol

Move the `editor` array out of bin/mcp.js into one module (`session.js`), data only: each tool's name, schema, description, read-only or not. Everything else imports it:

- the MCP server lists it;
- the page checks arguments against it before acting;
- the VS Code extension registers it as language-model tools;
- the CLI derives its session verbs and `--help` from it.

Calls are `{ tool, args, doc? }` → JSON; `doc` (an id or a path) names the document, the one focused by default. Events go the other way, so a host can follow without polling: `changed` (the script, the output), `selection`, `playing`. One more tool, `docs`: what is open, which is focused.

## Three hosts

**Browser (now).** The bridge, with two changes: several pages at once, each announcing its documents, a call routed by `doc`; and `AUDIO_BRIDGE_URL` beside `AUDIO_BRIDGE_KEY`, so `audio --mcp --editor` needs no flags in a shell that has them.

**VS Code.** An extension around the same page build:

- `CustomTextEditorProvider` for `*.audio.js`, and an "Open with audio editor" for media files that creates the sidecar ([custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors)). The text document is the truth: the page's edits become `WorkspaceEdit`s on it, outside edits (an agent's, git's) arrive as `onDidChangeTextDocument` and re-run it.
- Files come from `workspace.fs`, posted to the webview as bytes; no bridge needed for them.
- The page's transport becomes an interface: SSE and `fetch` in a tab, `postMessage` in a webview. editor/agent.js is the only file that knows.
- Agents: the bridge runs in the extension process (bin/bridge.js exports it; its signal handlers move to the CLI), and the extension declares `audio --mcp --editor` through `vscode.lm.registerMcpServerDefinitionProvider`, so Copilot's agent mode, Claude Code and Codex see the same tools ([MCP in VS Code](https://code.visualstudio.com/api/extension-guides/ai/mcp)); `environmentVariableCollection` sets the two variables for its terminals, for agent CLIs run there.
- Saving the audio: rendering runs in the extension host with the library in Node, exactly as the CLI's `save`.
- To verify early: a module `Worker` and `audioWorklet.addModule` from webview resources (the usual way is a `blob:` URL of the fetched script, with `worker-src blob:` in the CSP); `retainContextWhenHidden` so a hidden tab keeps its decoded audio.

**Headless (Node).** The same tools with no page: `audio --mcp` holds sessions itself, `open(path)` loads a script or a file into one, `edit` grows its script, `measure` runs the library, `save` writes. An agent's workflow is then identical with or without a window; when a page shows the same document, the MCP server routes there instead and the user watches. What a page alone can do (play, scrub, select) answers "no view open" headless. `look` needs a CPU renderer of the waveform and spectrogram; until then, headless answers without a picture.

## CLI parity

Every session tool gets a CLI form, from the same definitions:

| Tool | CLI |
|---|---|
| `script` / a document | `audio edit.audio.js [save out.wav]` |
| `edit` | the ops already: `audio in.wav normalize podcast` |
| `measure` | `audio in.wav eval "out.stat('loudness', { bins: 35 })"` (missing) |
| `check` | `audio in.wav check podcast` |
| `look` | `audio in.wav view 1s..3s save view.png` (missing: the renderer) |
| `state` | `audio in.wav --json` |

With `--json` on every verb, the `audio` MCP tool and a shell agent read the same answers the session tools give.

## Order of work

1. `session.js`: the tool definitions in one place; `doc` on every call; `docs`. Small, and everything after builds on it.
2. The script as a file: `audio x.audio.js` in the CLI, sources relative to it; the editor's Open and Save of `.audio.js`.
3. The transport interface in editor/agent.js; the bridge for several pages; `AUDIO_BRIDGE_URL`.
4. The VS Code extension: the custom text editor, the in-process bridge, the MCP definition provider.
5. Headless sessions in `audio --mcp`; `eval` in the CLI.
6. The CPU picture, for `look` and `audio view` without a GPU.

## Open questions

- Writing to disk from a page: today the bridge only reads media (GET /file). Saving through it is the same trust (the key), but should only ever write a path the user opened or chose.
- Long files: the page holds 30 channel-minutes (editor/worker.js PREVIEW_LIMIT). A headless session has no such limit; the same document opened in a page may not show whole.
- Concurrent edits: the user and an agent on one document. The text model serialises them in VS Code; in a tab, the page's history does.

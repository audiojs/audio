# audio.js.org — website decision

Decision brief · 2026-09-21.

Contemplation: revise + feedback + blindspots. Evidence: current source, tests, existing planning notes, live websites, public repositories, and npm data. Audience and adoption hypotheses are identified below; they are not user research.

## Decision

**Make `audio.js.org` the home of the `audio` package. Lead with one useful editing workflow. Include a small, task-oriented ecosystem section that sends people directly to the right package.**

Keep the broader ecosystem and general-purpose utilities at their existing home for now. `audiojs.org` currently redirects to [audiojs.dev](https://audiojs.dev/), which already lists conversion, loudness, silence removal, recording, and other utilities. Moving that whole property is a separate decision; it is unnecessary to give `audio` a clear home.

Do not introduce Audio Lab as another umbrella brand at launch. It could eventually name a collection of experiments, but it does not explain why someone should install `audio`.

The reason to choose this strategy is focus and reversibility. A product page can establish whether the integrated library solves a real problem. A directory can grow later when cross-package discovery demonstrates its own demand.

**A memorable npm name helps someone remember a solution. It cannot establish that they need the solution.** The goal should be useful integrations, not rescuing the name at any cost.

## What the evidence establishes

Public npm download counts, same window: **2026-08-22 through 2026-09-20**, retrieved September 21.

| Package | Downloads | What this tells us |
|---|---:|---|
| [`audio`](https://api.npmjs.org/downloads/point/2026-08-22:2026-09-20/audio) | 1,871 | Limited download activity relative to decoding; not zero usage. |
| [`audio-decode`](https://api.npmjs.org/downloads/point/2026-08-22:2026-09-20/audio-decode) | 3,205,632 | A much larger existing distribution surface around a specific task. |
| [`@audio/decode`](https://api.npmjs.org/downloads/point/2026-08-22:2026-09-20/@audio%2Fdecode) | 38,864 | The scoped package also has activity; do not add these counts into a user total. |
| [`web-audio-api`](https://api.npmjs.org/downloads/point/2026-08-22:2026-09-20/web-audio-api) | 31,626 | Another established entry point with a different job. |

These are downloads, including dependency installation, automation, and repeat installation. They do not identify active developers, direct users, satisfaction, or intent to adopt `audio`. The current [`audio-decode` release metadata](https://registry.npmjs.org/audio-decode/latest) describes it as an unscoped alias of `@audio/decode`; historic versions and dependency trees make the counts especially unsuitable as a count of potential customers.

The local package and registry both identify `audio@2.6.9`. The library already has editing, analysis, export, CLI, plugins, and a worker interface. The [current todo](todo.md) still lists a playground as unfinished (`.work/todo.md:9`), while counting 141 registry names (`:3`). This is evidence of substantial capability and an unfinished demonstration surface. It does **not** establish why adoption is low.

**UNKNOWN:** active downstream projects, retention, the share of direct versus transitive installations, website search traffic, utility-to-library conversion, and which task users would switch tools for. No analytics or user interviews were available for this review.

## The strategies compared

| Strategy | Best reason to choose it | Cost or failure mode | Verdict |
|---|---|---|---|
| Ecosystem first: all audio packages and utilities | Help people choose among independent components; support the whole collection | Different audiences and support promises compete on the homepage; repeats an existing site; catalog upkeep becomes substantial | Appropriate for the existing ecosystem home. Choose it for `audio.js.org` only if ecosystem adoption is the primary objective. |
| `audio` first, with related tools | Explain and prove why the integrated editing library is useful | Less homepage exposure for unrelated packages; needs a convincing example | **Recommended for the new domain.** |
| Minimal package documentation only | Fastest useful reference for visitors who already know what they want | Can remain invisible or unpersuasive without proof and distribution | Acceptable first release if it contains a runnable example; not the whole adoption strategy. |
| New Audio Lab umbrella | A place for experiments and independent tools | Adds a name to learn and another property to maintain before proving demand | Defer. |

The second strategy can start as the third: one page, one demonstration, documentation links, and a compact ecosystem section. There is no need to build a multi-page product site before testing the proposition.

## Essence and value proposition

**Essence: an editable audio document for JavaScript—load a recording, change it, inspect it, and produce an output.**

Initial audience hypothesis: a JavaScript developer adding editing and export to a recording, spoken-audio, or media application. A developer automating the same operations in Node is a closely related audience. A person searching for a free converter is a different audience, even if the same engine can help them.

The proposed situation → problem → implication → payoff:

- **Situation:** “My app already has an audio file. Now it needs trimming, level adjustment, preview, and export.”
- **Problem:** “Decoding gives me samples, but I still have to connect processing, state, playback, and output.”
- **Implication:** “Every new editing feature adds integration work and another place for preview and exported output to disagree.”
- **Payoff:** “I can express the edits once, preview the result, undo a change, and save the file.”

The situation and pain are hypotheses to test with developers. The payoff is supported by the current API and worker parity tests: [README](../README.md) (`README.md:79`, `:468`, `:546`) and [worker tests](../test/fix-worker.js) (`test/fix-worker.js:32`, `:43`).

This also gives `audio` a reason to exist beside `audio-decode`: **the value begins after decoding**, when someone needs a coherent editing workflow. Installing the larger library solely to decode is often unnecessary.

Against alternatives, be specific:

| What the developer needs | Sensible route |
|---|---|
| Play an audio file | Native media playback or [Howler](https://github.com/goldfire/howler.js), depending on requirements |
| Decode bytes into audio data | [`@audio/decode` / `audio-decode`](https://github.com/audiojs/decode) |
| Edit a file, inspect the result, undo, export | `audio` |
| Run Web Audio graphs in Node or CI | [`web-audio-api`](https://github.com/audiojs/web-audio-api) |
| Schedule interactive music and synthesis | [Tone.js](https://tonejs.github.io/) |
| Use FFmpeg's multimedia toolchain in a browser | [ffmpeg.wasm](https://ffmpegwasm.netlify.app/docs/overview/) |

These alternatives can overlap. Avoid a feature matrix that implies native FFmpeg, browser graph processing, and an editable document are interchangeable products. An existing working FFmpeg pipeline may offer no reason to switch; demonstrate the integration advantage where it matters.

An honest “the only library that…” claim is **not established**. The useful combination is a chainable editing API, reversible edits, analysis, export, and worker support. Prove that combination instead of claiming exclusivity.

**Smallest change that makes the value obvious:** replace the generic opening description with an editing example whose output someone can hear and download. No new DSP feature is required to test this proposition.

## Strengths to reinforce

| Existing strength | Evidence | How it compounds |
|---|---|---|
| Reversible edits and reusable edit lists | [plan.js](../plan.js), `plan.js:386–408` | Build trust through examples of undo and replay. Source availability and serializable parameters remain necessary; JSON is not a self-contained audio file. Moat class: integrations and trust, still developing. |
| One processing model across local and worker execution | [architecture](../docs/architecture.md), `docs/architecture.md:25–44`; differential worker tests | A tested editor example saves the next developer integration work. Moat class: integration knowledge and regression coverage. |
| Independently useful components | Decoder activity above; [engine-less plugin use](../README.md), `README.md:544` | Let each component succeed independently and refer users to the editing layer when needed. Moat class: distribution relationships and trust; downloads alone prove no network effect. |

The npm name and a polished landing page are not durable technical defenses. Reliable workflows, maintained compatibility, and useful examples are stronger assets to compound.

## Findings that change the next move

**Quality state: the engine has substantial tested functionality; the public adoption proposition remains unvalidated.**

1. **An ecosystem homepage already exists.** Evidence: the live domain redirects to `audiojs.dev`, with a utility collection. Implication: building a second umbrella risks duplicating work. Move: give the new domain one product identity and link the existing collection. Trade-off: two distinct destinations remain; this preserves their different visitor tasks.

2. **The facade must earn its installation.** Evidence: the download gap and the documented ability to use components without the engine. Implication: decoder popularity is not proof of demand for an editing abstraction. Move: offer direct component routes and demonstrate the precise step where `audio` saves work. Trade-off: some visitors correctly leave without installing it. This is the package consumer's interest, not lost conversion.

3. **First success deserves priority over more breadth.** Evidence: the unfinished playground beside a large registry (`.work/todo.md:3–9`). Implication: adding GPU, MCP, or another processor cannot yet be justified as the adoption fix. Move: test the existing workflow before adding capabilities for positioning. Trade-off: less novelty; faster evidence about usefulness.

4. **Utility success and library adoption require separate evidence.** Evidence: utilities already exist, but no conversion data was available. Implication: a popular converter could help many people without creating demand for `audio`. Move: show the actual implementation and a relevant recipe where a utility genuinely uses it. Trade-off: less speculative SEO expansion; a clearer link between use and integration.

5. **Runtime boundaries belong in examples.** Evidence: [save implementation](../fn/save.js), `fn/save.js:121–145`, accepts a filesystem path in Node and a writable target in browsers. Implication: a browser demo cannot copy the Node `.save('out.wav')` example literally. Move: provide complete, tested examples for each environment. Trade-off: a few more lines of necessary setup; fewer failed first attempts.

6. **Broad claims would weaken trust.** Evidence: whole-render plugins have a size guard (`plan.js:618–624`); `encode()` collects output in memory (`fn/save.js:108–117`); metadata export can buffer the output (`docs/architecture.md:159`). Implication: “unlimited files” and “everything streams” are not sound universal promises. Move: document tested formats and operation-specific limits; keep broad benchmarks off the hero. Trade-off: narrower claims that an audio engineer can verify.

7. **Domain fit does not settle product scope.** Evidence: [audio.js.org](https://audio.js.org/) currently serves a JS.ORG placeholder, not this library; no exact `audio` entry was found in the [active CNAME list](https://github.com/js-org/js.org/blob/master/cnames_active.js). Implication: approval and control remain unconfirmed. Move: build at a working project URL, then request the domain through [JS.ORG's process](https://js.org/). Trade-off: launch may precede the preferred address. The name does not oblige the project to catalog all JavaScript audio.

## What the first website should contain

The page should answer, in order: **What can I do? Can I try it? Can I use it in my code? Is it the right tool?**

### 1. An explicit promise and installation

Suggested title: `audio — edit audio in JavaScript`.

Suggested heading: **Edit audio in JavaScript.**

Supporting sentence: **Trim, adjust levels, preview, and export in the browser or Node.js.**

One primary action: **Try an example**. Keep `npm i audio` and the documentation link immediately visible. Name the package `audio`; use the domain as its address, without creating an additional product called “Audio.js”.

### 2. One working demonstration

Start with a bundled, appropriately licensed short speech recording, so success does not depend on bringing a file. Also allow file selection. Apply trim → peak normalization → fades. Provide original/edited playback, a live method chain, presets, Undo, and WAV/MP3 download. The source and result must be real output from the shipped package.

Keep the corresponding code visible. For the Node example:

```js
import audio from 'audio'

const clip = audio('voice.wav')
clip.trim().normalize(-1).fade(0.02, 0.1)
await clip.save('edited.wav')
```

For the browser example, load the selected `File` and export with `await clip.encode('wav')`; the complete example must include the Blob/download handling. For a small demonstration, buffering the WAV is acceptable. Do not imply that this export path has bounded memory for arbitrary files.

Peak normalization is used here deliberately: this example demonstrates editing, not automatic mastering. A later loudness recipe can explain the package's podcast preset, measure the output, and state its limits. Louder audio alone is not evidence of better sound.

The demonstration's memorable moment is: **the visible code made this audible change, and undo restores it.** A full code editor, timeline application, or plugin browser is unnecessary for the first release.

Implementation acceptance: playback begins on user action; unsupported/corrupt files give an actionable error; changing files cancels or discards previous work; the original stays available; repeated runs export the current result; keyboard controls work. Use the worker interface if processing interferes with interaction. Document input-size limits where they affect file selection. Claim local-only processing only after verifying the deployed implementation.

### 3. A short path from result to integration

Show Node and browser setup, a CLI example, then links to the existing API and plugin documentation. A visitor should be able to reproduce the demonstrated result in their own project within five minutes.

Start with three recipe links, initially anchored on this page or pointing to existing documentation:

- Trim a recording and export WAV.
- Adjust recording levels and measure the result.
- Build a waveform with editable preview and undo.

Give a recipe its own page only when it contains a runnable example, a result, and relevant constraints. Keep one canonical source for each recipe so the website and README do not diverge. Pin the deployed demo's package and codec versions together.

### 4. A compact explanation of the editing model

Explain three properties through their use: edits can be undone; the same chain can be previewed and exported; processing can run in a worker while an editor stays responsive. Link the architecture for readers who need details.

Avoid leading with segment maps, atoms, compilers, GPU, or “300+ packages”. Those are implementation or ecosystem details until a visitor has a reason to care.

### 5. Related tools, organized by the job

| Visitor's job | Where the website should send them |
|---|---|
| Decode without an editing engine | `audio-decode` / `@audio/decode` documentation |
| Use standard Web Audio interfaces in Node/CI | `web-audio-api`, including its documented `web-audio-api/polyfill` entry |
| Process files from a terminal | `audio` CLI documentation |
| Add an effect or analysis operation to `audio` | Plugin documentation and a small selection of working examples |
| Use DSP processors independently | The relevant `@audio/*` package and contract documentation |
| Explore broader audio utilities and packages | Existing audiojs ecosystem site |

`web-audio-api` is a sibling with its own use cases, not an `audio` plugin or a compulsory foundation for users. Distinguish its shipped polyfill from the separate `audio-ponyfill` idea still listed in `.work/todo.md:11`.

MCP remains planned in this repository (`.work/todo.md:8`, [MCP notes](mcp.md)). GPU readiness was not established in this review. Neither deserves a primary navigation item until there is a maintained release, a tested example, and a user task it improves. “Atom” can remain a term in extension documentation; most visitors need to find an effect by what it does.

### 6. Evidence and maintenance information

Link the current release, repository, tests, supported runtime/format details, license, and issue tracker. Scope each claim to the package it concerns. In particular, another package's Web Audio conformance result and aggregate ecosystem downloads must not appear as proof of `audio`'s adoption or compatibility.

## Distribution and the decision test

**Start where there is relevant intent.** In decoder documentation, a small related-workflow link can show what to use after decoding when editing, undo, or export is required. Most decoder users may never need that; preserve their direct path.

Existing utilities can expose “Use this in JavaScript” with the real implementation. Credit the package actually running the utility. If it uses standalone codecs, it should link those codecs; mentioning `audio` additionally requires a useful editing example. Do not refactor a successful utility merely to inflate facade adoption.

For search, prioritize developer tasks such as trimming audio in JavaScript, exporting an edited recording, and normalizing audio in Node. Treat these as candidate intents, not verified keyword opportunities. Use search-query and integration evidence before expanding. A package directory or a collection of generated thin pages does not supply that evidence.

The first validation effort should be small enough to perform manually:

| When | Observation to collect | Decision it informs |
|---|---|---|
| First week after a working page exists | Observe five developers with a current audio-processing task trying it; record whether they can explain the fit and produce an output without intervention | Fix positioning/setup before adding pages if first success fails |
| Within two weeks of those sessions | Check whether any used it in their own code, what they replaced, and what prevented others | Distinguish an attractive demo from a useful dependency |
| Four to six weeks after release | Review at least three concrete integration attempts, repeat use where observable, questions, and reproducible blockers | Invest in the workflow that recurs; change the audience or scope if no recurring job appears |

These are proposed learning checkpoints, not industry benchmarks or promised conversion rates. If recruitment fails, demand remains unknown; low traffic is not a product verdict. If all trials are by friends or maintainers, label that limitation.

Measure demo completion, recipe use, successful integration, and return use separately. Code-copy or install-command clicks are proxies; npm downloads cannot attribute adoption to the site. Do not collect audio or filenames for analytics. Search traffic and utility completions can be useful ecosystem outcomes even when they do not result in `audio` integrations.

**Reconsider ecosystem-first positioning** if developers repeatedly arrive needing several independent components and ask for selection/compatibility guidance more than the editing workflow. A sustained pattern of those requests would justify a stronger catalog. High consumer utility traffic alone would not.

**Reconsider the facade's importance** if developers understand and can run it, yet consistently prefer smaller components for their actual work. In that case, supporting the components is a successful outcome. Making the facade the compulsory center would serve the name rather than its users.

## Canonical shape

A small home for an editable audio library, with executable examples and clear routes to independent tools. Each package has its own reason to exist; the ecosystem connects them without requiring adoption of the whole stack.

Protect the existing separation between file editing, codecs, graph processing, and DSP components. It is already described in [scope](research.md) (`.work/research.md:212–228`). The website should make that separation understandable through tasks.

The first release can be one static page with an interactive example and existing documentation links. Keep the broader utility URLs stable. If the ecosystem domain later changes, handle the existing pages and inbound links as an explicit migration, independently of the `audio` launch.

## Kill list

- A second exhaustive package directory for launch.
- A new umbrella name introduced before it solves a navigation problem.
- Package counts, aggregate downloads, or the desirable npm name as the central value proposition.
- A hero that gives editing, decoding, Web Audio, GPU, CLI, MCP, and compilers equal billing.
- New DSP features whose only justification is making the launch look extraordinary.
- Universal performance, format, memory, runtime, or mastering claims without scoped evidence.
- Gates that make someone install `audio` to discover or use an independent component.

## Unreleased potential

1. **The example can become a useful integration reference.** Smallest unlock: publish the demo's complete source with its file-input, playback, undo, and export lifecycle. This serves the developer who wants to build the surrounding product.
2. **Edit lists can make work reproducible.** Smallest unlock: demonstrate applying one simple edit recipe to a second recording. Start with explicit operations; do not promise that serialized functions or local file handles become portable projects (`plan.js:401–403`).
3. **Existing utility results can lead naturally to code.** Smallest unlock: add one accurate implementation link to a relevant existing utility, then observe whether anyone uses it. A useful bridge can be proven before a new utility collection is built.

## Yours to answer

- If `audio-decode` keeps solving the larger need and the facade stays smaller, would that count as success for this work?
- Which five developers with a current recording/editing problem can you reach, and which workflow are you willing to support closely for them?
- The playground is still open beside a large processor registry. Will you reserve the next development interval for first-use failures and documentation, even if the requests are less interesting than new DSP?

## Verification

Reviewed the working tree without changing existing notes, including the pre-existing modification to `research.md`. `npm run test:all` passed the Node suite (675), regression suites (81), batch suite (10), and CLI suite (145), then the sandbox prevented the browser runner from opening its local server. Reran `npm run test:browser` with that permission: **493 passed, 14 skipped, no failures**. All configured test groups were therefore exercised; the browser skips are not claimed as coverage. The CLI run also emitted a `MaxListenersExceededWarning`, without failing tests.

Ran the proposed trim → normalize → fade chain against `test/fixture.wav`, saved and reopened WAV output, encoded bytes for the browser-style output path, and checked undo. This verifies those operations locally; it does not verify the future website, deployment, audible quality, or every runtime.

Live checks confirmed the ecosystem redirect, utility presence, npm metadata, and the JS.ORG placeholder. Domain approval, analytics, SEO demand, and user adoption remain unverified. Planning notes contain older names and claims; current source takes precedence. No website, DNS change, package release, or external message was made.

## Next move

The [static prototype](../index.html) now implements the package-focused page with Sprae, local assets, a generated sound, optional file input, separate Wavefont previews with playback cursors and range selection, a live method chain with gray syntax highlighting, method completion and parameter sliders, header presets, crop, Undo, split WAV/MP3 export, grayscale code examples that follow the edit chain, and related-tool links. Presets load runnable chains inside the demo instead of living in a separate link section. The generated sound replaces a bundled speech recording for this first design pass. Preview instructions and verification notes are in [assets/README.md](../assets/README.md).

**Review the prototype with a developer who has a current audio-editing task.** Use the result to refine the page before expanding it.

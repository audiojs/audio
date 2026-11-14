// A publish goes out only tested by CI, at the latest commit: node .tested.js, the last step of npm's prepublishOnly.
// It passes where the files to publish are HEAD's (none of them changed in the tree), HEAD is the tip of its branch on
// GitHub (nothing unpushed here, nothing newer there), and GitHub's `test` workflow for it passed
// (.github/workflows/test.yml: npm run test:node on Node 20, 22 and 24, the other runtimes, the polyfill). A run still
// going is waited for. Anything else stops the publish and says what to do: no suite runs here, a pass on this
// machine is not CI's.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalize } from 'node:path'

const WORKFLOW = '.github/workflows/test.yml', EVERY = 30e3, MOST = 20 * 60e3

/** CI's word on a commit, from its workflow runs as GitHub lists them (newest first): 'passed', 'failed', 'running',
 *  or 'none' where the test workflow never ran for it; with the run it is read from */
export function verdict(runs) {
  const run = runs.find(r => r.path === WORKFLOW)
  if (!run) return { is: 'none' }
  if (run.status !== 'completed') return { is: 'running', run }
  return { is: run.conclusion === 'success' ? 'passed' : 'failed', run }
}

/** The files a publish packs, or is built from, that differ from HEAD (git's short status lines) */
export function changed(pkg, cwd) {
  const paths = [...pkg.files.filter(f => f !== 'dist/'), 'package.json', 'package-lock.json', '.esbuild.js']
  return execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
}

async function main() {
  const root = fileURLToPath(new URL('.', import.meta.url)), pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  const stop = why => { console.error(`not published: ${why}`); process.exit(1) }
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let off, sha, branch
  try { off = changed(pkg, root); sha = git('rev-parse', 'HEAD'); branch = git('rev-parse', '--abbrev-ref', 'HEAD') }
  catch { stop('no commit to ask CI about (not a git checkout)') }
  if (off.length) stop(`${off.map(l => l.slice(3)).join(', ')} differ${off.length > 1 ? '' : 's'} from the commit: commit and push first`)
  if (branch === 'HEAD') stop('not on a branch: the latest commit is a branch\'s')
  // the branch as the remote names it, where it follows one
  try { branch = git('rev-parse', '--abbrev-ref', '@{upstream}').replace(/^[^/]+\//, '') } catch {}
  const at = sha.slice(0, 7), repo = String(pkg.repository?.url ?? pkg.repository).replace(/^.*github\.com[/:]|^github:|\.git$/g, '')
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const ask = path => fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { accept: 'application/vnd.github+json', ...token && { authorization: `Bearer ${token}` } } })
    .then(res => res.ok ? res.json() : Promise.reject(new Error(`GitHub answers ${res.status}`))).catch(e => stop(`CI not asked (${e.message})`))
  // the latest commit: the tip of the branch as GitHub has it now
  const tip = (await ask(`branches/${encodeURIComponent(branch)}`)).commit.sha
  if (tip !== sha) {
    let ahead = false
    try { git('merge-base', '--is-ancestor', tip, sha); ahead = true } catch {}
    stop(ahead ? `${at} is not on GitHub (its ${branch} is at ${tip.slice(0, 7)}): push it, and publish once its tests pass`
      : `${at} is not the latest commit of ${branch} on GitHub (${tip.slice(0, 7)} is): pull, and publish from that one`)
  }
  for (let since = Date.now(), said = false; ;) {
    const v = verdict((await ask(`actions/runs?head_sha=${sha}&per_page=30`)).workflow_runs)
    if (v.is === 'passed') return console.log(`tested by CI at ${at}, the latest commit of ${branch}: ${v.run.html_url}`)
    if (v.is === 'failed') stop(`CI's tests failed at ${at} (${v.run.conclusion}): ${v.run.html_url}\nfix it, or run it again there if the failure was not the code's`)
    if (Date.now() - since > MOST) stop(v.is === 'none' ? `no test run on GitHub for ${at} in ${MOST / 60e3} minutes` : `CI still testing ${at} after ${MOST / 60e3} minutes: ${v.run.html_url}`)
    // none yet: just pushed, the run not listed so far
    if (!said) { said = true; console.log(v.is === 'none' ? `no test run for ${at} yet, waiting for it` : `CI is testing ${at}, waiting for it: ${v.run.html_url}`) }
    await new Promise(r => setTimeout(r, EVERY))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) await main()

// The commit about to be published is tested: node .tested.js, the last step of npm's prepublishOnly. By CI where
// that can be told: the files to publish are HEAD's (none of them changed in the tree), and GitHub's `test` workflow
// for HEAD (.github/workflows/test.yml: npm run test:node on Node 20, 22 and 24, the other runtimes, the polyfill)
// passed. A run still going is waited for; one that failed stops the publish. Where it cannot be told (not pushed,
// no network, a file changed since the commit), the suites run here, as they did before every publish: npm run
// test:node, some five minutes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalize } from 'node:path'

const WORKFLOW = '.github/workflows/test.yml', EVERY = 15e3, MOST = 20 * 60e3

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
  return execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)
}

async function main() {
  const root = fileURLToPath(new URL('.', import.meta.url)), pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  const here = why => { console.log(`${why}: the suites run here`); process.exit(spawnSync('npm', ['run', 'test:node'], { cwd: root, stdio: 'inherit' }).status ?? 1) }
  const off = changed(pkg, root)
  if (off.length) here(`not the commit's files (${off.map(l => l.slice(3)).join(', ')})`)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const repo = String(pkg.repository?.url ?? pkg.repository).replace(/^.*github\.com[/:]|^github:|\.git$/g, '')
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const ask = async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, { headers: { accept: 'application/vnd.github+json', ...token && { authorization: `Bearer ${token}` } } })
    if (!res.ok) throw new Error(`GitHub answers ${res.status}`)
    return verdict((await res.json()).workflow_runs)
  }
  for (let since = Date.now(), said = false; ;) {
    const v = await ask().catch(e => here(`CI not asked (${e.message})`))
    if (v.is === 'none') here(`no test run on GitHub for ${sha.slice(0, 7)} (not pushed?)`)
    if (v.is === 'passed') return console.log(`tested by CI at ${sha.slice(0, 7)}: ${v.run.html_url}`)
    if (v.is === 'failed') { console.error(`CI's tests failed at ${sha.slice(0, 7)} (${v.run.conclusion}): ${v.run.html_url}\nnot published: fix it, or run it again there if the failure was not the code's`); process.exit(1) }
    if (Date.now() - since > MOST) here(`CI still running after ${MOST / 60e3} minutes`)
    if (!said) { said = true; console.log(`CI is testing ${sha.slice(0, 7)}, waiting for it: ${v.run.html_url}`) }
    await new Promise(r => setTimeout(r, EVERY))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) await main()

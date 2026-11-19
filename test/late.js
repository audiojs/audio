// A file whose second test is registered after a top-level await longer than tst waits: test/one.js runs both
// (test/fix-deps.js holds it). Not a suite.
import test from 'tst'

test('late: registered before the await', t => t.pass())
await new Promise(r => setTimeout(r, 300))
// LATE_THROW=1: the file throws as it evaluates, which fails the run, optional or not
if (process.env.LATE_THROW) throw new Error('late: asked to throw')
// LATE_FAIL=1: it fails, so the run's exit code is seen to follow the result
test('late: registered after the await', t => process.env.LATE_FAIL ? t.fail('asked to fail') : t.pass())

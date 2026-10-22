// CI typecheck ratchet. This tree has known pre-existing TypeScript errors; the gate fails on ANY increase and tells you when
// the baseline can be lowered. It never hides errors: the full tsc output is printed.
import { spawnSync } from 'node:child_process';

const BASELINE = 11;
const r = spawnSync('pnpm', ['exec', 'tsc', '--noEmit'], { encoding: 'utf8' });
const out = (r.stdout ?? '') + (r.stderr ?? '');
process.stdout.write(out);
if (r.error) { console.error('TYPECHECK: FAIL - tsc could not run'); process.exit(1); }
const count = (out.match(/error TS\d+/g) ?? []).length;
if (r.status !== 0 && count === 0) { console.error('TYPECHECK: FAIL - tsc failed without diagnostics'); process.exit(1); }
if (count > BASELINE) { console.error(`TYPECHECK: FAIL - ${count} errors, baseline is ${BASELINE} (no new type errors allowed)`); process.exit(1); }
console.log(`TYPECHECK: PASS (${count} errors <= baseline ${BASELINE}${count < BASELINE ? '; lower BASELINE in scripts/ci-typecheck-baseline.mjs' : ''})`);

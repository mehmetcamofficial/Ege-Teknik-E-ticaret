/**
 * Sprint C — test-discovery determinism guard.
 *
 * History: the npm test glob (tests, double-star, *.test.ts) was previously passed UNQUOTED, so
 * whether the shell or Node expanded it depended on the local shell (sh vs bash+globstar vs zsh).
 * A `**` swallowed by `sh` degrades to `tests/<star>/<star>.test.ts` and would silently run only
 * test files one directory deep — i.e. silently drop the suite. The glob is now always quoted so
 * Node's own glob expansion handles it identically on macOS, Linux and GitHub Actions.
 *
 * These assertions lock that in: the script stays quoted, the suite stays above a file-count
 * floor (a discovery regression shrinks the count), and tests/support never gains a `*.test.ts`
 * file that could be matched-or-dropped differently by another shell.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// The suite held 72 test files when this guard was added; the floor leaves room for
// consolidation but catches a discovery collapse (e.g. only a subdirectory running).
const TEST_FILE_FLOOR = 60;

function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(path));
    else if (entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

test("the npm test script passes the test glob quoted to the Node runner", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.test, /node --test /, "tests run through the Node test runner");
  assert.match(
    packageJson.scripts.test,
    /"tests\/\*\*\/\*\.test\.ts"/,
    "the glob must be double-quoted so the shell can never expand it differently per platform",
  );
});

test("test discovery finds the full suite (no silent shell-glob collapse)", () => {
  const files = collectTestFiles("tests");
  assert.ok(
    files.length >= TEST_FILE_FLOOR,
    `only ${files.length} test files discovered (floor ${TEST_FILE_FLOOR}) — test discovery regressed`,
  );
  assert.ok(
    files.includes(join("tests", "sprint-b-postgres.integration.test.ts")),
    "the PostgreSQL integration file must stay discoverable at the top level of tests/",
  );
});

test("tests/support holds helpers only — never files the runner would pick up as tests", () => {
  assert.deepEqual(collectTestFiles(join("tests", "support")), []);
});

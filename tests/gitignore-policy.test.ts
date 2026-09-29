import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** P0-A #1: local scratch/audit directories must never be tracked. */
const gitignore = readFileSync(".gitignore", "utf8");

test(".scratch/ is ignored", () => {
  assert.match(gitignore, /^\.scratch\/$/m);
});

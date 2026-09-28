import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMigrationEnvironment, MigrationGuardError } from "./migrate-lib.mjs";

export const MIGRATION_0011_SHA256 = "f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626";
export const GOVERNANCE_MIGRATION_INDEX = 11;
export const PRODUCTION_BOOTSTRAP_CONFIRMATION = "I_UNDERSTAND_FIRST_ADMIN_BOOTSTRAP";

export function assertBootstrapEnvironment(env) {
  const guarded = assertMigrationEnvironment(env);
  if (!env.APP_ENV || env.APP_ENV !== guarded.target) throw new MigrationGuardError("APP_ENV must exactly match MIGRATION_TARGET_ENV.");
  if (guarded.target === "production" && env.ALLOW_PRODUCTION_FIRST_ADMIN_BOOTSTRAP !== PRODUCTION_BOOTSTRAP_CONFIRMATION) {
    throw new MigrationGuardError("Production first-admin bootstrap is blocked.");
  }
  return guarded;
}

export async function preparePreGovernanceMigrations(sourceFolder = "drizzle-pg") {
  const journalPath = join(sourceFolder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const governance = journal.entries.find((entry) => entry.idx === GOVERNANCE_MIGRATION_INDEX && entry.tag === "0011_admin_governance");
  if (!governance) throw new MigrationGuardError("Migration 0011 is missing from the expected journal position.");
  const governanceSql = await readFile(join(sourceFolder, `${governance.tag}.sql`));
  if (createHash("sha256").update(governanceSql).digest("hex") !== MIGRATION_0011_SHA256) {
    throw new MigrationGuardError("Migration 0011 integrity check failed.");
  }

  const entries = journal.entries.filter((entry) => entry.idx < GOVERNANCE_MIGRATION_INDEX);
  if (entries.length !== GOVERNANCE_MIGRATION_INDEX || entries.some((entry, index) => entry.idx !== index)) {
    throw new MigrationGuardError("Pre-governance migration chain is incomplete.");
  }
  const directory = await mkdtemp(join(tmpdir(), "ege-first-admin-"));
  await mkdir(join(directory, "meta"));
  await writeFile(join(directory, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) await copyFile(join(sourceFolder, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
  return {
    directory,
    lastPreGovernanceTimestamp: entries.at(-1).when,
    governanceTimestamp: governance.when,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export function safeBootstrapError(error) {
  if (error instanceof MigrationGuardError || error?.name === "FirstAdminBootstrapError") return error.message;
  if (typeof error?.code === "string") return error.code;
  return error?.name ?? "Error";
}

/** Password input is never accepted as a CLI argument or printed. TTY input is read with echo disabled. */
export async function readPassword(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    let value = "";
    input.setEncoding("utf8");
    for await (const chunk of input) value += chunk;
    value = value.replace(/\r?\n$/, "");
    if (value.includes("\n") || value.includes("\r")) throw new MigrationGuardError("Password input must contain exactly one line.");
    return value;
  }

  output.write("Administrator password: ");
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise((resolve, reject) => {
      let value = "";
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") {
            input.off("data", onData);
            output.write("\n");
            resolve(value);
            return;
          }
          if (character === "\u0003") {
            input.off("data", onData);
            reject(new MigrationGuardError("Bootstrap cancelled."));
            return;
          }
          if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
          else if (character >= " ") value += character;
        }
      };
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

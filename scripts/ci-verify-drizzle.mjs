// CI migration-safety: offline checks of drizzle/ (no network, no hosted database).
//  1. journal entries <-> SQL files <-> snapshots are consistent and sequential
//  2. already-shipped migrations are byte-frozen (a changed hash means someone edited history)
//  3. all migrations apply cleanly, in order, to a throw-away in-memory SQLite database and yield exactly the tables db/schema.ts declares
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const FROZEN = {
  '0000_chief_cloak': '1c7ad69d382256c84aa87d99cbeaf8304e53b2e834e03e71ba032b840e932531',
  '0001_sharp_bruce_banner': '440e757cd3a4cfb9d397e97a2b7bf7789ce771c3ce681bcde6b873319b747a3c',
};
const fail = (m) => { console.error(`MIGRATION SAFETY: FAIL - ${m}`); process.exit(1); };
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
if (journal.dialect !== 'sqlite') fail(`unexpected dialect ${journal.dialect}`);
const tags = journal.entries.map((e, i) => { if (e.idx !== i) fail(`journal idx gap at ${i}`); return e.tag; });
const sqlFiles = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort();
if (JSON.stringify(sqlFiles) !== JSON.stringify([...tags].sort())) fail('journal and SQL files differ');
tags.forEach((t, i) => {
  if (!t.startsWith(String(i).padStart(4, '0') + '_')) fail(`tag ${t} is not sequential`);
  if (!existsSync(`drizzle/meta/${String(i).padStart(4, '0')}_snapshot.json`)) fail(`missing snapshot for ${t}`);
});
for (const [tag, hash] of Object.entries(FROZEN)) {
  const actual = createHash('sha256').update(readFileSync(`drizzle/${tag}.sql`)).digest('hex');
  if (actual !== hash) fail(`${tag}.sql changed after release (frozen)`);
}
const db = new DatabaseSync(':memory:');
for (const tag of tags) {
  for (const stmt of readFileSync(`drizzle/${tag}.sql`, 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    try { db.exec(stmt); } catch (e) { fail(`${tag} does not apply: ${e.message}`); }
  }
}
const actual = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all().map((r) => r.name).sort();
const declared = [...readFileSync('db/schema.ts', 'utf8').matchAll(/sqliteTable\("([a-z_]+)"/g)].map((m) => m[1]).sort();
if (JSON.stringify(actual) !== JSON.stringify(declared)) fail(`schema drift: migrations create [${actual}] but db/schema.ts declares [${declared}]`);
console.log(`MIGRATION SAFETY: PASS (${tags.length} migrations, ${actual.length} tables, frozen hashes verified)`);

// Fail-closed gate on a pg_restore --list table of contents: a Production backup must carry the OWNER / ACL / DEFAULT ACL metadata and the
// critical objects, otherwise it cannot restore the security model and must never be encrypted or uploaded. It does not trust the total TOC
// entry count (a stripped dump can be padded, a healthy one grows with every migration). Prints only a fixed verdict and rule ids.
// Usage: node scripts/backup-toc-guard.mjs <toc-file|->      (toc = `pg_restore --list DUMP`, comment lines starting with ';' are ignored)
import { readFileSync } from 'node:fs';

const TYPES = ['TABLE DATA', 'DEFAULT ACL', 'SEQUENCE OWNED BY', 'SEQUENCE SET', 'FK CONSTRAINT', 'CHECK CONSTRAINT', 'ACL', 'TABLE', 'SEQUENCE', 'FUNCTION',
  'SCHEMA', 'INDEX', 'TRIGGER', 'CONSTRAINT', 'DEFAULT', 'EXTENSION', 'COMMENT', 'TYPE', 'VIEW', 'PROCEDURE', 'POLICY', 'PUBLICATION'];

export function parseToc(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = /^\d+; \d+ \d+ (.+)$/.exec(line.trim());
    if (!m) continue;
    const rest = m[1], type = TYPES.find((t) => rest === t || rest.startsWith(t + ' ')) ?? rest.split(' ')[0];
    const tokens = rest.slice(type.length).trim().split(/\s+/);
    const owner = tokens.pop(), schema = tokens[0] ?? '-';
    entries.push({ type, schema, owner, args: tokens.slice(1), rest });
  }
  return entries;
}

/** The reviewed Production profile. Only the owner and the critical objects are named; counts are never compared. */
export const PRODUCTION = {
  owner: 'neondb_owner',
  ownerSkipTypes: new Set(['ACL', 'DEFAULT ACL', 'EXTENSION', 'COMMENT']),
  criticalTables: ['public.orders', 'public.order_items', 'public.order_legal_acceptances', 'public.products', 'public.admin_users', 'drizzle.__drizzle_migrations'],
  criticalFunctions: ['admin_users_retire_owner_guard()', 'legal_document_versions_guard()', 'product_reviews_guard()'],
  defaultAclCreators: ['neondb_owner'],
};

/** Returns the list of failed rule ids (empty = pass). */
export function checkToc(text, profile = PRODUCTION) {
  const e = parseToc(text), fail = [];
  if (e.length === 0) return ['toc_unreadable'];
  const tables = e.filter((x) => x.type === 'TABLE' && x.schema === 'public').map((x) => x.args[0]);
  const aclTables = new Set(e.filter((x) => x.type === 'ACL' && x.schema === 'public' && x.args[0] === 'TABLE').map((x) => x.args[1]));
  if (tables.length === 0 || tables.some((t) => !aclTables.has(t))) fail.push('acl_missing_for_public_table');
  if (!e.some((x) => x.type === 'ACL' && x.schema === '-' && x.args[0] === 'SCHEMA' && x.args[1] === 'public')) fail.push('acl_missing_for_public_schema');
  for (const kind of ['TABLES', 'SEQUENCES'])
    for (const creator of profile.defaultAclCreators)
      if (!e.some((x) => x.type === 'DEFAULT ACL' && x.rest.includes(`FOR ${kind} ${creator}`) && x.owner === creator)) fail.push(`default_acl_missing_${kind.toLowerCase()}_${creator}`);
  if (e.some((x) => !profile.ownerSkipTypes.has(x.type) && x.owner !== profile.owner)) fail.push('unexpected_or_missing_owner');
  for (const t of profile.criticalTables) {
    const [schema, name] = t.split('.');
    if (!e.some((x) => x.type === 'TABLE' && x.schema === schema && x.args[0] === name)) fail.push(`critical_table_missing:${t}`);
    if (!e.some((x) => x.type === 'TABLE DATA' && x.schema === schema && x.args[0] === name)) fail.push(`critical_table_data_missing:${t}`);
  }
  if (!e.some((x) => x.type === 'SCHEMA' && x.args[0] === 'drizzle')) fail.push('critical_schema_missing:drizzle');
  for (const f of profile.criticalFunctions) if (!e.some((x) => x.type === 'FUNCTION' && x.schema === 'public' && x.args[0] === f)) fail.push(`critical_function_missing:${f}`);
  return fail;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let text = '';
  try { if (process.argv.length !== 3) throw Error(); text = readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8'); } catch { /* fail closed below */ }
  const fail = checkToc(text);
  if (fail.length) { console.error(`BACKUP TOC GUARD: BLOCKED (${fail.join(', ')})`); process.exitCode = 1; }
  else console.log('BACKUP TOC GUARD: PASS');
}

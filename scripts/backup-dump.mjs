// Translate a direct PostgreSQL URI to libpq fields, keeping secrets out of argv.
import { spawnSync } from 'node:child_process';
const parameters = {
  sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY',
  sslpassword: 'PGSSLPASSWORD', sslcrl: 'PGSSLCRL', channel_binding: 'PGCHANNELBINDING',
  connect_timeout: 'PGCONNECT_TIMEOUT', options: 'PGOPTIONS', application_name: 'PGAPPNAME',
  target_session_attrs: 'PGTARGETSESSIONATTRS', ssl_min_protocol_version: 'PGSSLMINPROTOCOLVERSION',
};
// Fail-closed role attestation. With BACKUP_EXPECTED_ROLE set, the SAME libpq environment as pg_dump (host, TLS, options) must connect as
// exactly that role, before any dump starts. Only the two fixed result lines are ever printed; the URL, host and psql output never are.
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
function attestRole(env, role) {
  if (!ROLE_NAME.test(role)) return false;
  const sql = "SELECT current_user = '" + role + "' AND session_user = '" + role + "'";
  const probe = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '--no-password', '-c', sql],
    { env, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 60000 });
  return probe.status === 0 && probe.stdout.trim() === 't';
}
let blocked = false;
try {
  if (process.argv.length !== 3) throw Error();
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || url.hash) throw Error();
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  for (const [name, value] of url.searchParams) {
    if (!parameters[name]) throw Error(); // Never silently weaken TLS or lose an option.
    env[parameters[name]] = value;
  }
  if (process.env.BACKUP_EXPECTED_ROLE !== undefined) {
    if (!attestRole(env, process.env.BACKUP_EXPECTED_ROLE)) { blocked = true; console.error('BACKUP ROLE ATTESTATION: BLOCKED'); throw Error(); }
    console.log('BACKUP ROLE ATTESTATION: PASS');
  }
  const child = spawnSync('pg_dump', ['--format=custom', '--file=' + process.argv[2]], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  if (child.status !== 0) throw Error();
} catch {
  if (!blocked) console.error('BACKUP DUMP: FAIL (connection, permissions or direct URI configuration)');
  process.exitCode = 1;
}

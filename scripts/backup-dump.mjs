// Translate a direct PostgreSQL URI to libpq fields, keeping secrets out of argv.
import { spawnSync } from 'node:child_process';
const parameters = {
  sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY',
  sslpassword: 'PGSSLPASSWORD', sslcrl: 'PGSSLCRL', channel_binding: 'PGCHANNELBINDING',
  connect_timeout: 'PGCONNECT_TIMEOUT', options: 'PGOPTIONS', application_name: 'PGAPPNAME',
  target_session_attrs: 'PGTARGETSESSIONATTRS', ssl_min_protocol_version: 'PGSSLMINPROTOCOLVERSION',
};
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
  const child = spawnSync('pg_dump', ['--format=custom', '--file=' + process.argv[2]], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  if (child.status !== 0) throw Error();
} catch {
  console.error('BACKUP DUMP: FAIL (connection, permissions or direct URI configuration)');
  process.exitCode = 1;
}

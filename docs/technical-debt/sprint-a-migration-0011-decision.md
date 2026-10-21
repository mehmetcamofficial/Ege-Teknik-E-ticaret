# Sprint A — Migration 0011 decision

## Decision

Choose **Option C**: keep `0011_admin_governance.sql` immutable and use the explicitly invoked, operator-only pre-migration bootstrap documented in `docs/operations/first-admin-bootstrap.md` for a brand-new database with no administrator.

Sprint A.1 implements the command without executing it against any shared database. It stages migrations only through 0010, creates exactly one active legacy `owner` under an advisory lock and transaction, and leaves unchanged migration 0011 to perform the reviewed promotion.

## Evidence

- 0011 SHA-256 is `f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626` and is pinned by a regression test.
- Its guard promotes exactly one active legacy `owner`, refuses zero owners, refuses multiple owners, and permits the zero-owner plus consolidation-audit state for retry/resume.
- The Drizzle 0.45.2 PostgreSQL migrator stores a hash, but selects pending migrations by the latest ledger `created_at` and each journal timestamp. Editing 0011 would therefore neither repair databases that already recorded it nor preserve a truthful ledger hash.
- A forward migration cannot help a clean database because the chain aborts inside 0011 before any later migration can run.
- No Production or shared Preview database was contacted. Preview is known from prior approved evidence to have advanced through 0012, which implies 0011 was recorded there; Production ledger state is deliberately unverified under the no-Production-access boundary.

## Implemented bootstrap design

Before the ordinary migrator reaches 0011, the dedicated operator command:

1. require an explicit non-Production target and the existing exact Neon branch guard;
2. takes the initial administrator email from the environment and plaintext password only from a hidden prompt or standard input, never arguments or logs;
3. acquire a transaction-scoped advisory lock;
4. uses the official Drizzle migrator to prepare a new database through 0010, then fails closed unless the ledger is exactly at 0010 and `admin_users` contains zero rows;
5. inserts exactly one active legacy `owner` with an auditable identity, without echoing credentials;
6. commit, then run the ordinary migration chain so unchanged 0011 promotes that row to `super_admin` and records its deterministic audit;
7. be idempotent only for the exact already-created bootstrap identity; any different or multiple-user state must stop for human review.

The implementation has isolated transaction/concurrency tests for zero admins, existing administrators, retries, rollback, environment guards, secret containment, and the 0011 precondition. It is not a public request path, automatic deploy side effect, seed-on-GET behavior, or historical migration rewrite.

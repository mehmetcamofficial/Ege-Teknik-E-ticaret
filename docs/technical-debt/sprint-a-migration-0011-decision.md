# Sprint A — Migration 0011 decision

## Decision

Choose **Option C**: keep `0011_admin_governance.sql` immutable and require a separately reviewed pre-migration bootstrap step for a brand-new database with no administrator.

Sprint A does not implement or execute that privileged bootstrap. Clean zero-admin migration remains a release blocker until the operator workflow and credential source receive explicit approval.

## Evidence

- 0011 SHA-256 is `f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626` and is pinned by a regression test.
- Its guard promotes exactly one active legacy `owner`, refuses zero owners, refuses multiple owners, and permits the zero-owner plus consolidation-audit state for retry/resume.
- The Drizzle 0.45.2 PostgreSQL migrator stores a hash, but selects pending migrations by the latest ledger `created_at` and each journal timestamp. Editing 0011 would therefore neither repair databases that already recorded it nor preserve a truthful ledger hash.
- A forward migration cannot help a clean database because the chain aborts inside 0011 before any later migration can run.
- No Production or shared Preview database was contacted. Preview is known from prior approved evidence to have advanced through 0012, which implies 0011 was recorded there; Production ledger state is deliberately unverified under the no-Production-access boundary.

## Required future bootstrap design

Before the ordinary migrator reaches 0011, a dedicated operator command should:

1. require an explicit non-Production target and the existing exact Neon branch guard;
2. take the initial administrator identity and password hash only through an approved secret channel, never arguments or logs;
3. acquire a transaction-scoped advisory lock;
4. fail closed unless `admin_users` exists and contains zero rows (not merely zero active owners);
5. insert exactly one active legacy `owner` with a stable, auditable identity, without echoing credentials;
6. commit, then run the ordinary migration chain so unchanged 0011 promotes that row to `super_admin` and records its deterministic audit;
7. be idempotent only for the exact already-created bootstrap identity; any different or multiple-user state must stop for human review.

The implementation must include disposable-database tests for empty DB, exactly one owner, multiple owners, already-recorded 0011, interrupted retry, and concurrent bootstrap attempts. It must not be introduced as a public request path, automatic deploy side effect, seed-on-GET behavior, or historical migration rewrite.

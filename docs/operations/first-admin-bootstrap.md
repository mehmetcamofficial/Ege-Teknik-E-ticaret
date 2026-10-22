# First administrator bootstrap

This operator-only command prepares a new database through migration 0010 and creates the single active legacy `owner` required by immutable migration 0011. Migration 0011 then promotes that identity to `super_admin` and records the governance role-change audit.

Use it only for a new environment containing exactly zero administrator rows. It is not an account-recovery tool and cannot create a second owner.

## Procedure

1. Configure the direct, unpooled database connection and exact target guards:
   - `DATABASE_URL_UNPOOLED`
   - `MIGRATION_TARGET_ENV` (`development`, `preview`, or `production`)
   - `APP_ENV` with the same value
   - `NEON_BRANCH_ID`
   - `EXPECTED_NEON_<ENVIRONMENT>_BRANCH_ID`
2. Set `ADMIN_BOOTSTRAP_EMAIL` to the first administrator's valid email address.
3. Run `pnpm admin:bootstrap-first` explicitly. Enter the password at the hidden prompt. The command does not accept the password as a command-line argument and does not print it or its hash.
4. Confirm the fixed success messages. Do not continue after any error.
5. Run the ordinary migration chain with `pnpm db:migrate`. Unchanged migration 0011 converts the bootstrap `owner` to `super_admin`.
6. Log in with the newly created account.
7. Rotate the bootstrap credential if required by the operational credential policy.

The bootstrap command uses the official Drizzle migrator to apply only migrations 0000–0010, obtains a database advisory lock, verifies that the ledger is immediately before 0011, and creates the administrator plus its bootstrap audit in one transaction. A retry sees the existing administrator and performs no write.

Production additionally requires both existing migration confirmation `ALLOW_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION` and the distinct deliberate confirmation `ALLOW_PRODUCTION_FIRST_ADMIN_BOOTSTRAP=I_UNDERSTAND_FIRST_ADMIN_BOOTSTRAP`. These confirmations never replace the exact branch checks. Production use still requires a separately authorized operational change; this document does not authorize it.

Never place a password, password hash, database URL, token, or other secret in source control, command arguments, logs, screenshots, or tickets. Existing Preview and Production environments that have already recorded migration 0011 do not need this command.

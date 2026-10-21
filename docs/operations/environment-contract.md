# Environment contract (authoritative)

This is the single reference for which variables exist, where they are set and what breaks without them.
It was derived from the code (`grep process.env`) and from the verified Production/Preview state; it contains **names only, never values**.
Rules: never commit values, never print them, never paste them into tickets. `.env.example` lists only the customer-auth pair.

**Vercel behaviour that matters:** a changed variable applies only to **new** deployments. After adding or changing a Production
variable, the running deployment does not see it until it is redeployed (`vercel redeploy <deployment> --target=production`).

## Database identity guards (mandatory, fail-closed)

| Variable | Where | Meaning |
|---|---|---|
| `APP_ENV` | every deployed environment | `development`, `preview` or `production`. Anything else makes the first DB access throw. |
| `NEON_BRANCH_ID` | every deployed environment | The Neon branch this deployment is allowed to talk to. |
| `EXPECTED_NEON_<ENV>_BRANCH_ID` | `EXPECTED_NEON_PRODUCTION_BRANCH_ID` in Production, `EXPECTED_NEON_PREVIEW_BRANCH_ID` in Preview | Must equal `NEON_BRANCH_ID` or the DB guard (`db/index.ts`) rejects every query. |
| `DATABASE_URL` | every deployed environment | **Pooled** Neon connection string (secret). |

`/api/health` returns `{environment, branchId}` from these variables. It is the first request after any deployment.

## Application runtime

| Variable | Required | Used by | If missing |
|---|---|---|---|
| `IP_HASH_SALT` (>= 32 chars, secret) | **Yes**, Production and Preview | rate limiting, admin login/sessions, invites, password reset, reviews, second-hand reservations, orders, analytics | Those routes return 500 (`hashWithSecret` throws). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Yes for `/account` | `proxy.ts`, customer auth | `/account` unavailable. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional | admin invite / password-reset e-mail (`lib/mail.ts`) | Mail is reported `not_configured`; nothing crashes, no e-mail is sent. |
| `BLOB_READ_WRITE_TOKEN` (and the other `BLOB_*` Vercel Blob variables) | Optional | admin product image upload | Image upload fails; the storefront is unaffected. |
| `ANALYTICS_ENABLED` (`"true"` to enable) | Optional | first-party analytics collection kill-switch | Analytics are off. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry server/edge init | Sentry disabled. |
| `SENTRY_AUTH_TOKEN` | Optional, build-time only | source-map upload | No upload. Never needed at runtime. |
| `PAYMENT_PROVIDER` | Preview only today | not read by any application code | No effect (PayTR is not implemented). |

## Client-IP trust boundary (P3-S1A)

Application rate limiting, and every `ipHash` column, are keyed on the client IP that `lib/security-policy.ts`'s
`trustedClientIp()` reads from the request: the **first** element of `X-Forwarded-For`, else `X-Real-IP`, else the
literal `unknown` — accepted only when the value is a valid IPv4 or IPv6 address, with surrounding whitespace
normalised. The address itself is never stored; only `sha256(IP_HASH_SALT + ":" + address)` is.

**The application does not authenticate that header, and does not claim to prevent spoofing.** The value is trusted
because the hosting platform sets it: per Vercel's documented behaviour, Vercel **overwrites** `X-Forwarded-For` and
does not forward external IPs, explicitly to prevent IP spoofing
(<https://vercel.com/docs/headers/request-headers>). That platform guarantee — not the parser — is the trust
boundary. The parser's only guarantees are that an arbitrary string can never become a bucket identity and that
whitespace never splits one client across two buckets.

Two changes require a security review of this assumption, not just a deployment note:

- **Moving the application behind another proxy, CDN or host.** A proxy that forwards (rather than replaces) the
  client's `X-Forwarded-For` makes the first element caller-chosen, and every per-IP limit becomes bypassable. Re-validate
  this boundary before any such move; the parser will not catch it.
- **Enabling Vercel Enterprise "Trusted Proxy".** That is the documented feature that lets a custom
  `X-Forwarded-For` reach the application, i.e. it would remove the very guarantee this design depends on.

## Operator-only (never set on Vercel runtime)

These are read only by scripts run by an operator from a trusted machine with a chmod-600 credential file.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | `pnpm db:migrate`, bootstrap, import scripts | **Direct** (non-`-pooler`) endpoint. The migrator refuses a pooler host. |
| `MIGRATION_TARGET_ENV` | migrator | Must equal `APP_ENV` semantics of the target. |
| `ALLOW_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION` | migrator | Required for `production`. |
| `ALLOW_PRODUCTION_FIRST_ADMIN_BOOTSTRAP` | `pnpm admin:bootstrap-first` | Additional deliberate confirmation for Production. |
| `ADMIN_BOOTSTRAP_EMAIL` | `pnpm admin:bootstrap-first` | The password is entered at a hidden prompt. |
| `ENRICHMENT_IMPORT_CONFIRM` | product-enrichment import script | Explicit confirmation. |

`ADMIN_BOOTSTRAP_PASSWORD_HASH` is **no longer read by the application** (login-time bootstrap was removed in Sprint A). If it still exists in a
Vercel environment it can be deleted after confirming a super_admin exists.

## CI and local test variables

| Variable | Where | Notes |
|---|---|---|
| `SPRINTB_PG_URL` | CI `postgres-integration` job; developer machines | Loopback disposable PostgreSQL whose database name starts with `sprintb`. The suite drops and recreates its schemas. Never a Neon URL. |
| `LOCAL_BUILD_NO_UPLOAD=1` | CI `build` job; local verification builds | Disables Sentry source-map upload, release creation and build telemetry. |
| `CI` | GitHub Actions | Makes Sentry build output verbose only. |

CI holds **no** Neon, Vercel, Production or Preview credentials (enforced by `tests/ci-workflow-policy.test.ts`).

## Verified Production baseline (2026-09-27)

Production has: `APP_ENV`, `DATABASE_URL`, `NEON_BRANCH_ID`, `EXPECTED_NEON_PRODUCTION_BRANCH_ID`, `IP_HASH_SALT`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and the legacy `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD_HASH`.
Absent (optional features off): `RESEND_API_KEY`, `MAIL_FROM`, `BLOB_*`, `ANALYTICS_ENABLED`, Sentry variables.

Known identities (identifiers, not secrets): Production branch `br-nameless-grass-aw9qpndy`, Preview branch `br-nameless-mountain-awib28a9`.
A Production branch id appearing in a Preview/Development target is refused by the migrator.

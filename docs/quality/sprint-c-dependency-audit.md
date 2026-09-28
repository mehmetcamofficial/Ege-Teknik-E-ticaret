# Dependency audit (Sprint C)

Command: `pnpm audit` / `pnpm audit --prod` (2026-09-28). No major upgrades were made; no Next.js, React, React DOM, Clerk, Sentry or Drizzle version changed.

## Result

| Scope | Before | After |
|---|---|---|
| All dependencies | 33 advisories (0 critical, 18 high, 11 moderate, 4 low) | **3 advisories (0 critical, 1 high, 1 moderate, 1 low)** |
| Production dependencies (`--prod`) | 5 (3 high, 2 low), all build-time transitives | **1 (low)** |

## What was changed (all in-range, transitive unless noted)

Security floors were added to the `overrides:` section of `pnpm-workspace.yaml` (pnpm 11 reads overrides there). Each stays inside the
semver range the parent already accepts, except the two dev-tool pins noted:

| Package | Floor | Reason (advisories cleared) |
|---|---|---|
| `brace-expansion@1` / `@5` | `>=1.1.18` / `>=5.0.9` | ReDoS/OOM (high); reached via `minimatch` in ESLint and the Sentry bundler plugin |
| `js-yaml@4` | `>=4.3.2` | quadratic CPU (high, moderate); ESLint config loading |
| `@babel/core@7` | `>=7.29.6` | file read via source-map comment (low); `styled-jsx` and Sentry plugin |
| `fflate@0.7`, `image-size@2` | `>=0.7.5`, `>=2.0.3` | DoS in parsers (moderate, high); `vinext` dev tooling |
| `undici@7`, `ws@8` | `>=7.29.0`, `>=8.21.0` | multiple (high); Cloudflare `miniflare`/`wrangler` local emulation only |
| `vite` (direct devDependency, exact pin) | `8.0.13` -> `8.0.16` | patch release inside 8.0; dev-server file-access advisories (high, moderate) |

Verification after the change: `pnpm lint`, `pnpm typecheck`, `pnpm test` (1038 pass, 14 opt-in PostgreSQL skips, 0 fail) and `pnpm build` all pass; the lockfile is committed and CI installs with `--frozen-lockfile`.

## Remaining advisories (documented, not fixable in-range)

| Advisory | Where | Runtime exposure | Why it remains |
|---|---|---|---|
| `esbuild` <=0.24.2 (moderate: dev server accepts cross-origin requests) | `drizzle-kit` -> `@esbuild-kit/*` (esbuild 0.18) | **None**: only when someone runs esbuild's dev server; `drizzle-kit` is a developer CLI and is never bundled or deployed | Fix needs a newer `drizzle-kit`; upgrading a migration tool is out of scope for this sprint |
| `esbuild` 0.27.x/0.28.0 (low: Windows dev-server file read) | `wrangler` (dev) and the Sentry webpack plugin (build) | **None** at runtime; Windows-only dev-server behaviour | Pinned by parent packages; the `--prod` low finding is this one |
| `react-server-dom-webpack` 19.2.6 (high: DoS in Server Functions) | direct **devDependency**, used by the `vinext`/`@vitejs/plugin-rsc` tooling | **Not the runtime**: Production runs Next.js 16.3.4 with its own vendored React server runtime; this package is not imported by the deployed application | Exactly pinned to the React version (19.2.6). Raising React or this pin together is a framework upgrade (out of scope). Track it with the next React patch upgrade |

Nothing that runs inside the Production Vercel deployment (Next, React, pg, drizzle-orm, Clerk, Blob) has an open advisory.

## Policy going forward

- Run `pnpm audit --prod` before each release and record the result; treat any high/critical **runtime** advisory as release-blocking.
- Review the overrides above whenever the parent package (ESLint, Sentry, miniflare, vinext) is upgraded and drop the floor once the parent's own range covers it.
- `minimumReleaseAge` (7 days) and `strictDepBuilds` in `pnpm-workspace.yaml` stay enabled.
- Do not add `pnpm audit` as a blocking CI gate yet: advisories appear daily and would make unrelated pull requests fail. Schedule it as a separate report instead.

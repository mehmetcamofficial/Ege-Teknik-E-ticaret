# EGE TEKNİK — Production Legal Publish Readiness (2026-11-02)

**Decision: NO-GO — preparation only.** No legal content was published; no Production/Preview database write, migration, Vercel env update, merge, or deployment was performed.

## 1. Grounded evidence

| Gate | Status | Evidence / qualification |
|---|---|---|
| Unit: legal template | PASS | Mac operator output 23 passed / 0 failed |
| Unit: legal preview context | PASS | Mac operator output 9 passed / 0 failed |
| Unit: legal preview protocol | PASS | Mac operator output 27 passed / 0 failed; notification enqueue warnings appeared and require a separate production notification review |
| Real PostgreSQL 18 legal evidence | PASS | Isolated loopback `127.0.0.1:55441`, disposable DB `sprintb_legal_20261102`, 19 passed / 0 failed / 0 skipped; no production DB target |
| Current Production env variable **presence** | PASS | Vercel project `dragonfire-09s-projects/ege-teknik-phase3a`: `LEGAL_PREVIEW_SIGNING_SECRET` appears with target `production` and sensitive type. Value, runtime binding and length were not read/verified |
| Production document inventory | BLOCKED | Previous Production read-only inventory returned 0 document rows and 0 versions; API `/api/legal/required` returned 503. Recheck immediately before approved publication |
| Storefront legal approval | BLOCKED | Human legal/company sign-off absent; `approval-checklist.md` boxes intentionally left empty |
| Company address | BLOCKED | RC uses Cumhuriyet Mah.; older registration / chamber source uses İkiçeşmelik Mah.; current official certificate and separately-designated returns address still needed |
| Mandatory business registration | BLOCKED | ETBİS registration pending authorized company representative |
| Operating terms | BLOCKED | Payment method, actual logistics and fees, service/installation scope, warranty, return routing, notice button text and customer notifications require matching live operation |
| KVKK vendor transfer | BLOCKED | Vercel, Neon, Clerk, Sentry real DPA/region/subprocessor and applicable KVKK transfer mechanism require legal review |
| KVKK hash inventory | BLOCKED | The branch's `kvkk.md` has an editorial change. `inventory.json` still contains **the old SHA-256**, so it must be regenerated and reviewed before any hash-based approval; never treat stale hash as valid |

## 2. Verified application publish contract (source only)

- Create draft: `POST /api/admin/legal/documents/[slug]/versions`, owner-only `legal:write`, server generates version and content hash.
- Publish approved draft: `POST /api/admin/legal/versions/[id]/publish`, body `{"effectiveAt":"ISO-8601 timestamp with offset"}`; server fills publication timestamp, actor, content hash and audit trail.
- Required **checkbox** versions: `distance-sales`, `pre-information`.
- Required **notice**, not an acceptance checkbox: `kvkk`.
- A published version is effective only after its effective time. Changing published text requires a **new version**.
- Do not ingest Markdown review banners, `[DOĞRULAMA BEKLİYOR]`, internal notes, stale placeholders or fabricated company/operator values as customer-facing approved text.
- The previous 78 tests exercised the known release code; edits on this legal review branch have not been merged/deployed or rerun as a complete post-change test suite.

## 3. Exact release sequence AFTER human approval

1. Receive company-confirmed current registration and returns addresses; verify KEP/ETBİS position and seller details.
2. Finalize operational payment/delivery/installation/returns terms and KVKK vendor-transfer determination.
3. Legal counsel reviews the precise final bodies; regenerate `inventory.json` file hashes and sign approval against frozen content (NOT the historical KVKK hash).
4. Independent read-only Production identity, 26 migrations, legal inventory, owner authorization, signing-secret metadata and backup/rollback readiness checks; never read or display secrets.
5. Approved change window only: owner creates drafts with **approved final bodies**, compare canonical content hash and ensure review metadata/banners are absent.
6. Approved change window only: owner explicitly publishes versions with correct effective time; verify audit rows and published actor.
7. Confirm `/api/legal/required` reports exactly two current required checkbox versions and that KVKK notice is published. Verify public exact-version links, fail-closed stale version rejection, and acceptance evidence using controlled non-production cases; Production write/synthetic order only with separate explicit authorization.
8. Open real checkout only after all business and legal gates are signed off.

## 4. Current operator decision

**NO-GO: Do not publish or turn on checkout.** The legal database implementation and the isolated tests can be treated as technically prepared, but human approvals, current company address, ETBİS, vendor review, final hash register and operational readiness are not closed.

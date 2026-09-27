# EGE TEKNİK — GO-LIVE COMPLIANCE CHECKLIST

> **STATUS:** Internal operational/legal checklist. Not customer-facing.
> **Scope:** ETBİS, İYS/commercial electronic messages, KVKK international transfers, VERBİS, analytics/cookies and related go-live evidence.
> **Rule:** Unknown facts stay `PENDING`; registration, provider, region, contract or approval details are never invented.

## Status legend

- `DONE` — verified with evidence.
- `PENDING OWNER` — business/accountant must provide or complete.
- `PENDING LEGAL` — lawyer/privacy review required.
- `PENDING TECH` — technical verification required.
- `BLOCKER` — relevant production capability must remain disabled until resolved.
- `NOT ACTIVE` — feature intentionally disabled.

## 1. ETBİS

Ege Teknik plans to accept orders through its own e-commerce domain `egeteknik.tr`. The current ETBİS registration for the company/domain has not been evidenced yet.

| Item | Status | Required evidence / action |
|---|---|---|
| MERSİS number | PENDING OWNER | Obtain from accountant/company records. |
| VKN used in ETBİS identity | PENDING OWNER | Use official company record; do not place the number in this public repository. |
| `egeteknik.tr` ETBİS registration | BLOCKER | Complete/verify company + domain record through official ETBİS/e-Devlet flow. |
| Company/domain identity match | PENDING OWNER | Compare official record with legal pack. |
| ETBİS evidence | PENDING OWNER | Retain screenshot/PDF/date internally. |
| ETBİS QR code | NOT REQUIRED | Legacy QR-code application was terminated in 2025; do not create a false go-live requirement. |

## 2. Commercial electronic messages / İYS

Marketing remains separate from checkout, distance-sales acceptance and KVKK disclosure. The customer must be able to order without promotional consent.

| Item | Status | Required evidence / action |
|---|---|---|
| Promotional SMS/e-mail/WhatsApp automation | NOT ACTIVE | Keep disabled for V1 until compliance flow is complete. |
| İYS service-provider registration/status | PENDING OWNER | Verify real company/brand record. |
| Marketing choices separate from checkout legal acceptance | DONE DESIGN | Must remain optional and unchecked by default. |
| Final marketing-consent text | PENDING LEGAL | Review `marketing-consent.md` before activation. |
| Consent evidence retention | PENDING TECH | Retain source, timestamp, channel, text/version and state. |
| İYS consent synchronization | BLOCKER FOR MARKETING | Complete before promotional workflow activation. |
| Rejection/withdrawal path | BLOCKER FOR MARKETING | Easy and free opt-out + suppression. |
| Transactional vs promotional templates | PENDING LEGAL/TECH | Keep order/service notices separate from advertising. |

Core commerce may launch with marketing automation disabled.

## 3. KVKK — international transfers

Current active/possible technical providers include Vercel, Neon, Clerk and temporary Sentry. Disclosure alone does not establish a lawful transfer mechanism.

| Provider | Purpose | Current status | Required before compliance sign-off |
|---|---|---|---|
| Vercel | hosting/runtime/deployment | PENDING LEGAL | Verify account configuration, regions, DPA, subprocessors, role and KVKK m.9 mechanism. |
| Neon | PostgreSQL | PENDING LEGAL | Verify Production region, backup/replica locations, DPA, subprocessors and transfer mechanism. |
| Clerk | customer authentication | PENDING LEGAL | Verify fields, cookies/storage, processing regions, DPA/subprocessors and transfer mechanism. |
| Sentry | temporary diagnostics | PENDING LEGAL / TEMPORARY | Verify while trial remains active; remove from active register when disabled and no new data is processed. |
| Future payment provider | payment | NOT ACTIVE | Review when contracted/activated. |
| Future e-document provider | fiscal documents | PENDING OWNER | Identify after accountant confirmation. |
| Future carrier | shipping/returns | PENDING OWNER | Identify before provider-specific legal statements. |

If a KVKK standard contract is the applicable safeguard, use the correct controller/processor scenario and retain signature + Authority notification evidence. The official KVKK notification guidance specifies notification within **five business days** after signing.

## 4. VERBİS

Current official KVKK criteria must be applied to Ege Teknik's **real 2025 figures**, not assumed from company type.

For a real/tüzel data controller whose **main activity is not processing special-category personal data**, the current exemption includes entities with **annual employee count below 50 AND annual balance-sheet total below 100 million TL**. The criteria are cumulative for balance-sheet-basis entities. The 25.12.2025 decision also clarifies the approach for entities not keeping books on a balance-sheet basis.

Ege Teknik's HVAC sales/service activity is not being classified in this checklist as a special-category-data core business without a legal review; the accountant/lawyer must confirm the real position.

| Item | Status | Evidence |
|---|---|---|
| 2025 annual balance-sheet total < 100M TL? | PENDING OWNER/ACCOUNTANT | Accountant-confirmed 2025 financial statement. |
| Annual employee count < 50? | PENDING OWNER/ACCOUNTANT | Payroll/employee-count evidence per current VERBİS calculation rules. |
| Main activity special-category-data processing? | PENDING LEGAL | Confirm business classification. |
| Final VERBİS registration/exemption conclusion | PENDING LEGAL/ACCOUNTANT | Record legal basis/evidence internally. |

A VERBİS exemption does **not** exempt the company from KVKK obligations such as disclosure, data security, data-subject rights, minimization or transfer compliance.

## 5. Analytics / cookies

The visitor-analytics design now uses two gates:

1. global server-side `ANALYTICS_ENABLED` kill-switch, and
2. per-visitor `ege_analytics_consent=1` preference.

Without both, analytics event ingestion returns without recording and no `ege_vid` visitor identifier is created. Revoking analytics preference triggers server-side deletion of the HttpOnly analytics identifier.

| Item | Status | Required action |
|---|---|---|
| Cookie preference UI | IMPLEMENTED ON BRANCH | Verify visual/accessibility behavior in Preview/Production candidate. |
| Analytics consent gate | IMPLEMENTED ON BRANCH | Verify no-consent → no event/no `ege_vid`. |
| Consent granted behavior | PENDING TECH | Verify event recorded and dashboard updates when global switch is true. |
| Consent withdrawal | PENDING TECH | Verify `ege_vid` deletion and no further event ingestion. |
| Production `ANALYTICS_ENABLED` | PENDING DEPLOY DECISION | Set true only after preference UI/code is the deployed production version. |
| Google Fonts / Tailwind Play CDN | DONE TECH | Runtime third-party font/Tailwind dependencies removed from deployed storefront path; Tailwind now builds locally and CSP no longer needs those origins. |
| Google-hosted representative images | DONE TECH | Homepage representative images are localized to first-party assets at build time. |
| Clerk cookies/storage | PENDING TECH | Browser/network audit against real Production configuration. |

Sales/order analytics sourced from real orders are not dependent on the visitor analytics consent cookie; visitor behavior metrics are.

## 6. Company / accountant facts still needed

Obtain in one batch on Monday:

- MERSİS number,
- KEP address, if active,
- trade-registry/chamber information if required,
- e-Fatura/e-Arşiv status,
- active e-document integrator/accounting software,
- 2025 balance-sheet total,
- annual employee count,
- existing VERBİS status if any,
- existing ETBİS record if any,
- current İYS service-provider status if any.

## 7. Feature gates

**Orders:** required checkout legal documents must be published and `/api/legal/required` must succeed. ETBİS/company readiness is a separate business launch gate.

**Marketing:** promotional automation stays disabled until İYS/consent/withdrawal compliance is complete.

**Payment:** no card flow until the provider is contracted, customer-facing method/legal text matches reality, and callback/security controls are complete.

**Shipping:** no carrier shipping until carrier + fee/return conditions are real and shown before order confirmation.

## 8. Final evidence-based sign-off

Required evidence includes:

- ETBİS company/domain record,
- final legal-document versions/effective dates,
- checkout acceptance + exact-version evidence,
- active payment/delivery methods,
- marketing/İYS state,
- vendor DPA/region/subprocessor/transfer assessment,
- accountant-confirmed company/e-document/VERBİS facts,
- analytics consent browser/network test,
- lawyer/privacy review,
- Production smoke after legal publication.

Until evidenced, keep precise statuses (`PENDING`, `NOT ACTIVE`, `BLOCKER`) rather than claiming full legal compliance.

# EGE TEKNİK — GO-LIVE COMPLIANCE CHECKLIST

> **STATUS:** Operational/legal checklist. This file is not customer-facing legal text and must not be published as a legal document.
> **Scope:** ETBİS, İYS/commercial electronic messages, KVKK international transfers, and related go-live evidence.
> **Rule:** Unknown facts stay `PENDING`; do not invent registration, provider, region, contract, or approval details.

## Status legend

- `DONE` — verified with evidence.
- `PENDING OWNER` — business owner/accountant must provide/complete.
- `PENDING LEGAL` — requires lawyer/privacy counsel review.
- `PENDING TECH` — requires technical verification.
- `BLOCKER` — order acceptance or feature activation must remain disabled until resolved.
- `NOT ACTIVE` — feature is intentionally not in use; no production processing should occur through that feature.

---

## 1. ETBİS

### Current legal/operational position

Ege Teknik accepts/orders goods through its own e-commerce domain `egeteknik.tr`. Under the Ministry of Trade's ETBİS guidance, service providers operating in their own electronic-commerce environment are within the ETBİS registration scope and registration is expected before e-commerce activity begins.

For legal entities, ETBİS registration uses company identity information including MERSİS and tax identity information together with the e-commerce domain/application information.

### Checklist

| Item | Status | Required evidence / action |
|---|---|---|
| Confirm Ege Teknik's current MERSİS number | PENDING OWNER | Obtain from accountant/company records; do not guess. |
| Confirm VKN used in ETBİS identity record | PENDING OWNER | Use official company document; never derive or guess. |
| Confirm `egeteknik.tr` ETBİS registration exists | BLOCKER | Check ETBİS/e-Devlet company account and record evidence. |
| Confirm company name/address/domain match current legal identity | PENDING OWNER | Compare ETBİS record with legal pack. |
| Record ETBİS registration date / record evidence internally | PENDING OWNER | Screenshot/PDF or account record. |
| ETBİS QR code | NOT REQUIRED | Ministry announced the ETBİS QR-code application was terminated in September 2025; do not add a legacy QR-code requirement to the site. |

### Go-live rule

Do not mark ETBİS as complete until the actual company record for `egeteknik.tr` is verified. Do not treat an ETBİS registration as a general security/trust certification; it is a regulatory registration record.

---

## 2. Commercial electronic messages / İYS

### Current product rule

Marketing consent remains completely separate from checkout, distance-sales acceptance and KVKK disclosure. A customer must be able to place an order without consenting to promotional SMS, e-mail, telephone or WhatsApp marketing.

Ege Teknik must not send a commercial electronic message merely to ask the recipient for marketing consent.

Business/merchant-recipient exceptions and other statutory exceptions must not be generalized to ordinary consumers; any automated rule must be legally reviewed before implementation.

### Checklist

| Item | Status | Required evidence / action |
|---|---|---|
| Promotional SMS/e-mail/WhatsApp automation enabled | NOT ACTIVE | Keep disabled for V1 unless compliance flow is complete. |
| İYS service-provider registration/status | PENDING OWNER | Verify company record and brand/service-provider details in İYS. |
| Marketing checkbox separate from legal checkout acceptance | DONE | Product/legal design rule. Must remain optional and unchecked by default. |
| Consent text identifies channel/purpose sufficiently | PENDING LEGAL | Review final marketing-consent wording before activation. |
| Consent evidence retained | PENDING TECH | Store source, time, channel, consent version and state where applicable. |
| İYS consent synchronization | BLOCKER FOR MARKETING | Required before production marketing workflow is enabled where applicable. |
| Rejection/withdrawal path | BLOCKER FOR MARKETING | Provide practical opt-out and reflect withdrawal in marketing suppression. |
| Suppression after withdrawal | PENDING TECH | Marketing jobs must check current permission state before send. |
| Order/service transactional messages separated from promotions | PENDING LEGAL/TECH | Classify templates; do not add advertising to service/order notices by default. |

### Go-live rule

Core commerce may launch with promotional communications disabled. Marketing automation must stay off until the İYS/consent/withdrawal flow is verified end to end.

---

## 3. KVKK — international transfers

### Current architecture requiring review

Current technical architecture includes services such as:

- Vercel — hosting/deployment/runtime,
- Neon — PostgreSQL database,
- Clerk — customer authentication/account service,
- Sentry — temporary error/observability trial.

The fact that a vendor is named in the privacy/KVKK text does **not** itself make an international transfer lawful. The actual data flow, processing role, hosting/processing regions, sub-processors, contractual mechanism and applicable KVKK Article 9 transfer mechanism must be assessed separately.

### Data-minimization status already implemented

For the temporary Sentry trial:

- hard-coded DSN was removed from source,
- SDK activation depends on environment configuration,
- `userInfo: false` is configured,
- HTTP request-body collection is disabled,
- performance trace sampling is limited to 10%,
- Sentry is documented as removable after the trial.

This reduces collection but does not by itself resolve the legal basis for any international transfer.

### Vendor-by-vendor checklist

| Provider | Purpose | Current status | Required before final compliance sign-off |
|---|---|---|---|
| Vercel | hosting/runtime/deployment | PENDING LEGAL | Verify account region options, DPA, subprocessors, actual personal-data categories, international-transfer mechanism. |
| Neon | PostgreSQL database | PENDING LEGAL | Verify production region, DPA, subprocessors, backup/replica locations, processor role and transfer mechanism. |
| Clerk | customer authentication | PENDING LEGAL | Verify data fields used, storage/processing regions, DPA, subprocessors and transfer mechanism. |
| Sentry | temporary diagnostics | PENDING LEGAL | Verify DPA/region/transfer mechanism while trial remains enabled; remove from active-data-flow register when fully disabled and no longer processing new data. |
| Future payment provider | payment | NOT ACTIVE | Review only when provider is actually contracted/activated. Never write hypothetical provider facts into the final register. |
| Future e-invoice/e-archive provider | fiscal document service | PENDING OWNER | Identify provider after accountant confirmation, then assess data flow. |
| Future carrier | shipping/returns | PENDING OWNER | Identify actual carrier before adding provider-specific statements. |

### Standard-contract rule

KVKK Article 9 provides standard contracts as one possible appropriate safeguard for international transfers. If a standard contract is the applicable mechanism, the signed standard contract must be notified to the Personal Data Protection Authority within **five business days** through an allowed notification method, including the Authority's Standard Contract Notification Module.

Do not assume that one standard-contract type fits every vendor. The correct controller/processor transfer scenario and official standard-contract text must be selected based on the real data flow and reviewed before signature/notification.

### Required evidence folder / register

For every active vendor processing personal data, retain internally:

1. vendor legal entity and service name,
2. purpose and data categories,
3. controller/processor role mapping,
4. processing/storage region(s),
5. subprocessor list/reference,
6. DPA/data-processing terms and date/version,
7. international-transfer mechanism relied upon,
8. if standard contract is used: signed copy, signing date, correct scenario/template and Authority notification evidence/date,
9. retention/deletion controls,
10. vendor termination/offboarding procedure.

### Go-live rule

International-transfer compliance remains `PENDING LEGAL` until active production vendors are reviewed using their actual account configuration and contractual documents. The public KVKK text may accurately disclose categories and transfer possibility, but disclosure is not a substitute for completing the required transfer mechanism.

---

## 4. VERBİS / data-controller registry

`PENDING LEGAL / ACCOUNTANT` — determine whether Ege Teknik is currently subject to VERBİS registration or benefits from an applicable exemption based on the company's actual legal/economic/employment facts and current Board criteria. Do not infer exemption solely from company type.

If registration is required, the inventory and public KVKK text must remain consistent with the registered processing inventory.

---

## 5. Company / accountant facts still needed

Ask the accountant/company records for the following as one batch:

- MERSİS number,
- KEP address, if active,
- trade-registry number and chamber information if needed for site/legal disclosures,
- e-Fatura/e-Arşiv status,
- active e-document integrator/provider,
- ETBİS registration status for `egeteknik.tr`,
- VERBİS status / prior registration or exemption assessment,
- current commercial electronic-message / İYS service-provider status.

Do not block drafting on unknown optional identifiers, but do not publish a fabricated placeholder to customers.

---

## 6. Feature gates

### Orders

Production order acceptance may be enabled only after the required checkout legal documents are published and the current required-document API succeeds. ETBİS/company regulatory readiness must be separately confirmed before commercial launch.

### Marketing

Keep automated promotional communications disabled until İYS/consent/withdrawal compliance is complete.

### Sentry

May remain temporarily enabled for the trial only with data-minimization controls. Remove SDK/environment configuration and update the active data-flow/legal documentation when the trial ends.

### Payment

Do not activate a card-payment flow until the contracted payment provider, legal disclosures, callback/security controls and actual payment method shown to the customer are aligned.

---

## 7. Evidence-based final sign-off

Final go-live compliance sign-off should be evidence-driven, not a checkbox assertion. Required evidence includes:

- ETBİS company/domain record,
- final legal-document versions and effective dates,
- checkout acceptance evidence design,
- actual active payment/delivery methods,
- marketing/İYS state,
- vendor privacy/DPA/transfer review,
- accountant-confirmed company/e-document facts,
- lawyer/privacy review of final texts and transfer mechanism,
- technical production smoke test after publication.

Until those items are evidenced, use precise statuses (`PENDING`, `NOT ACTIVE`, `BLOCKER`) rather than claiming full legal compliance.

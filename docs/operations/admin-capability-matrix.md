# Admin capability matrix

Which management action each admin resource genuinely supports, and **why**. The rule this document
enforces: an action is offered only when an existing, permission-checked endpoint performs it. Missing
buttons are either an intentional domain decision (column A) or a gap that was implemented (column B) —
never silence.

`lib/admin-ui.ts` → `recordActionsFor(resource)` is the machine-readable version of this table, and
`tests/admin-record-actions.test.ts` asserts it.

| Resource | View | Edit | Archive | Delete | Endpoint / reason |
|---|---|---|---|---|---|
| Products | ✅ | ✅ | ✅ | ❌ | `PATCH /api/admin/products/[id]`; `DELETE` is a **soft** archive (status `draft`, `saleMode` `out_of_stock`, stock 0). Hard delete deliberately absent — the `inventory` FK needs the row. |
| Second-hand / Outlet | ✅ | ✅ | ✅ | ✅ | `PATCH`; `DELETE` = archive (`sold`, stock 0); `DELETE ?hard=1` = permanent, **refused 409** when a reservation exists. |
| Categories | ✅ | ✅ **new** | ✅ | ✅ | `PATCH` now renames `name`/`slug` (previously it could only flip `active`) → see gap G1. `DELETE` **refused 409** while products reference it. |
| Brands | ✅ | ✅ **new** | ✅ | ✅ | Identical to Categories (`brands` table). Gap G1. |
| Inventory | ✅ | ✅ inline | ❌ | ❌ | `PATCH /api/admin/products/[id] {stock}` edited in the row itself. No independent lifecycle: an inventory row has no identity of its own. |
| Blog | ✅ | ✅ | ✅ | ✅ | `PATCH`; `DELETE` = archive (`draft`); `DELETE ?hard=1` = permanent (audit row retained). |
| Service / discovery requests | ➖ row is the record | ❌ | ❌ | ❌ | `PATCH {status}` only. **No detail page and no single-record GET** (`[id]/route.ts` is PATCH-only), and the row already renders every column of `ServiceRequestListRow`. Closing statuses (`completed`, `cancelled`) confirm and name the request. |
| Legal documents | ✅ | ✅ draft | ❌ **by decision** | ✅ draft | `PATCH`/`DELETE` drafts only; a published version is immutable (migration `0005`) and the domain refuses with 409. See "Legal archive". |
| Reviews | ➖ row is the record | ❌ | ❌ | ❌ | `PATCH` moderation only. Content is **immutable by DB trigger** and there is deliberately no DELETE — a review is customer-authored and order-linked. |
| Orders | ✅ | ❌ | ❌ | ❌ | `PATCH` state machine with `expectedStatus` + finance guards. **Never a delete**: an order carries payment-ledger and `order_legal_acceptances` history. |
| Users / admin | ✅ | ✅ role | ✅ disable | ❌ | `PATCH .../role`, `.../status`, `.../grants`. **No user delete** — accounts are deactivated for audit continuity. |
| Analytics / Finance / Payments / Settings | ✅ | ❌ | ❌ | ❌ | Read-only reporting screens. |

## Gap B — implemented in this change

**G1 — Categories & Brands were not read-only; rename was simply missing.** Their `PATCH` accepted only
`{ active }`, so master data could be created, deactivated and deleted but never renamed — a real gap, not
a domain decision. `app/api/admin/taxonomy/route.ts` now accepts optional `name`/`slug`, requires at least
one field, and maps a unique-slug violation (23505) to a 409 instead of a 500. The UI gained an inline
rename row. **No schema change.**

**G2 (found by manual Preview smoke test) — Service Requests / Reviews were reported with a "View"
capability that does not exist.** The earlier matrix claimed `Görüntüle` for service requests, but there is
**no detail page** under `app/admin/(panel)/service-requests/` and **no single-record GET** —
`app/api/admin/service-requests/[id]/route.ts` exports `PATCH` only. The row already renders every column
of `ServiceRequestListRow` (number, date, name, phone, email, city, type, message, status), so the row *is*
the complete record. Reporting a `Görüntüle` button would have been a fake action pointing nowhere, so the
capability was **corrected to none** rather than a detail route being invented. Same for reviews.
`tests/admin-record-actions-render.test.ts` now asserts this so it cannot drift again.

**➖ "row is the record"** marks a resource with no detail surface. Its list row is the whole record, so the
only actions shown are the inline ones (status `<select>`, moderation buttons).

## Column A — deliberately absent (unsafe or inappropriate here)

- **Hard delete on orders/payments/audit records.** Financial and acceptance history must survive.
- **Review content editing/deleting.** DB-triggered immutability; reviews are customer-authored.
- **Deleting users.** Deactivation preserves the audit trail.
- **Deleting a product.** `inventory.productId` FK; archive instead.
- **Legal archive** — see below.

## Legal archive: why there is no `Arşivle`

A legal version's status is **derived** (`draft` / `scheduled` / `effective` / `superseded`, see
`lib/legal-admin.ts` → `deriveLegalStatus`) and never stored, and `legal_document_versions` has **no**
`archived`/`withdrawn` column. Adding one would mean a new column plus a new write path on the one table
whose defining property is that a published row can never change again — migration `0005`'s trigger fires
on **any** `UPDATE` of a published row.

A draft is already removable through the real, audited `Sil` path (`LEGAL_DRAFT_DELETED`). An archive flag
would therefore add a second, weaker way to do the same thing and would create drafts that *look*
removable but are not. `Arşivle` is deliberately absent from the legal action set rather than faked, and
`tests/admin-record-actions.test.ts` asserts `legal_document_versions` never grows such a column.

Decision recorded in code as `LEGAL_ARCHIVE_DECISION` (`lib/admin-ui.ts`).

## Legacy legal fixtures (Preview only)

Published legal fixtures are immutable and partly FK-referenced by real order acceptances, so they are
**hidden, never deleted**. Identification is centralised in `lib/legal-fixtures.ts`; `lib/legal-db.ts`
(public + checkout) is untouched, so the storefront and acceptance flow are unaffected. Gated on
`APP_ENV=preview`; Production always shows the full history. Inspectable via **Eski/Test kayıtlarını göster**.
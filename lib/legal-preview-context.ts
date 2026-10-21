import type { CheckoutAuthorityContext } from "@/lib/checkout-authority";
import { deliveryTraits, type DeliveryClass } from "@/lib/delivery";
import { canonicalJson, digestCanonicalContext, digestRenderedLegalBody, type LegalPreviewDocument } from "@/lib/legal-preview-token";
import { renderOrderLegalDocument, type OrderLegalContext } from "@/lib/legal-template";

/**
 * P3-LEGAL-3C.4 / P2 - the canonical legal-context binding.
 *
 * Everything that can change the MEANING of the accepted contract, or the economics of the order, is reduced to one
 * explicit, ordered, canonical byte string and hashed. Preview and order submission build that byte string from the
 * SAME server-authoritative calculation, so any drift - a price, a quantity, an address, a tariff, a legal version -
 * changes the digest and the submission fails closed.
 *
 * Deliberately NOT hashed: raw JavaScript object serialisation (its key order would be incidental), anything the
 * customer merely TYPED that never reaches the contract, and the rendered bodies themselves (bound separately, per
 * document, by their own SHA-256).
 */

/** The exact, explicit inputs the digest binds. Field names are the canonical serialisation's key order. */
export type CanonicalLegalContext = {
  v: 1;
  identity: { orderNumber: string; orderIssuedAt: number };
  customer: { name: string; email: string; phone: string; address: string; billing: string };
  delivery: { city: string; district: string; method: string; region: string; shippingAmount: number; installationAmount: number; installationIncluded: boolean };
  lines: { productId: string; sku: string; name: string; quantity: number; unitPrice: number; vatRateBps: number; vatAmount: number; lineTotal: number }[];
  totals: { subtotal: number; vatTotal: number; shippingTotal: number; installationTotal: number; total: number };
  legal: { required: { slug: string; versionId: string }[] };
};

/**
 * Build the canonical context from the server-authoritative calculation plus the frozen order identity.
 *
 * `orderNumber` and `orderIssuedAt` come from the signed preview token on submission, so both sides rebuild the exact
 * same identity rather than the order route minting a fresh one.
 */
export function buildCanonicalLegalContext(input: {
  calculation: CheckoutAuthorityContext;
  data: { customerName: string; email: string; phone: string; address: string; city: string; district: string };
  billing: string;
  orderNumber: string;
  orderIssuedAt: number;
}): CanonicalLegalContext {
  const { calculation, data, orderNumber, orderIssuedAt } = input;
  return {
    v: 1,
    identity: { orderNumber, orderIssuedAt },
    customer: { name: data.customerName, email: data.email, phone: data.phone, address: data.address, billing: input.billing },
    delivery: {
      city: calculation.plan.province,
      district: calculation.plan.district,
      method: calculation.plan.method,
      region: calculation.plan.region,
      shippingAmount: calculation.shippingTotal,
      installationAmount: calculation.installationTotal,
      // `installationTotal` is currently always 0, so the installation *preference* is bound explicitly: switching a
      // product between installed and local delivery must invalidate a preview even though no money moves.
      installationIncluded: calculation.lines.every((line) => deliveryTraits(line.product.deliveryClass as DeliveryClass).installationIncluded),
    },
    // `calculation.lines` is already the authoritative, stably ordered set - never re-sorted here.
    lines: calculation.lines.map((line) => ({
      productId: line.product.id,
      sku: line.product.sku,
      name: line.product.name,
      quantity: line.quantity,
      unitPrice: line.product.price,
      vatRateBps: line.product.vatRateBps,
      vatAmount: line.vatAmount,
      lineTotal: line.lineTotal,
    })),
    totals: {
      subtotal: calculation.subtotal,
      vatTotal: calculation.vatTotal,
      shippingTotal: calculation.shippingTotal,
      installationTotal: calculation.installationTotal,
      total: calculation.total,
    },
    legal: { required: [...calculation.requiredLegal].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((d) => ({ slug: d.slug, versionId: d.versionId })) },
  };
}

/** The canonical bytes. Equal semantics always produce byte-identical output. */
export const canonicalContextBytes = (context: CanonicalLegalContext): string => canonicalJson(context);

export const canonicalContextDigest = (context: CanonicalLegalContext): string => digestCanonicalContext(canonicalContextBytes(context));

/** The renderer context for one acceptance-required document, derived from the same canonical context. */
export function buildLegalRenderContext(context: CanonicalLegalContext): OrderLegalContext {
  return {
    ALICI_AD_SOYAD: context.customer.name,
    ALICI_EPOSTA: context.customer.email,
    ALICI_TELEFON: context.customer.phone,
    TESLIMAT_ADRESI: context.customer.address,
    TESLIMAT_YONTEMI: context.delivery.method,
    SIPARIS_NO: context.identity.orderNumber,
    SIPARIS_TARIHI: new Date(context.identity.orderIssuedAt),
    URUN_SATIRLARI: context.lines.map((line) => ({ productName: line.name, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })),
    URUN_TOPLAMI: context.totals.subtotal,
    TOPLAM_TUTAR: context.totals.total,
    KARGO_UCRETI: context.delivery.shippingAmount,
    DIGER_EK_MASRAFLAR: context.delivery.installationAmount,
    FATURA_BILGILERI: context.customer.billing,
  };
}

export type RenderedLegalPreviewDocument = LegalPreviewDocument & { title: string; version: number; renderedBody: string };

/**
 * Render every acceptance-required document and bind each by the SHA-256 of the EXACT plain text produced.
 *
 * `renderOrderLegalDocument` is fail-closed, so an unresolved `{{...}}` throws here rather than shipping a template.
 * KVKK is intentionally absent: it is notice-only and never an acceptance document.
 */
export function renderLegalPreviewDocuments(input: {
  canonical: CanonicalLegalContext;
  documents: readonly { slug: string; title: string; versionId: string; version: number; body: string }[];
}): RenderedLegalPreviewDocument[] {
  const renderContext = buildLegalRenderContext(input.canonical);
  return input.documents.map((doc) => {
    const renderedBody = renderOrderLegalDocument(doc.body, renderContext);
    // Bind the EXACT plain text shown to the customer, so order submission can re-render and compare it byte-for-byte.
    return { slug: doc.slug, title: doc.title, version: doc.version, documentVersionId: doc.versionId, renderedBody, renderedSha256: digestRenderedLegalBody(renderedBody) };
  });
}


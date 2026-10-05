import type { CheckoutAuthorityContext } from "@/lib/checkout-authority";
import { deliveryTraits, type DeliveryClass } from "@/lib/delivery";
import { canonicalJson, digestCanonicalContext, digestRenderedLegalBody, type LegalPreviewDocument } from "@/lib/legal-preview-token";
import { renderOrderLegalDocument, type OrderLegalContext } from "@/lib/legal-template";

export type LegalRenderContextVersion = 1 | 2;

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
  v: LegalRenderContextVersion;
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
  renderContextVersion?: LegalRenderContextVersion;
}): CanonicalLegalContext {
  const { calculation, data, orderNumber, orderIssuedAt } = input;
  const renderContextVersion = input.renderContextVersion ?? 1;
  const lines = renderContextVersion === 2
    ? [...calculation.lines].sort((a, b) => a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0)
    : calculation.lines;
  return {
    v: renderContextVersion,
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
    lines: lines.map((line) => ({
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
  const method = context.delivery.method;
  const deliveryMethod = context.v === 1 ? method : legalDeliveryMethod(method);
  const deliveryAddress = context.v === 1 ? context.customer.address : legalDeliveryAddress(context);
  return {
    ALICI_AD_SOYAD: context.customer.name,
    ALICI_EPOSTA: context.customer.email,
    ALICI_TELEFON: context.customer.phone,
    TESLIMAT_ADRESI: deliveryAddress,
    TESLIMAT_YONTEMI: deliveryMethod,
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

function legalDeliveryMethod(method: string): string {
  switch (method) {
    case "dealer": return "Adrese teslim (Ege Teknik)";
    case "pickup": return "Mağazadan teslim";
    case "shipping": return "Kargo";
    default: throw new Error("Teslimat yöntemi yasal metne çevrilemiyor.");
  }
}

function legalDeliveryAddress(context: CanonicalLegalContext): string {
  if (context.delivery.method === "pickup") return "Mağazadan teslim — teslimat adresi uygulanmaz";
  if (context.delivery.method !== "dealer" && context.delivery.method !== "shipping") {
    throw new Error("Teslimat adresi yasal metne çevrilemiyor.");
  }
  const { address } = context.customer;
  const { district, city } = context.delivery;
  if (!address.trim() || !district.trim() || !city.trim()) throw new Error("Yasal teslimat adresi eksik.");
  return `${address}, ${district} / ${city}`;
}

export type RenderedLegalPreviewDocument = LegalPreviewDocument & {
  title: string;
  version: number;
  templateContentHash: string;
  renderContextVersion: LegalRenderContextVersion;
  renderedBody: string;
};

/**
 * Render every acceptance-required document and bind each by the SHA-256 of the EXACT plain text produced.
 *
 * `renderOrderLegalDocument` is fail-closed, so an unresolved `{{...}}` throws here rather than shipping a template.
 * KVKK is intentionally absent: it is notice-only and never an acceptance document.
 */
export function renderLegalPreviewDocuments(input: {
  canonical: CanonicalLegalContext;
  documents: readonly { slug: string; title: string; versionId: string; version: number; contentHash: string; body: string }[];
}): RenderedLegalPreviewDocument[] {
  const renderContext = buildLegalRenderContext(input.canonical);
  return input.documents.map((doc) => {
    const renderedBody = renderOrderLegalDocument(doc.body, renderContext);
    // Bind the EXACT plain text shown to the customer, so order submission can re-render and compare it byte-for-byte.
    return {
      slug: doc.slug,
      title: doc.title,
      version: doc.version,
      documentVersionId: doc.versionId,
      templateContentHash: doc.contentHash,
      renderContextVersion: input.canonical.v,
      renderedBody,
      renderedSha256: digestRenderedLegalBody(renderedBody),
    };
  });
}


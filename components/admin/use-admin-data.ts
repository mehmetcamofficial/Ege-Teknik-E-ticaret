"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Reads an existing admin GET endpoint. No new APIs were added for Admin Panel V2 - every module
 * reads the same /api/admin/* routes the single-page admin used, with their server-side checks.
 */
export function useAdminJson<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: url !== null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const r = await fetch(url, { cache: "no-store" });
        const json = (await r.json().catch(() => ({}))) as T & { error?: string };
        if (cancelled) return;
        setState(r.ok ? { data: json, error: null, loading: false } : { data: null, error: json.error || "Veriler alınamadı.", loading: false });
      } catch {
        if (!cancelled) setState({ data: null, error: "Sunucuya ulaşılamadı.", loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [url, nonce]);

  return { ...state, reload };
}

/** JSON mutation against an existing admin route; returns the server's own error message when there is one. */
export async function sendAdmin(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: boolean; error?: string; json?: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return r.ok ? { ok: true, json } : { ok: false, error: typeof json.error === "string" ? json.error : "İşlem tamamlanamadı." };
  } catch {
    return { ok: false, error: "Sunucuya ulaşılamadı." };
  }
}

/** Shape of the existing GET /api/admin/overview response (unchanged). */
export type Product = { id: string; name: string; slug: string; category: string; brandId: string | null; categoryId: string | null; series: string; sku: string; capacity: string; energyClass: string; wifi: string; stock: number; price: number; status: string; saleMode: string; description: string; imageUrl: string; updatedAt?: string };
export type ServiceRequest = { id: string; requestNumber: string; type: string; name: string; phone: string; email?: string; city: string; message: string; status: string; createdAt: string };
export type Order = { id: string; orderNumber: string; customerName: string; phone: string; email: string; city: string; address: string; subtotal: number; vatTotal: number; shippingTotal: number; installationTotal: number; total: number; paymentStatus: string; status: string; notes: string; installationPreference: string | null; createdAt: string };
export type SecondHand = { id: string; name: string; slug: string; category: string; condition: string; testNotes: string; warranty: string; price: number; stock: number; imageUrl: string; status: string; description: string };
export type Post = { id: string; title: string; slug: string; excerpt: string; content: string; imageUrl: string; status: string; publishedAt?: string | null; updatedAt?: string };
export type Taxonomy = { id: string; name: string; slug: string; active: boolean };
export type Overview = { products: Product[]; requests: ServiceRequest[]; orders: Order[]; secondHand: SecondHand[]; posts: Post[]; brands: Taxonomy[]; categories: Taxonomy[] };

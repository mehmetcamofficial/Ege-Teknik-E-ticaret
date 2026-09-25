"use client";

import { EmptyState, Notice, PageHeader } from "@/components/admin/ui";
import { useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import ProductForm from "./product-form";

const crumbs = [{ href: "/admin/products", label: "Ürünler" }];

/** Loads brands/categories (and the product, when editing) from the existing overview endpoint. */
export default function ProductEditor({ productId }: { productId?: string }) {
  const { data, error, loading } = useAdminJson<Overview>("/api/admin/overview");
  const product = productId ? data?.products.find((p) => p.id === productId) : undefined;
  const title = productId ? (product ? product.name : "Ürünü düzenle") : "Yeni ürün";

  return (
    <>
      <PageHeader title={title} breadcrumb={crumbs} description={productId ? "Ürün bilgilerini, satış ayarlarını ve görselini güncelleyin." : "Yeni bir ürün kaydı oluşturun. Görsel dosyası, kayıttan sonra eklenebilir."} />
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Notice tone="info">Yükleniyor…</Notice>}
      {data && productId && !product && <EmptyState title="Ürün bulunamadı" description="Ürün silinmiş veya bağlantı hatalı olabilir." />}
      {data && (!productId || product) && <ProductForm key={product?.id ?? "new"} product={product} brands={data.brands} categories={data.categories} />}
    </>
  );
}

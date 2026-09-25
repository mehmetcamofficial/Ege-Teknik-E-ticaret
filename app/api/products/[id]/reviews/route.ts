import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { hashClientIp, idempotencyKey } from "@/lib/request-security";
import { decodeReviewCursor, REVIEW_LIMITS, REVIEW_RATE_LIMITS, reviewListQuerySchema, reviewSubmissionSchema, submissionErrors } from "@/lib/reviews";
import { findPublishedProduct, listApprovedReviews, loadReviewSummary, submitReview } from "@/lib/reviews-db";

type Context = { params: Promise<{ id: string }> };
const noStore = { "cache-control": "no-store" };
const notFound = () => Response.json({ error: "Ürün bulunamadı." }, { status: 404, headers: noStore });
/** One answer for every accepted submission: verified, unverified, duplicate or replay look identical. */
const PENDING = { ok: true, status: "pending", message: "Yorumunuz alındı. Yayınlanmadan önce incelenir." };

/** Public, approved-only reviews + aggregates computed from approved rows. No internal field is selected. */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const product = await findPublishedProduct(id);
  if (!product) return notFound();
  const query = reviewListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400, headers: noStore });
  const cursor = decodeReviewCursor(query.data.cursor);
  if (query.data.cursor && !cursor) return Response.json({ error: "Geçersiz sayfa bağlantısı." }, { status: 400, headers: noStore });
  const [summary, page] = await Promise.all([loadReviewSummary(product.id), listApprovedReviews(product.id, query.data.sort, cursor, query.data.limit)]);
  return Response.json({ summary, reviews: page.reviews, nextCursor: page.nextCursor }, { headers: noStore });
}

async function createReview(request: Request, context: Context) {
  const { id } = await context.params;
  const key = idempotencyKey(request);
  if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400, headers: noStore });
  const product = await findPublishedProduct(id);
  if (!product) return notFound();
  const parsed = reviewSubmissionSchema.safeParse(await readJson(request, REVIEW_LIMITS.maxRequestBytes));
  if (!parsed.success) return Response.json({ error: "Lütfen form alanlarını kontrol edin.", fields: submissionErrors(parsed.error) }, { status: 400, headers: noStore });
  await rateLimit(request, REVIEW_RATE_LIMITS.hourly.scope, REVIEW_RATE_LIMITS.hourly.limit, REVIEW_RATE_LIMITS.hourly.windowMs);
  await rateLimit(request, REVIEW_RATE_LIMITS.daily.scope, REVIEW_RATE_LIMITS.daily.limit, REVIEW_RATE_LIMITS.daily.windowMs);
  await submitReview({ productId: product.id, submission: parsed.data, idempotencyKey: key, ipHash: await hashClientIp(request) });
  return Response.json(PENDING, { status: 202, headers: noStore });
}

export async function POST(request: Request, context: Context) {
  return publicRoute((req) => createReview(req, context))(request);
}

// Temporary Sentry trial configuration for browser-side observability.
// Keep telemetry intentionally minimal; the integration can be removed after the trial.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Browser performance is opt-in twice: explicit configuration and live visitor consent.
  // Diagnostic error capture remains separate; no measurement key enables tracing by itself.
  tracesSampler: () => process.env.NEXT_PUBLIC_SENTRY_PERFORMANCE_ENABLED === "true"
    && typeof document !== "undefined"
    && document.cookie.split(";").some((c) => c.trim() === "ege_analytics_consent=1") ? 0.1 : 0,
  beforeSendTransaction: (event) => process.env.NEXT_PUBLIC_SENTRY_PERFORMANCE_ENABLED === "true" && typeof document !== "undefined"
    && document.cookie.split(";").some((c) => c.trim() === "ege_analytics_consent=1") ? event : null,

  // Do not intentionally attach user information or HTTP request bodies.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

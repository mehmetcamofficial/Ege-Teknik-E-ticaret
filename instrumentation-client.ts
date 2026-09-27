// Temporary Sentry trial configuration for browser-side observability.
// Keep telemetry intentionally minimal; the integration can be removed after the trial.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Sample only a small portion of performance traces in production.
  tracesSampleRate: 0.1,

  // Do not intentionally attach user information or HTTP request bodies.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

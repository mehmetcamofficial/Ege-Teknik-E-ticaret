import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { staticContentSecurityPolicy, staticSecurityHeaders } from "./lib/security-headers";
import { collectStaticScriptHashes } from "./lib/static-script-hashes";
import { legacyGuideRedirects } from "./lib/guide-redirects";

// Nonce-based CSP for Next.js-rendered documents is applied per request in proxy.ts.
const staticCsp = staticContentSecurityPolicy(collectStaticScriptHashes("./public"));

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: staticCsp }, ...staticSecurityHeaders] }];
  },
  async redirects() {
    return [
      // Canonical host: www -> apex. Specific paths first so every www URL
      // lands on the apex in a single hop (no redirect chains).
      {
        source: "/index.html",
        has: [{ type: "host", value: "www.egeteknik.tr" }],
        destination: "https://egeteknik.tr/",
        permanent: true,
      },
      {
        source: "/",
        has: [{ type: "host", value: "www.egeteknik.tr" }],
        destination: "https://egeteknik.tr/",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.egeteknik.tr" }],
        destination: "https://egeteknik.tr/:path*",
        permanent: true,
      },
      // Canonical homepage: /index.html -> / (apex only; www is handled above).
      {
        source: "/index.html",
        destination: "/",
        permanent: true,
      },
      // Old client-rendered guide URLs -> static Klima Rehberi pages.
      ...legacyGuideRedirects(),
    ];
  },
  async rewrites() {
    // Serve the single static storefront file at the clean root URL.
    // beforeFiles: runs before filesystem lookup so it wins over the
    // implicit public/index.html directory-index mapping, and it only
    // fires for the exact path "/" (never for /index.html, so the
    // redirect above cannot loop).
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default withSentryConfig(nextConfig, {
  // Local verification can compile without sending source maps or build telemetry.
  // Deployment behavior is unchanged unless this explicit opt-out is set.
  ...(process.env.LOCAL_BUILD_NO_UPLOAD === "1" ? {
    telemetry: false,
    sourcemaps: { disable: true },
    release: { create: false, finalize: false },
  } : {}),
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "klimacihakkiusta",

  project: "ege-teknik",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

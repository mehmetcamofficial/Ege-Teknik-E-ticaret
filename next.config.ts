import type { NextConfig } from "next";
import { staticContentSecurityPolicy, staticSecurityHeaders } from "./lib/security-headers";
import { collectStaticScriptHashes } from "./lib/static-script-hashes";

// Nonce-based CSP for Next.js-rendered documents is applied per request in proxy.ts.
const staticCsp = staticContentSecurityPolicy(collectStaticScriptHashes("./public"));

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: staticCsp }, ...staticSecurityHeaders] }];
  },
};

export default nextConfig;

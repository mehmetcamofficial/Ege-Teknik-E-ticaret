import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers(){return[{source:"/:path*",headers:[
    {key:"Content-Security-Policy",value:"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; upgrade-insecure-requests"},
    {key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"},
    {key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
    {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=(), usb=()"},{key:"X-Frame-Options",value:"DENY"},
  ]}]},
};

export default nextConfig;

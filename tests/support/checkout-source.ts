import { readFileSync } from "node:fs";

/** The order route: HTTP guards, the order transaction and the writes. */
export const orderRouteSource = () => readFileSync("app/api/orders/route.ts", "utf8");

/**
 * The server-authoritative checkout calculation.
 *
 * P3-LEGAL-3C.3/P1 extracted it from `POST /api/orders` into its own read-and-calculate module so a future
 * pre-acceptance legal preview and order creation cannot disagree. Tests asserting WHAT the server decides
 * (required legal versions, database prices, delivery plan, totals) read it from here.
 */
export const checkoutAuthoritySource = () => readFileSync("lib/checkout-authority.ts", "utf8");

/**
 * Route + authority module: the complete server-side checkout flow. Use for assertions about WHAT the server
 * decides. Do NOT use it for relative-order assertions - concatenating reorders the text, so "X happens before
 * the transaction" must be asserted against each file separately.
 */
export const checkoutFlowSource = () => `${orderRouteSource()}\n${checkoutAuthoritySource()}`;

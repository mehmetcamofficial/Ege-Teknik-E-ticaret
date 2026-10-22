import assert from "node:assert/strict";
import test from "node:test";
import { createOrderIdentity } from "../lib/order-identity.ts";

test("ETS date prefix uses the Europe/Istanbul date of orderIssuedAt", () => {
  const identity = createOrderIdentity(new Date("2026-10-05T21:30:00Z"));
  assert.match(identity.orderNumber, /^ETS-20261006-[0-9A-F]{6}$/);
});

test("ETS date prefix remains on the previous day before Istanbul midnight", () => {
  const identity = createOrderIdentity(new Date("2026-10-05T20:59:59Z"));
  assert.match(identity.orderNumber, /^ETS-20261005-[0-9A-F]{6}$/);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression gate for reconciling draft PR #22 with the current canonical main.
// PR #22 is not a safe merge base: preserve newer security, finance and UX behavior.
const source = (path) => readFile(path, 'utf8');

test('current migration journal retains 0019-0023, not the stale PR #22 journal', async () => {
  const journal = JSON.parse(await source('drizzle-pg/meta/_journal.json'));
  const tags = journal.entries.map((e) => e.tag);
  for (const tag of [
    '0019_scoped_checkout_replay', '0020_legacy_legal_acceptance_immutability',
    '0021_second_hand_inspection', '0022_notification_outbox', '0023_finance_permissions',
  ]) assert.ok(tags.includes(tag), 'missing migration: ' + tag);
  assert.equal(new Set(tags).size, tags.length, 'duplicate migration tag');
});

test('PR #22 must not regress effective RBAC grants or denial audit', async () => {
  const auth = await source('lib/admin-auth.ts');
  assert.match(auth, /effectivePermissions/);
  assert.match(auth, /auditPermissionDenied/);
  assert.match(auth, /adminPermissions/);
});

test('finance and orders retain accessible retry states introduced after PR #22', async () => {
  for (const file of ['app/admin/(panel)/finance/finance-view.tsx', 'app/admin/(panel)/orders/orders-view.tsx']) {
    const s = await source(file);
    assert.match(s, /DataError/);
    assert.match(s, /onRetry=\{reload\}/);
  }
});

test('AI advice must use budget gate and topic-only outbound data', async () => {
  const gateway = await source('lib/ai/profitability-gateway.ts');
  const route = await source('app/api/admin/finance/profitability/ai/route.ts');
  assert.match(gateway, /gatewayDecision/);
  assert.match(gateway, /if\(!budget\)throw new Error\('AI_DISABLED'\)/);
  assert.match(gateway, /topic,allowedFocus/);
  assert.match(route, /aiBudget/);
  assert.match(route, /generateProfitAdvice\(config, parsed\.data\.question, fetch, aiBudget\)/);
});

test('profitability UI retains timeout and privacy disclosures', async () => {
  const s = await source('app/admin/(panel)/finance/profitability/profitability-calculator.tsx');
  assert.match(s, /AbortSignal\.timeout\(15000\)/);
  assert.match(s, /finans kayıtları gönderilmez/);
  assert.match(s, /Kişisel bilgi yazmayın/);
});

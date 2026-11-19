import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the real page action handlers without a browser or payment services.
// These tests do not render the JSX or replace a browser/build check.
const source = await readFile(
  process.env.FRONTEND_PLAN_FILE || new URL('../src/pages/Plan.jsx', import.meta.url),
  'utf8',
);

function handler(name, globals) {
  const start = source.indexOf(`  async function ${name}(`);
  const endMarker = name === 'startCheckout'
    ? '  async function discardCheckout('
    : '  const refresh =';
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `Page handler ${name} is present`);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, globals);
}

function context(overrides = {}) {
  const calls = [];
  const state = { error: null, status: null, busy: false, revision: 0 };
  const globals = {
    action: { current: false }, checkout: null,
    api: {
      post: async (...args) => { calls.push(['post', ...args]); return { data: {} }; },
      get: async (...args) => { calls.push(['get', ...args]); return { data: {} }; },
    },
    navigate: (...args) => calls.push(['navigate', ...args]),
    setBusy: value => { state.busy = value; },
    setError: value => { state.error = value; },
    setState: value => { state.status = value; },
    setRevision: fn => { state.revision = fn(state.revision); },
    URL, window: { location: { assign: url => calls.push(['redirect', url]) } },
    ...overrides,
  };
  return { globals, calls, state };
}

test('discard an owned pending attempt even when Stripe session ID is missing', async () => {
  const c = context({ checkout: { id: null, attemptId: 'attempt-current' } });
  await handler('discardCheckout', c.globals)();
  assert.equal(c.calls[0]?.[1], '/checkout/attempts/attempt-current/cancel');
  assert.equal(c.state.revision, 1);
  assert.equal(c.globals.action.current, false);
  assert.equal(c.state.busy, false);
});

test('keep cancellation compatible with a stored session from an older API', async () => {
  const c = context({ checkout: { id: 'cs_legacy' } });
  await handler('discardCheckout', c.globals)();
  assert.equal(c.calls[0]?.[1], '/checkout/sessions/cs_legacy/cancel');
});

test('do not issue cancellation without an attempt or session identifier', async () => {
  const c = context({ checkout: { id: null } });
  await handler('discardCheckout', c.globals)();
  assert.equal(c.calls.length, 0);
});

test('a payment already processing without session ID uses the clean status route', async () => {
  const c = context({ checkout: { id: null, attemptId: 'attempt-current' } });
  c.globals.api.post = async () => { throw { code: 'PAYMENT_PROCESSING' }; };
  await handler('discardCheckout', c.globals)();
  const route = c.calls.find(call => call[0] === 'navigate')?.[1];
  assert.equal(route, '/plan?checkout=success');
  assert.equal(c.state.revision, 1);
});

test('a lost create response reloads the reserved attempt and preserves the error', async () => {
  const c = context();
  const original = { code: 'CHECKOUT_UNAVAILABLE' };
  const status = { subscription: null, checkout: { id: null, attemptId: 'attempt-current' } };
  c.globals.api.post = async () => { throw original; };
  c.globals.api.get = async path => { c.calls.push(['get', path]); return { data: status }; };
  await handler('startCheckout', c.globals)('all', 'monthly');
  assert.equal(c.calls[0]?.[1], '/billing/status');
  assert.equal(c.state.status, status);
  assert.equal(c.state.error, original);
  assert.equal(c.globals.action.current, false);
});

test('failed status refresh keeps the original error and releases the action guard', async () => {
  const c = context();
  const original = { code: 'CHECKOUT_UNAVAILABLE' };
  c.globals.api.post = async () => { throw original; };
  c.globals.api.get = async () => { throw new Error('temporary status failure'); };
  await handler('startCheckout', c.globals)('all', 'monthly');
  assert.equal(c.state.error, original);
  assert.equal(c.globals.action.current, false);
  assert.equal(c.state.busy, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Ejecuta los callbacks reales de AuthProvider con hooks controlados.
// No renderiza JSX ni sustituye una comprobación visual del navegador.
const source = await readFile(new URL('../src/auth/AuthContext.jsx', import.meta.url), 'utf8');
const start = source.indexOf('export function AuthProvider(');
const end = source.indexOf('  return (\n    <Ctx.Provider', start);
assert.ok(start >= 0 && end > start);
const provider = source.slice(start, end).replace('export function ', 'function ')
  + '\nreturn { logout, loadMe, afterAuth, login, register, refreshUser };\n}';
const pending = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

function context(overrides = {}) {
  const state = [{ id: 'previous-user' }, 'es', false, true];
  let slot = 0, version = 0;
  const calls = [];
  const globals = {
    useState: value => {
      const index = slot++;
      return [state[index] ?? value, next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useCallback: callback => callback,
    useEffect: () => {},
    localStorage: { getItem: () => null },
    makeL: () => value => value,
    setAuthFailHandler: () => {},
    getSessionVersion: () => version,
    clearTokens: () => { version++; calls.push('clear'); },
    restoreSession: async () => true,
    logoutSession: async () => { version++; },
    api: { get: async path => {
      calls.push(path);
      return { data: path.endsWith('/settings') ? { selectedTests: ['m1'] } : { id: 'current-user' } };
    } },
    ...overrides,
  };
  const handlers = vm.runInNewContext(`(${provider})({})`, globals);
  return { state, calls, handlers, advance: () => version++, globals };
}

test('logout errors propagate without claiming success or removing its visible retry action', async () => {
  const failure = Object.assign(new Error('unconfirmed'), { code: 'LOGOUT_UNCONFIRMED' });
  const c = context({ logoutSession: async () => { throw failure; } });
  await assert.rejects(c.handlers.logout(), failure);
  assert.equal(c.state[0].id, 'previous-user');
});

test('a confirmed logout clears the user state', async () => {
  const c = context();
  await c.handlers.logout();
  assert.equal(c.state[0], null);
});

test('reload without a cookie session finishes loading without fetching protected data', async () => {
  const c = context({ restoreSession: async () => false });
  await c.handlers.loadMe();
  assert.equal(c.state[3], false);
  assert.deepEqual(c.calls, []);
});

test('a delayed bootstrap cannot restore the previous user after a session change', async () => {
  const gate = pending();
  const c = context({ api: { get: async () => gate.promise } });
  const loading = c.handlers.loadMe();
  await Promise.resolve();
  c.advance();
  c.state[0] = null;
  gate.resolve({ data: { id: 'stale-user' } });
  await loading;
  assert.equal(c.state[0], null);
});

test('afterAuth rejects settings from a login superseded by another session', async () => {
  const gate = pending();
  const calls = [];
  const c = context({ api: { get: async path => { calls.push(path); return gate.promise; } } });
  const auth = c.handlers.afterAuth({ user: { id: 'old-login' } }, 0);
  const rejected = assert.rejects(auth, { code: 'SESSION_CHANGED' });
  c.advance();
  c.state[0] = null;
  gate.resolve({ data: { selectedTests: ['m1'], locale: 'en' } });
  await rejected;
  assert.equal(c.state[0], null);
  assert.equal(c.state[1], 'es');
  assert.deepEqual(calls, ['/me/settings']);
});

test('refreshUser discards a late account response after logout', async () => {
  const gate = pending();
  const c = context({ api: { get: async () => gate.promise } });
  const refreshing = c.handlers.refreshUser();
  c.advance();
  c.state[0] = null;
  gate.resolve({ data: { id: 'stale-user' } });
  await refreshing;
  assert.equal(c.state[0], null);
});

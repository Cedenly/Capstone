import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Ejecuta el módulo real con transporte y APIs del navegador controlados.
// No sustituye la comprobación de cookies en un navegador real.
const source = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');
let sequence = 0;
const reply = (status, data) => new Response(
  status === 204 ? null : JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } }
);
const success = token => reply(200, { data: { accessToken: token, expiresIn: 900 } });
const error = (status, code) => reply(status, { error: { code, message: code } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fresh(fetcher, { browser = false, locks, values = new Map() } = {}) {
  const storage = [];
  globalThis.localStorage = {
    removeItem: key => { storage.push(['remove', key]); values.delete(key); },
    getItem: key => { storage.push(['read', key]); return values.get(key) ?? null; },
    setItem: (key, value) => { storage.push(['write', key, value]); values.set(key, value); },
  };
  globalThis.fetch = fetcher;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  if (browser) globalThis.window = {};
  else delete globalThis.window;
  const module = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// test ${++sequence}`).toString('base64')}`);
  return { module, storage, values };
}

async function loggedIn(fetcher) {
  const state = await fresh(async (url, options) => url.endsWith('/auth/login')
    ? success('access-before') : fetcher(url, options));
  await state.module.authenticate('/auth/login', { email: 'local@example.test', password: 'synthetic' });
  return state;
}

test('legacy localStorage tokens are removed without reading or migrating them', async () => {
  const { module, storage } = await fresh(() => assert.fail('No network expected'));
  assert.equal(storage[0][0], 'remove');
  assert.equal(storage[0][1], 'aprueba_tokens');
  assert.ok(storage.every(([operation, key]) => operation === 'remove' || key === 'aprueba-logout-pending:/api/v1'));
  assert.equal(storage.some(([operation]) => operation === 'write'), false);
  assert.equal(module.hasSession(), false);
});

test('login uses credentials and memory only; protected calls use the returned bearer', async () => {
  const calls = [];
  const { module, storage } = await fresh(async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/auth/login') ? success('access-current') : reply(200, { data: { id: 'user-local' } });
  });
  await module.api.post('/auth/login', { email: 'local@example.test', password: 'synthetic' });
  await module.api.get('/me');
  assert.equal(module.hasSession(), true);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access-current');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(storage[0][0], 'remove');
  assert.equal(storage[0][1], 'aprueba_tokens');
  assert.ok(storage.every(([operation, key]) => operation === 'remove' || key === 'aprueba-logout-pending:/api/v1'));
  assert.equal(storage.some(([operation]) => operation === 'write'), false);
});

test('reload bootstraps through the cookie and concurrent bootstraps share one refresh', async () => {
  const gate = deferred(); let refreshes = 0;
  const { module } = await fresh(async (url, options) => {
    assert.ok(url.endsWith('/auth/refresh'));
    assert.deepEqual(JSON.parse(options.body), {});
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers.Authorization, undefined);
    refreshes++;
    await gate.promise;
    return success('restored-access');
  });
  const first = module.restoreSession();
  const second = module.restoreSession();
  await tick();
  assert.equal(refreshes, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(module.hasSession(), true);
});

test('many expired resource calls share one refresh and retry with the new bearer', async () => {
  let refreshes = 0, requests = 0;
  const { module } = await loggedIn(async (url, options) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; await tick(); return success('access-after'); }
    requests++;
    return options.headers.Authorization === 'Bearer access-after'
      ? reply(200, { data: { ok: true } }) : error(401, 'AUTH_INVALID');
  });
  const results = await Promise.all(Array.from({ length: 6 }, () => module.api.get('/billing/status')));
  assert.equal(refreshes, 1);
  assert.equal(requests, 12);
  assert.ok(results.every(item => item.data.ok));
});

test('a late old 401 reuses the new access token without rotating again', async () => {
  const late = deferred(); let refreshes = 0, oldCalls = 0;
  const { module } = await loggedIn(async (url, options) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return success('access-after'); }
    if (options.headers.Authorization === 'Bearer access-after') return reply(200, { data: {} });
    oldCalls++;
    if (oldCalls === 2) await late.promise;
    return error(401, 'AUTH_INVALID');
  });
  const first = module.api.get('/me');
  const second = module.api.get('/billing/status');
  await first;
  late.resolve();
  await second;
  assert.equal(refreshes, 1);
});

test('an invalid refresh ends the local session and does not loop', async () => {
  let calls = 0, invalidations = 0;
  const { module } = await fresh(async () => { calls++; return error(401, 'REFRESH_INVALID'); });
  module.setAuthFailHandler(() => invalidations++);
  assert.equal(await module.restoreSession(), false);
  assert.equal(await module.restoreSession(), false);
  assert.equal(calls, 1);
  assert.equal(invalidations, 1);
});

test('a suspended account clears the local session and blocks automatic renewal', async () => {
  let calls = 0;
  const { module } = await loggedIn(async () => { calls++; return error(403, 'ACCOUNT_SUSPENDED'); });
  await assert.rejects(module.api.get('/billing/status'), { code: 'ACCOUNT_SUSPENDED' });
  assert.equal(module.hasSession(), false);
  assert.equal(await module.restoreSession(), false);
  assert.equal(calls, 1);
});

test('a transient refresh error preserves local state for a later retry', async () => {
  let refreshes = 0;
  const { module } = await loggedIn(async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes++;
      return refreshes === 1 ? error(503, 'TEMPORARY_UNAVAILABLE') : success('access-after');
    }
    return options.headers.Authorization === 'Bearer access-after'
      ? reply(200, { data: {} }) : error(401, 'AUTH_INVALID');
  });
  await assert.rejects(module.api.get('/me'), { code: 'TEMPORARY_UNAVAILABLE' });
  assert.equal(module.hasSession(), true);
  await module.api.get('/me');
  assert.equal(refreshes, 2);
});

test('a concurrent rotation is retried once using the browser cookie', async () => {
  let refreshes = 0;
  const { module } = await fresh(async (_url, options) => {
    assert.equal(options.body, '{}');
    refreshes++;
    return refreshes === 1 ? error(409, 'REFRESH_CONCURRENT') : success('access-after');
  });
  assert.equal(await module.restoreSession(), true);
  assert.equal(refreshes, 2);
});

test('repeated concurrent errors stop after the bounded retry', async () => {
  let refreshes = 0;
  const { module } = await fresh(async () => { refreshes++; return error(409, 'REFRESH_CONCURRENT'); });
  await assert.rejects(module.restoreSession(), { code: 'REFRESH_CONCURRENT' });
  assert.equal(refreshes, 2);
  assert.equal(module.hasSession(), false);
});

test('logout is cookie-based and works even when no access token remains', async () => {
  const { module } = await fresh(async (url, options) => {
    assert.ok(url.endsWith('/auth/logout'));
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.body, '{}');
    return reply(204);
  });
  await module.logoutSession();
  assert.equal(module.hasSession(), false);
  assert.equal(await module.restoreSession(), false);
});

test('logout waits for an in-flight refresh, then revokes its cookie without restoring access', async () => {
  const gate = deferred(), calls = [];
  const { module } = await fresh(async url => {
    calls.push(url.split('/').at(-1));
    if (url.endsWith('/auth/refresh')) { await gate.promise; return success('late-access'); }
    return reply(204);
  });
  const restoring = module.restoreSession();
  await tick();
  const logout = module.logoutSession();
  await tick();
  assert.deepEqual(calls, ['refresh']);
  gate.resolve();
  assert.equal(await restoring, false);
  await logout;
  assert.deepEqual(calls, ['refresh', 'logout']);
  assert.equal(module.hasSession(), false);
});

test('logout waits for an in-flight login and discards its response', async () => {
  const gate = deferred(), calls = [];
  const { module } = await fresh(async url => {
    calls.push(url.split('/').at(-1));
    if (url.endsWith('/auth/login')) { await gate.promise; return success('late-login'); }
    return reply(204);
  });
  const login = module.authenticate('/auth/login', {});
  const rejected = assert.rejects(login, { code: 'SESSION_CHANGED' });
  await tick();
  const logout = module.logoutSession();
  gate.resolve();
  await rejected;
  await logout;
  assert.deepEqual(calls, ['login', 'logout']);
  assert.equal(module.hasSession(), false);
});

test('a late protected response cannot be consumed after logout', async () => {
  const gate = deferred();
  const { module } = await loggedIn(async url => {
    if (url.endsWith('/auth/logout')) return reply(204);
    await gate.promise;
    return reply(200, { data: { id: 'old-user' } });
  });
  const me = module.api.get('/me');
  const rejected = assert.rejects(me, { code: 'SESSION_CHANGED' });
  await module.logoutSession();
  gate.resolve();
  await rejected;
});

test('logout failure remains explicit and automatic renewal stays blocked', async () => {
  let calls = 0;
  const { module } = await loggedIn(async () => { calls++; throw new TypeError('offline'); });
  await assert.rejects(module.logoutSession(), { code: 'LOGOUT_UNCONFIRMED' });
  assert.equal(module.hasSession(), false);
  assert.equal(await module.restoreSession(), false);
  assert.equal(calls, 1);
  await assert.rejects(module.api.get('/me'), { code: 'SESSION_CHANGED' });
  assert.equal(calls, 1);
});

test('an explicit login may recover after an unconfirmed logout', async () => {
  const { module } = await loggedIn(async () => { throw new TypeError('offline'); });
  await assert.rejects(module.logoutSession(), { code: 'LOGOUT_UNCONFIRMED' });
  await module.authenticate('/auth/login', {});
  assert.equal(module.hasSession(), true);
});

test('Web Locks serialize cookie refreshes from two independent client instances', async () => {
  let tail = Promise.resolve(), active = 0, maximum = 0;
  const locks = { request: (_name, callback) => {
    const run = tail.then(callback);
    tail = run.catch(() => {});
    return run;
  } };
  const fetcher = async () => {
    active++; maximum = Math.max(maximum, active);
    await tick(); active--;
    return success('lock-access');
  };
  const a = await fresh(fetcher, { locks });
  const b = await fresh(fetcher, { locks });
  await Promise.all([a.module.restoreSession(), b.module.restoreSession()]);
  assert.equal(maximum, 1);
  assert.equal(a.module.hasSession(), true);
  assert.equal(b.module.hasSession(), true);
});

test('cross-tab invalidation carries no token and prevents stale automatic renewal', async () => {
  const channels = [], messages = [];
  const OriginalChannel = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; channels.push(this); }
    postMessage(data) {
      messages.push(data);
      for (const other of channels) if (other !== this && other.name === this.name) {
        other.onmessage?.({ data });
      }
    }
  };
  try {
    const fetcher = async url => url.endsWith('/auth/logout') ? reply(204) : success('tab-access');
    const a = await fresh(fetcher, { browser: true });
    const b = await fresh(fetcher, { browser: true });
    await Promise.all([a.module.restoreSession(), b.module.restoreSession()]);
    let invalidations = 0;
    b.module.setAuthFailHandler(() => invalidations++);
    await a.module.logoutSession();
    assert.equal(b.module.hasSession(), false);
    assert.equal(await b.module.restoreSession(), false);
    assert.equal(invalidations, 1);
    assert.deepEqual(messages, [{ type: 'session-changed' }]);
  } finally {
    globalThis.BroadcastChannel = OriginalChannel;
    delete globalThis.window;
  }
});

test('a malformed successful refresh never installs a session', async () => {
  const { module } = await fresh(async () => reply(200, { data: { expiresIn: 900 } }));
  await assert.rejects(module.restoreSession(), { code: 'INVALID_SESSION_RESPONSE' });
  assert.equal(module.hasSession(), false);
});

test('a resource that still rejects the refreshed token is tried only once more', async () => {
  let resources = 0, refreshes = 0;
  const { module } = await loggedIn(async url => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return success('access-after'); }
    resources++; return error(401, 'AUTH_INVALID');
  });
  await assert.rejects(module.api.get('/billing/status'), { code: 'AUTH_INVALID' });
  assert.equal(resources, 2);
  assert.equal(refreshes, 1);
  assert.equal(module.hasSession(), false);
});


test('an unconfirmed logout survives reload as a nonsecret block until explicit login', async () => {
  const values = new Map();
  const a = await fresh(async url => {
    if (url.endsWith('/auth/login')) return success('first-access');
    throw new TypeError('offline');
  }, { values });
  await a.module.authenticate('/auth/login', {});
  await assert.rejects(a.module.logoutSession(), { code: 'LOGOUT_UNCONFIRMED' });
  assert.deepEqual([...values.entries()], [['aprueba-logout-pending:/api/v1', '1']]);
  let calls = 0;
  const b = await fresh(async url => {
    calls++;
    assert.ok(url.endsWith('/auth/login'));
    return success('new-access');
  }, { values });
  assert.equal(await b.module.restoreSession(), false);
  assert.equal(calls, 0);
  await b.module.authenticate('/auth/login', {});
  assert.equal(b.module.hasSession(), true);
  assert.equal(values.size, 0);
});

test('confirmed logout removes its nonsecret pending marker', async () => {
  const values = new Map();
  const { module } = await fresh(async () => reply(204), { values });
  await module.logoutSession();
  assert.equal(values.size, 0);
});


test('logout passes the captured access bearer for revocation if the cookie is missing', async () => {
  let attempts = 0;
  const { module } = await loggedIn(async (url, options) => {
    assert.ok(url.endsWith('/auth/logout'));
    assert.equal(options.headers.Authorization, 'Bearer access-before');
    assert.equal(options.credentials, 'include');
    attempts++;
    if (attempts === 1) throw new TypeError('offline');
    return reply(204);
  });
  await assert.rejects(module.logoutSession(), { code: 'LOGOUT_UNCONFIRMED' });
  assert.equal(module.hasSession(), false);
  await module.logoutSession();
  assert.equal(attempts, 2);
});

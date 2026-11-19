import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as crypto from 'node:crypto';

export const HOUR = 3600_000;
const clone = value => value === undefined ? undefined : structuredClone(value);
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

/** Offline route harness. No SDKs, credentials, HTTP or production services. */
export async function harness(backendRoot) {
  const h = {
    now: Date.parse('2026-11-10T12:00:00Z'),
    docs: new Map(), sessions: new Map(), keys: new Map(),
    calls: { create: [], retrieve: [], list: [], expire: [] },
    hooks: {}, logs: [], txTail: Promise.resolve(),
    faults: { createBefore: 0, createAfter: 0, associationWrite: 0, list: 0, cachedCreate500: 0 },
  };
  h.put = (collection, id, value) => h.docs.set(`${collection}/${id}`, clone(value));
  h.get = (collection, id) => clone(h.docs.get(`${collection}/${id}`));
  h.pointer = (user = 'alice') => h.get('checkoutAttempts', user);
  h.advance = ms => { h.now += ms; };
  h.put('users', 'alice', { email: 'alice@example.invalid', state: 'active', plan: 'free' });
  h.put('users', 'bob', { email: 'bob@example.invalid', state: 'active', plan: 'free' });
  h.put('plans', 'uni', { active: true, price: 1 });
  h.put('plans', 'all', { active: true, price: 5 });
  h.put('tests', 'ciencias', { active: true, published: true, label: 'Ciencias' });
  h.put('questions', 'ciencias-q1', { testId: 'ciencias', published: true });

  const snapshot = (key, value) => ({ id: key.split('/').at(-1), exists: value !== undefined, data: () => clone(value) });
  const read = ref => {
    if (ref.key) return snapshot(ref.key, h.docs.get(ref.key));
    const docs = [...h.docs].filter(([key, value]) => key.startsWith(`${ref.name}/`) && ref.filters.every(([field, op, expected]) => {
      if (op === '==') return value[field] === expected;
      if (op === 'in') return expected.includes(value[field]);
      throw new Error(`Unsupported Firestore operator ${op}`);
    })).slice(0, ref.cap ?? Infinity).map(([key, value]) => snapshot(key, value));
    return { docs, empty: docs.length === 0, size: docs.length };
  };
  const query = (name, filters = [], cap) => ({
    name, filters, cap,
    where: (field, op, expected) => query(name, [...filters, [field, op, expected]], cap),
    limit: max => query(name, filters, max),
    get: async () => { const ref = query(name, filters, cap); await h.hooks.beforeRead?.(ref); return read(ref); },
    doc: id => {
      if (typeof id !== 'string' || !id) throw new Error('Invalid document id');
      const ref = { key: `${name}/${id}`, id, get: async () => { await h.hooks.beforeRead?.(ref); return read(ref); } };
      ref.set = async (value, options) => h.db.runTransaction(tx => tx.set(ref, value, options));
      return ref;
    },
  });
  h.db = {
    collection: name => query(name),
    runTransaction: async callback => {
      const previous = h.txTail;
      const released = deferred();
      h.txTail = released.promise;
      await previous;
      const writes = [];
      const tx = {
        get: async ref => {
          if (writes.length) throw new Error('Firestore transactions require all reads before writes');
          await h.hooks.beforeRead?.(ref); return read(ref);
        },
        set: (ref, value, options) => { writes.push({ ref, value: clone(value), merge: options?.merge }); return tx; },
        update: (ref, value) => { writes.push({ ref, value: clone(value), merge: true }); return tx; },
        delete: ref => { writes.push({ ref, remove: true }); return tx; },
      };
      try {
        const result = await callback(tx);
        if (h.faults.associationWrite && writes.some(w => w.ref.key.startsWith('checkoutAttempts/') && w.value?.sessionId)) {
          h.faults.associationWrite--;
          throw Object.assign(new Error('Injected Firestore association failure'), { code: 'UNAVAILABLE' });
        }
        await h.hooks.beforeCommit?.(writes);
        for (const w of writes) {
          if (w.remove) h.docs.delete(w.ref.key);
          else h.docs.set(w.ref.key, w.merge ? { ...h.docs.get(w.ref.key), ...w.value } : w.value);
        }
        return result;
      } finally { released.resolve(); }
    },
  };

  h.makeSession = (attempt, overrides = {}) => {
    const id = `cs_test_${h.sessions.size + 1}`;
    const value = {
      id, livemode: false, mode: 'subscription', status: 'open', payment_status: 'unpaid',
      client_reference_id: attempt.userId, metadata: clone(attempt.params?.metadata || {
        integration: 'aprueba_mvp', userId: attempt.userId, attemptId: attempt.attemptId,
        plan: attempt.plan, billingCycle: attempt.billingCycle,
      }),
      customer: attempt.params?.customer || null,
      url: `https://checkout.example.invalid/${id}`,
      created: Math.floor(h.now / 1000), expires_at: attempt.params?.expires_at || Math.floor(h.now / 1000) + 24 * 3600,
      ...overrides,
    };
    h.sessions.set(value.id, clone(value));
    return clone(value);
  };
  h.stripe = {
    prices: { retrieve: async id => {
      const [, plan, cycle] = id.split('_');
      return { active: true, livemode: false, currency: 'usd', product: `prod_aprueba_${plan}`,
        unit_amount: (plan === 'uni' ? 100 : 500) * (cycle === 'yearly' ? 10 : 1),
        type: 'recurring', billing_scheme: 'per_unit',
        recurring: { interval: cycle === 'yearly' ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' } };
    } },
    checkout: { sessions: {
      create: async (params, options) => {
        h.calls.create.push({ params: clone(params), options: clone(options) });
        await h.hooks.beforeCreate?.(params, options);
        if (h.faults.createBefore) { h.faults.createBefore--; throw new Error('Injected network failure before Stripe creation'); }
        const key = options?.idempotencyKey;
        let session;
        const cached = h.keys.get(key);
        if (cached && h.now - cached.time >= 24 * HOUR) h.keys.delete(key);
        if (h.keys.has(key) && JSON.stringify(h.keys.get(key).params) !== JSON.stringify(params)) {
          throw Object.assign(new Error('The same idempotency key was reused with different parameters'), { code: 'idempotency_error', statusCode: 400 });
        }
        if (h.keys.get(key)?.error) throw Object.assign(new Error('Cached Stripe 500 for the same idempotency key'), { statusCode: 500 });
        if (!h.keys.has(key) && params.expires_at !== undefined &&
          (params.expires_at < Math.floor(h.now / 1000) + 30 * 60 || params.expires_at > Math.floor(h.now / 1000) + 24 * 3600)) {
          throw Object.assign(new Error('expires_at must be 30 minutes to 24 hours from new creation'), { code: 'parameter_invalid_integer', statusCode: 400 });
        }
        if (h.faults.cachedCreate500) {
          h.faults.cachedCreate500--;
          h.keys.set(key, { time: h.now, error: true, params: clone(params) });
          throw Object.assign(new Error('Injected Stripe 500 cached by idempotency key'), { statusCode: 500 });
        }
        if (h.keys.has(key)) session = h.sessions.get(h.keys.get(key).id);
        else {
          session = h.makeSession({ userId: params.client_reference_id, params });
          h.keys.set(key, { id: session.id, time: h.now, params: clone(params) });
        }
        await h.hooks.afterCreate?.(session);
        if (h.faults.createAfter) { h.faults.createAfter--; throw new Error('Injected timeout after Stripe creation'); }
        return clone(session);
      },
      retrieve: async id => {
        h.calls.retrieve.push(id);
        await h.hooks.beforeRetrieve?.(id);
        if (!h.sessions.has(id)) throw Object.assign(new Error('Session absent'), { code: 'resource_missing' });
        h.expireByClock(h.sessions.get(id));
        return clone(h.sessions.get(id));
      },
      list: async (params = {}) => {
        h.calls.list.push(clone(params));
        await h.hooks.beforeList?.(params);
        if (h.faults.list) { h.faults.list--; throw new Error('Injected incomplete Stripe listing'); }
        if (h.hooks.listResult) return h.hooks.listResult(params);
        for (const session of h.sessions.values()) h.expireByClock(session);
        let data = [...h.sessions.values()].filter(s =>
          (!params.customer || s.customer === params.customer) &&
          (!params.created?.gte || s.created >= params.created.gte) &&
          (!params.created?.lte || s.created <= params.created.lte));
        if (params.starting_after) data = data.slice(data.findIndex(s => s.id === params.starting_after) + 1);
        const limit = params.limit || 10;
        return { object: 'list', data: clone(data.slice(0, limit)), has_more: data.length > limit };
      },
      expire: async id => {
        h.calls.expire.push(id);
        await h.hooks.beforeExpire?.(id);
        const session = h.sessions.get(id);
        if (!session || session.status !== 'open') throw new Error('Checkout is no longer open');
        session.status = 'expired'; session.url = null;
        await h.hooks.afterExpire?.(id);
        return clone(session);
      },
    } },
  };
  h.expireByClock = session => {
    if (session.status === 'open' && session.expires_at <= Math.floor(h.now / 1000)) {
      session.status = 'expired'; session.url = null;
    }
  };

  const routers = [];
  const Router = () => {
    const routes = []; routers.push(routes);
    return { get: (route, ...handlers) => routes.push({ method: 'GET', route, handlers }),
      post: (route, ...handlers) => routes.push({ method: 'POST', route, handlers }) };
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [h.now])); }
    static now() { return h.now; }
  }
  const context = vm.createContext({ Date: ClockDate, console: { error: (...args) => h.logs.push(args), log() {}, warn() {} },
    process: { env: { DATA_DRIVER: 'firestore' } }, structuredClone, setTimeout, clearTimeout, URL, Buffer });
  const mocks = {
    express: { Router },
    'node:crypto': crypto, crypto,
    '/config/firebase.js': { initFirestore: async () => ({ db: h.db }) },
    '/config/stripe.js': { getStripe: () => h.stripe,
      getStripePriceId: (plan, cycle) => `price_${plan}_${cycle}`,
      getStripeWebhookSecret: () => 'whsec_test_double_only', getStudentWebUrl: () => 'https://student.example.invalid' },
    '/middleware/auth.js': { authRequired: (_req, _res, next) => next() },
    '/data/repo.js': { COL: { questions: 'questions' },
      queryEqual: () => { throw new Error('Unexpected memory-driver query in Firestore harness'); } },
    '/lib/entitlements.js': { effectivePlan: user => user.plan || 'free' },
  };
  const cache = new Map();
  const load = async (specifier, parent) => {
    const file = specifier.startsWith('.') ? path.resolve(path.dirname(parent), specifier) : specifier;
    const mockKey = Object.keys(mocks).find(key => key === file || (key.startsWith('/') && file.endsWith(key)));
    const key = mockKey || file;
    if (cache.has(key)) return cache.get(key);
    let module;
    if (mockKey) {
      const values = mocks[mockKey];
      module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [name, value] of Object.entries(values)) this.setExport(name, value);
      }, { context, identifier: key });
    } else {
      if (!path.isAbsolute(file) || !file.startsWith(path.resolve(backendRoot) + path.sep)) throw new Error(`Unmocked dependency: ${file}`);
      module = new vm.SourceTextModule(await readFile(file, 'utf8'), { context, identifier: file });
    }
    cache.set(key, module);
    await module.link((child, referencing) => load(child, referencing.identifier));
    return module;
  };
  for (const file of ['checkout.js', 'checkoutStatus.js']) {
    const module = await load(path.resolve(backendRoot, 'src/routes', file));
    await module.evaluate();
  }
  h.request = async (method, url, { user = 'alice', body = {}, query: queryParams = {} } = {}) => {
    const entry = routers.flat().map(route => {
      const names = [];
      const regex = new RegExp('^' + route.route.replace(/:([^/]+)/g, (_match, name) => { names.push(name); return '([^/]+)'; }) + '$');
      const match = regex.exec(url);
      return route.method === method && match ? { ...route, params: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) } : null;
    }).find(Boolean);
    if (!entry) return { status: 404, body: { error: { code: 'ROUTE_NOT_FOUND' } } };
    const result = { status: 200, headers: {}, body: undefined };
    const req = { user: { id: user }, body, query: queryParams, params: entry.params, method, path: url };
    const res = { status: status => { result.status = status; return res; },
      json: value => { result.body = clone(value); return res; },
      set: (name, value) => { result.headers[name] = value; return res; }, end: () => res };
    const error = err => { result.status = err.status || 500; result.body = { data: null, error: { code: err.code || 'INTERNAL', message: err.message } }; };
    try { await entry.handlers.at(-1)(req, res, error); } catch (err) { error(err); }
    return result;
  };
  h.checkout = (body = { plan: 'uni', billingCycle: 'monthly', testId: 'ciencias' }, options = {}) => h.request('POST', '/checkout/sessions', { ...options, body });
  h.status = (options = {}) => h.request('GET', '/billing/status', options);
  h.cancel = (attemptId = h.pointer()?.attemptId, options = {}) => h.request('POST', `/checkout/attempts/${attemptId}/cancel`, options);
  return h;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { harness, HOUR, deferred } from './checkout-harness.mjs';

const backend = fileURLToPath(new URL('../', import.meta.url));
const otherPlan = { plan: 'all', billingCycle: 'monthly' };
const openCount = h => [...h.sessions.values()].filter(s => s.status === 'open').length;
const noNewSession = (h, count) => assert.equal(h.sessions.size, count, 'no new chargeable session may be created');
const rejected = r => {
  assert.notEqual(r.body?.error?.code, 'ROUTE_NOT_FOUND', 'the requested route must exist');
  assert.ok(r.status >= 400, `expected rejection, received ${r.status}: ${JSON.stringify(r.body)}`);
};
const orphanAfterCreate = h => {
  h.faults.createAfter = 1;
  h.hooks.afterCreate = async () => {
    h.hooks.afterCreate = undefined;
    h.faults.list = 1; // Provider response and immediate reconciliation are both unavailable.
  };
};

for (const fault of ['createBefore', 'createAfter', 'associationWrite']) {
  test(`recovery: ${fault} can resume the same attempt with at most one session`, async () => {
    const h = await harness(backend);
    h.faults[fault] = 1;
    const first = await h.checkout();
    if (fault === 'createAfter') assert.ok(first.status === 201 || first.status >= 500, JSON.stringify(first.body));
    else rejected(first);
    const attemptId = h.pointer().attemptId;
    const priorSession = [...h.sessions.keys()][0];
    const status = await h.status();
    assert.equal(status.status, 200);
    assert.equal(status.body.data.checkout.attemptId, attemptId);
    const resumed = await h.checkout();
    assert.equal(resumed.status, 201, JSON.stringify(resumed.body));
    assert.equal(h.sessions.size, 1);
    assert.equal(h.pointer().attemptId, attemptId);
    assert.equal(resumed.body.data.checkoutSessionId, priorSession || h.pointer().sessionId);
    assert.equal(h.pointer().sessionId, resumed.body.data.checkoutSessionId);
    const relation = h.get('checkoutSessions', h.pointer().sessionId);
    assert.equal(relation.userId, 'alice');
    assert.equal(relation.attemptId, attemptId, 'webhook can resolve the recovered association');
  });

  test(`discard: ${fault} can cancel by attemptId and choose another plan`, async () => {
    const h = await harness(backend);
    h.faults[fault] = 1;
    const first = await h.checkout();
    if (fault === 'createAfter') assert.ok(first.status === 201 || first.status >= 500, JSON.stringify(first.body));
    else rejected(first);
    const attemptId = h.pointer().attemptId;
    rejected(await h.checkout(otherPlan));
    const result = await h.cancel(attemptId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.cancelled, true);
    assert.equal(h.pointer().closed, true);
    assert.equal(openCount(h), 0);
    const next = await h.checkout(otherPlan);
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.notEqual(h.pointer().attemptId, attemptId);
    assert.equal(h.pointer().plan, 'all');
    assert.equal(openCount(h), 1);
  });
}

test('older than 23 hours: recover an existing orphan without replaying create', async () => {
  const h = await harness(backend);
  orphanAfterCreate(h);
  rejected(await h.checkout());
  const sessionId = [...h.sessions.keys()][0];
  h.advance(23 * HOUR + 60_000);
  const creates = h.calls.create.length;
  const result = await h.checkout();
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.checkoutSessionId, sessionId);
  assert.equal(h.calls.create.length, creates, 'expired safe replay window must never invoke create');
  noNewSession(h, 1);
});

test('expired idempotency key: an expired orphan is identified and a new attempt is distinct', async () => {
  const h = await harness(backend);
  orphanAfterCreate(h);
  rejected(await h.checkout());
  const oldAttempt = h.pointer().attemptId;
  const oldSession = [...h.sessions.values()][0];
  oldSession.status = 'expired'; oldSession.url = null;
  h.advance(25 * HOUR);
  const creates = h.calls.create.length;
  const first = await h.checkout();
  assert.equal(first.status, 410, JSON.stringify(first.body));
  assert.equal(h.calls.create.length, creates, 'do not reuse a provider key after expiration');
  assert.equal(h.pointer().closed, true);
  const next = await h.checkout();
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.notEqual(h.pointer().attemptId, oldAttempt);
  assert.equal(openCount(h), 1);
});

test('older than 23 hours with no session: discard safely, then retry the same plan', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  const oldAttempt = h.pointer().attemptId;
  h.advance(25 * HOUR);
  const creates = h.calls.create.length;
  const cancelled = await h.cancel();
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(h.calls.create.length, creates, 'old attempt is not replayed to prove absence');
  assert.equal(h.pointer().closed, true);
  const next = await h.checkout();
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.notEqual(h.pointer().attemptId, oldAttempt);
  assert.equal(h.sessions.size, 1);
});

test('uncertain creation after 23h stays reserved until fixed expiry plus quiet time', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  const attempt = h.pointer();
  const creates = h.calls.create.length;
  h.advance(23 * HOUR + 30 * 60_000);
  const retry = await h.checkout();
  const discard = await h.cancel();
  rejected(retry); rejected(discard);
  assert.equal(retry.body.error.code, 'CHECKOUT_RECONCILIATION_PENDING');
  assert.equal(discard.body.error.code, 'CHECKOUT_RECONCILIATION_PENDING');
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.create.length, creates);
  assert.equal(h.sessions.size, 0);
  h.now = attempt.params.expires_at * 1000 + 61_000;
  assert.equal((await h.cancel()).status, 200);
  assert.equal(h.pointer().closed, true);
  assert.equal(h.calls.create.length, creates);
  assert.equal((await h.checkout(otherPlan)).status, 201);
  assert.equal(openCount(h), 1);
});

test('legacy late replay uncertainty is measured from the latest dispatch, not the first attempt', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  const legacy = h.pointer();
  delete legacy.params.expires_at;
  h.put('checkoutAttempts', 'alice', legacy);
  h.advance(22 * HOUR);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  const creates = h.calls.create.length;
  assert.equal(creates, 2);
  h.advance(3 * HOUR);
  rejected(await h.cancel());
  assert.equal(h.pointer().closed, false, 'a request dispatched at hour 22 can still have an uncertain outcome at hour 25');
  assert.equal(h.calls.create.length, creates);
  h.advance(21 * HOUR + 61_000);
  const final = await h.cancel();
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(h.pointer().closed, true);
  assert.equal(h.calls.create.length, creates);
});

test('a cached Stripe 500 cannot silently release the reservation or create another session', async () => {
  const h = await harness(backend);
  h.faults.cachedCreate500 = 1;
  rejected(await h.checkout());
  const attemptId = h.pointer().attemptId;
  rejected(await h.checkout());
  rejected(await h.checkout(otherPlan));
  rejected(await h.cancel());
  assert.equal(h.pointer().attemptId, attemptId);
  assert.equal(h.pointer().closed, false);
  assert.equal(h.sessions.size, 0);
});

test('simultaneous retries create at most one session and one association', async () => {
  const h = await harness(backend);
  const results = await Promise.all(Array.from({ length: 8 }, () => h.checkout()));
  assert.ok(results.some(r => r.status === 201), JSON.stringify(results));
  assert.ok(results.every(r => r.status === 201 || r.status === 409 || r.status === 503));
  assert.equal(h.sessions.size, 1);
  assert.equal(openCount(h), 1);
  const relation = h.get('checkoutSessions', h.pointer().sessionId);
  assert.equal(relation.attemptId, h.pointer().attemptId);
});

test('Stripe pagination is exhausted before declaring an orphan absent', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  const attempt = h.pointer();
  for (let i = 0; i < 101; i++) h.makeSession({ userId: 'bob', attemptId: `noise-${i}`, plan: 'all', billingCycle: 'monthly' });
  const actual = h.makeSession(attempt);
  const creates = h.calls.create.length;
  const result = await h.checkout();
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.checkoutSessionId, actual.id);
  assert.ok(h.calls.list.some(p => p.starting_after), 'the actual session is on a later provider page');
  assert.equal(h.calls.create.length, creates);
});

test('multiple matching provider sessions fail closed instead of picking one or unlocking', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  h.makeSession(h.pointer()); h.makeSession(h.pointer());
  const creates = h.calls.create.length;
  rejected(await h.checkout());
  rejected(await h.cancel());
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.expire.length, 0);
  assert.equal(h.calls.create.length, creates);
});

for (const paidState of [
  { status: 'complete', payment_status: 'paid' },
  { status: 'complete', payment_status: 'unpaid' },
]) {
  test(`completed orphan (${paidState.payment_status}) cannot be discarded or open a new checkout`, async () => {
    const h = await harness(backend);
    orphanAfterCreate(h);
    rejected(await h.checkout());
    Object.assign([...h.sessions.values()][0], paidState);
    const cancel = await h.cancel();
    assert.equal(cancel.status, 409, JSON.stringify(cancel.body));
    assert.equal(h.pointer().closed, false);
    assert.equal(h.calls.expire.length, 0);
    rejected(await h.checkout());
    rejected(await h.checkout(otherPlan));
    noNewSession(h, 1);
  });
}

test('another user cannot cancel someone else’s attempt', async () => {
  const h = await harness(backend);
  const bob = await h.checkout(undefined, { user: 'bob' });
  assert.equal(bob.status, 201);
  const bobAttempt = h.pointer('bob').attemptId;
  const result = await h.cancel(bobAttempt);
  rejected(result);
  assert.equal(result.status, 404, JSON.stringify(result.body));
  assert.equal(h.pointer('bob').closed, false);
  assert.equal(h.calls.expire.length, 0);
});

test('an old attempt cancellation cannot close a newer attempt for the same user', async () => {
  const h = await harness(backend);
  assert.equal((await h.checkout()).status, 201);
  const oldAttempt = h.pointer().attemptId;
  assert.equal((await h.cancel()).status, 200);
  assert.equal((await h.checkout(otherPlan)).status, 201);
  const currentAttempt = h.pointer().attemptId;
  const expirations = h.calls.expire.length;
  rejected(await h.cancel(oldAttempt));
  assert.equal(h.pointer().attemptId, currentAttempt);
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.expire.length, expirations);
  assert.equal(openCount(h), 1);
});

test('incomplete provider lookup preserves the reservation and blocks another plan', async () => {
  const h = await harness(backend);
  orphanAfterCreate(h);
  rejected(await h.checkout());
  const creates = h.calls.create.length;
  h.faults.list = 2;
  rejected(await h.checkout());
  rejected(await h.cancel());
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.expire.length, 0);
  assert.equal(h.calls.create.length, creates);
  rejected(await h.checkout(otherPlan));
  noNewSession(h, 1);
});

test('an incomplete Firestore read does not prove absence or permit a new plan', async () => {
  const h = await harness(backend);
  orphanAfterCreate(h);
  rejected(await h.checkout());
  const attemptId = h.pointer().attemptId;
  const creates = h.calls.create.length;
  h.hooks.beforeRead = async ref => {
    if (ref.name === 'checkoutSessions') throw new Error('Injected partial Firestore query');
  };
  rejected(await h.cancel());
  assert.equal(h.pointer().attemptId, attemptId);
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.expire.length, 0);
  assert.equal(h.calls.create.length, creates);
  noNewSession(h, 1);
});

for (const mismatch of ['user', 'attempt']) {
  test(`a known session with mismatched ${mismatch} cannot be cancelled`, async () => {
    const h = await harness(backend);
    const first = await h.checkout();
    assert.equal(first.status, 201);
    const session = h.sessions.get(h.pointer().sessionId);
    if (mismatch === 'user') session.client_reference_id = 'bob';
    else session.metadata.attemptId = 'another-attempt';
    rejected(await h.cancel());
    assert.equal(h.pointer().closed, false);
    assert.equal(h.calls.expire.length, 0);
    assert.equal(session.status, 'open');
    noNewSession(h, 1);
  });
}

for (const conflict of [
  { userId: 'bob', attemptId: 'foreign-attempt' },
  { userId: 'alice', attemptId: 'another-attempt' },
]) {
  test(`recovery cannot overwrite an existing session document for ${conflict.userId}/${conflict.attemptId}`, async () => {
    const h = await harness(backend);
    h.faults.createBefore = 1;
    rejected(await h.checkout());
    const session = h.makeSession(h.pointer());
    h.put('checkoutSessions', session.id, { ...conflict, untouched: 'original' });
    const result = await h.checkout();
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.deepEqual(h.get('checkoutSessions', session.id), { ...conflict, untouched: 'original' });
    assert.equal(h.pointer().sessionId, undefined);
    assert.equal(h.pointer().closed, false);
    assert.equal(h.calls.expire.length, 0);
    noNewSession(h, 1);
  });
}

test('a provider page marked incomplete with no cursor cannot authorize discard', async () => {
  const h = await harness(backend);
  h.faults.createBefore = 1;
  rejected(await h.checkout());
  h.advance(25 * HOUR);
  h.hooks.listResult = () => ({ object: 'list', data: [], has_more: true });
  const creates = h.calls.create.length;
  rejected(await h.cancel());
  assert.equal(h.pointer().closed, false);
  assert.equal(h.calls.create.length, creates);
});

test('payment wins the expire race: cancellation must not release a completed purchase', async () => {
  const h = await harness(backend);
  assert.equal((await h.checkout()).status, 201);
  h.hooks.beforeExpire = async id => { Object.assign(h.sessions.get(id), { status: 'complete', payment_status: 'paid' }); };
  const result = await h.cancel();
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(h.pointer().closed, false);
  rejected(await h.checkout(otherPlan));
  noNewSession(h, 1);
});

test('continue and cancel race never leaves both a released attempt and an open payable session', async () => {
  const h = await harness(backend);
  const entered = deferred(), release = deferred();
  h.hooks.beforeCreate = async () => { entered.resolve(); await release.promise; };
  const creating = h.checkout();
  await entered.promise;
  const attemptId = h.pointer().attemptId;
  const cancelling = h.cancel(attemptId);
  release.resolve();
  const [createResult, cancelResult] = await Promise.all([creating, cancelling]);
  assert.ok([200, 409, 503].includes(cancelResult.status), JSON.stringify(cancelResult));
  assert.ok([201, 409, 503].includes(createResult.status), JSON.stringify(createResult));
  assert.ok(!(h.pointer().closed && openCount(h) > 0), 'closed reservation must not leave a payable checkout behind');
  if (!h.pointer().closed) {
    h.hooks.beforeCreate = undefined;
    assert.equal((await h.cancel()).status, 200);
  }
  assert.equal(h.pointer().closed, true);
  assert.equal(openCount(h), 0);
  assert.equal(h.sessions.size, 1);
});

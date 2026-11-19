import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { harness, HOUR } from './checkout-harness.mjs';

const baseline = process.env.APR69_BASELINE_BACKEND || fileURLToPath(new URL('../../../baseline/backend/', import.meta.url));

for (const fault of ['createBefore', 'createAfter', 'associationWrite']) {
  test(`baseline: ${fault} leaves an unmanageable attempt and blocks another plan`, {
    skip: !existsSync(baseline) && 'Set APR69_BASELINE_BACKEND to the unchanged original backend to reproduce the defect',
  }, async () => {
    const h = await harness(baseline);
    h.faults[fault] = 1;
    const first = await h.checkout();
    assert.ok(first.status >= 500);
    assert.equal(h.pointer().sessionId, undefined);
    assert.equal(h.pointer().closed, false);
    assert.equal(h.sessions.size, fault === 'createBefore' ? 0 : 1);
    const state = await h.status();
    assert.equal(state.status, 200);
    assert.equal(state.body.data.checkout.id, null);
    assert.equal(state.body.data.checkout.status, 'pending');
    assert.equal((await h.cancel()).status, 404, 'baseline has no cancellation route by attemptId');
    const different = await h.checkout({ plan: 'all', billingCycle: 'monthly' });
    assert.equal(different.body.error.code, 'CHECKOUT_IN_PROGRESS');
    h.advance(24 * HOUR);
    const same = await h.checkout();
    assert.equal(same.body.error.code, 'CHECKOUT_REVIEW_REQUIRED');
    assert.equal(h.calls.create.length, 1, 'baseline refuses the retry but leaves a permanent pointer');
  });
}

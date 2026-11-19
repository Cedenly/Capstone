import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { ok, fail } from '../lib/envelope.js';
import { normalizeBillingDate as date, billingTime, diagnoseSubscription, diagnoseInvoice } from '../lib/billingIdentity.js';

const r = Router();
const PAGE_SIZE = 25;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const text = value => typeof value === 'string' ? value : '';

function stripeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['invoice.stripe.com', 'pay.stripe.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

r.get('/billing/:kind', requireRole('finance'), wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Comprueba tambien el rol actual, por si cambio despues de emitir el token.
  if (!validId(req.user.id)) return fail(res, 403, 'AUTH_FORBIDDEN', 'Acceso no autorizado');
  const admin = (await db.collection('adminUsers').doc(req.user.id).get()).data();
  if (!admin || !['admin', 'finance'].includes(admin.role) || admin.state === 'suspended') {
    return fail(res, 403, 'AUTH_FORBIDDEN', 'Acceso no autorizado');
  }
  const { kind } = req.params;
  if (!['subscriptions', 'invoices'].includes(kind)) {
    return fail(res, 404, 'NOT_FOUND', 'Consulta no disponible');
  }
  const collection = db.collection(kind);
  let query = collection.where('provider', '==', 'stripe').where('livemode', '==', false);
  if (req.query.cursor !== undefined) {
    const cursor = req.query.cursor;
    if (!validId(cursor)) return fail(res, 400, 'INVALID_CURSOR', 'Pagina invalida');
    const anchor = await collection.doc(cursor).get();
    const value = anchor.data();
    if (!anchor.exists || value.provider !== 'stripe' || value.livemode !== false) {
      return fail(res, 400, 'INVALID_CURSOR', 'Pagina invalida; vuelve a la primera pagina');
    }
    query = query.startAfter(anchor);
  }
  const snapshot = await query.limit(PAGE_SIZE + 1).get();
  const documents = snapshot.docs.slice(0, PAGE_SIZE);
  const ids = [...new Set(documents.map(doc => doc.data().userId).filter(validId))];
  const users = new Map(await Promise.all(ids.map(async id => {
    return [id, (await db.collection('users').doc(id).get()).data()];
  })));
  const testIds = kind === 'subscriptions'
    ? [...new Set(
        documents
          .map(doc => doc.data())
          .filter(item => item.plan === 'uni' && validId(item.testId))
          .map(item => item.testId)
      )]
    : [];

  const tests = new Map(await Promise.all(testIds.map(async id => {
    const test = (await db.collection('tests').doc(id).get()).data();
    return [id, text(test?.label)];
  })));

  // Una factura histórica se contrasta con su propia suscripción, nunca con
  // la suscripción actual del usuario ni con una coincidencia de correo.
  const subscriptionIds = kind === 'invoices'
    ? [...new Set(documents.map(doc => doc.data().stripeSubscriptionId).filter(validId))]
    : [];
  const subscriptions = new Map(await Promise.all(subscriptionIds.map(async id => {
    return [id, (await db.collection('subscriptions').doc(id).get()).data()];
  })));

  const rows = documents.map(doc => {
    const item = doc.data();
    const user = users.get(item.userId);
    const common = {
      id: doc.id,
      user: { id: text(item.userId), name: text(user?.name), email: text(user?.email) },
      status: text(item.status), updatedAt: date(item.updatedAt),
    };
    if (kind === 'subscriptions') {
      const periodEnd = billingTime(item.currentPeriodEnd);
      const userPeriodEnd = billingTime(user?.billingPeriodEnd);
      const testId = item.plan === 'uni' && validId(item.testId)
        ? item.testId
        : null;

      return {
        ...common, plan: text(item.plan), billingCycle: text(item.billingCycle),
        testId,
        testLabel: testId ? tests.get(testId) || null : null,
        paymentPending: item.paymentPending === true,
        currentPeriodEnd: date(item.currentPeriodEnd),
        cancelAtPeriodEnd: item.cancelAtPeriodEnd === true,
        billingIdentity: diagnoseSubscription({
          userId: item.userId, user, subscriptionId: doc.id, subscription: item,
        }),
        accessActive:
          item.accessActive === true &&
          ['active', 'past_due'].includes(item.status) &&
          periodEnd !== null && periodEnd > Date.now() &&
          user?.state === 'active' &&
          user.billingProvider === 'stripe' &&
          user.stripeSubscriptionId === doc.id &&
          user.stripeCustomerId === item.stripeCustomerId &&
          user.plan === item.plan &&
          ['active', 'past_due'].includes(user.billingStatus) &&
          userPeriodEnd !== null && userPeriodEnd > Date.now() &&
          (
            typeof user.billingAccessActive === 'boolean'
              ? user.billingAccessActive
              : user.billingStatus === 'active'
          ),
      };
    }
    const cents = Math.round(item.amount * 100);
    return {
      ...common, subscriptionId: text(item.stripeSubscriptionId),
      billingIdentity: diagnoseInvoice({
        userId: item.userId, user, invoiceId: doc.id, invoice: item,
        subscriptionId: item.stripeSubscriptionId,
        subscription: subscriptions.get(item.stripeSubscriptionId),
      }),
      amountCents: typeof item.amount === 'number' && item.amount >= 0 &&
        item.currency === 'USD' && Number.isSafeInteger(cents) ? cents : null,
      createdAt: date(item.createdAt), paidAt: date(item.paidAt),
      hostedInvoiceUrl: stripeUrl(item.hostedInvoiceUrl), pdfUrl: stripeUrl(item.pdfUrl),
    };
  });
  return ok(res, rows, 200, {
    mode: 'test', pagination: {
      pageSize: PAGE_SIZE,
      nextCursor: snapshot.docs.length > PAGE_SIZE ? documents.at(-1).id : null,
    },
  });
}));

export default r;

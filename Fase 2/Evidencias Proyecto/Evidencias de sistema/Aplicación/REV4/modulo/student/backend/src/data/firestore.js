import { assertTestDataEnvironment } from '../lib/testDataSafety.js';
import { initFirestore } from '../config/firebase.js';

let db = null;

async function ready() {
  if (!db) ({ db } = await initFirestore());
  return db;
}

const withId = doc => ({ id: doc.id, ...doc.data() });

const billingFields = [
  'plan',
  'billingProvider',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'billingStatus',
  'billingAccessActive',
  'billingPeriodEnd',
  'billingTestId',
  'billingUpdatedAt',
];

function blocked() {
  throw Object.assign(
    new Error('Esta operacion debe gestionarse mediante Stripe.'),
    {
      status: 409,
      code: 'STRIPE_OPERATION_REQUIRED',
    },
  );
}

async function write(name, id, data, merge) {
  const database = await ready();
  const ref = database.collection(name).doc(id);

  return database.runTransaction(async tx => {
    const snap = await tx.get(ref);

    if (merge && !snap.exists) return null;

    const current = snap.data() || {};

    if (
      ['subscriptions', 'invoices'].includes(name) &&
      current.provider === 'stripe'
    ) {
      blocked();
    }

    const next = { ...data };

    // Conserva el estado y la auditoría actuales del administrador,
    // aunque la petición del estudiante haya leído una versión anterior.
    if (name === 'users' && snap.exists) {
      const administrationFields = [
        'state',
        'lastActionReason',
        'auditedBy',
        'auditedAt',
        'authSessionVersion',
      ];

      for (const field of administrationFields) {
        if (Object.hasOwn(current, field)) {
          next[field] = current[field];
        } else {
          delete next[field];
        }
      }
    }

    if (name === 'users' && current.billingProvider === 'stripe') {
      for (const field of billingFields) {
        if (Object.hasOwn(current, field)) {
          next[field] = current[field];
        } else {
          delete next[field];
        }
      }
    }

    tx.set(ref, next, { merge });

    return {
      id,
      ...(merge ? current : {}),
      ...next,
    };
  });
}

export const firestoreDriver = {
  async authTransaction(fn) {
    const database = await ready();
    return database.runTransaction(async transaction => fn({
      get: async (name, id) => {
        const snap = await transaction.get(database.collection(name).doc(id));
        return snap.exists ? { ...snap.data(), id: snap.id } : null;
      },
      set: (name, id, data) => transaction.set(database.collection(name).doc(id), data),
    }));
  },
  async queryEqual(name, filters, limit = null) {
    let query = (await ready()).collection(name);

    for (const [field, value] of Object.entries(filters)) {
      query = query.where(field, '==', value);
    }

    if (limit !== null) {
      query = query.limit(limit);
    }

    const result = await query.get();
    return result.docs.map(withId);
  },

  async list(name) {
    const result = await (await ready()).collection(name).get();
    return result.docs.map(withId);
  },

  async get(name, id) {
    const doc = await (await ready()).collection(name).doc(id).get();
    return doc.exists ? withId(doc) : null;
  },

  async set(name, id, data) {
    return write(name, id, data, false);
  },

  async patch(name, id, data) {
    return write(name, id, data, true);
  },

  async del(name, id) {
    const database = await ready();
    const ref = database.collection(name).doc(id);

    await database.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();

      if (
        (name === 'users' && current?.billingProvider === 'stripe') ||
        (
          ['subscriptions', 'invoices'].includes(name) &&
          current?.provider === 'stripe'
        )
      ) {
        blocked();
      }

      tx.delete(ref);
    });
  },

  async reset(seedData) {
    assertTestDataEnvironment('reset');
    const database = await ready();

    // Solo se ejecuta en un emulador loopback y proyecto demo-* autorizado.
    // Limpia las colecciones de la fixture para que resembrar sea repetible.
    for (const collection of Object.keys(seedData)) {
      await database.recursiveDelete(database.collection(collection));
    }
    let batch = database.batch();
    let pending = 0;
    for (const [collection, docs] of Object.entries(seedData)) {
      for (const [id, doc] of Object.entries(docs)) {
        batch.set(database.collection(collection).doc(id), doc);
        if (++pending === 400) {
          await batch.commit();
          batch = database.batch();
          pending = 0;
        }
      }
    }
    if (pending) await batch.commit();
  },
};

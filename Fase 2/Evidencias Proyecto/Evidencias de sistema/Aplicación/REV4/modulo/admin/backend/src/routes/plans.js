import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, db, FieldValue } from '../data/repo.js';

const r = Router();

const editable = [
  'name',
  'color',
  'features',
  'limits',
  'badges',
  'popular',
];

const integer = value =>
  Number.isSafeInteger(value) && value >= 0;

const object = value =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);

function reject(status, code, message) {
  throw Object.assign(new Error(message), {
    status,
    code,
  });
}

function values(plan) {
  return {
    name: plan.name ?? '',
    color: plan.color ?? '#6366F1',
    features: plan.features ?? [],
    popular: !!plan.popular,
    limits: {
      qDay: plan.limits?.qDay ?? 0,
      groups: plan.limits?.groups ?? 0,
      tests: plan.limits?.tests ?? 1,
    },
    badges: {
      login: plan.badges?.login ?? 0,
      purchase: plan.badges?.purchase ?? 0,
      correct: plan.badges?.correct ?? 0,
    },
  };
}

function checkMap(value, keys, label) {
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some(key => !integer(value[key]))
  ) {
    reject(
      400,
      'VALIDATION',
      `${label}: utiliza enteros mayores o iguales a cero.`
    );
  }
}

// Catálogo de funcionalidades.
r.get('/features', requireRole('admin'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.features));
}));

// Planes existentes y campos que se pueden editar.
r.get('/plans', requireRole('admin'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.plans), 200, {
    readOnly: false,
    editableFields: editable,
    billingChangesReady: false,
  });
}));

// Guardar la configuración de un plan existente.
r.put('/plans/:id', requireRole('admin'), wrap(async (req, res) => {
  const body = req.body;

  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(req.params.id) ||
    !object(body)
  ) {
    return fail(res, 400, 'VALIDATION', 'Solicitud inválida.');
  }

  if (
    Object.keys(body).some(
      key => ![...editable, 'adminRevision'].includes(key)
    )
  ) {
    return fail(
      res,
      409,
      'PLAN_FIELDS_READ_ONLY',
      'Los precios, la publicación y las referencias de pago todavía no se pueden modificar desde este formulario.'
    );
  }

  const ref = db.collection(COL.plans).doc(req.params.id);
  const auditRef = db.collection('auditLog').doc();

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      reject(404, 'NOT_FOUND', 'Plan no encontrado.');
    }

    const current = snap.data();
    const revision = current.adminRevision ?? 0;

    if (!integer(body.adminRevision)) {
      reject(
        400,
        'VALIDATION',
        'Falta la versión del plan. Recarga el catálogo.'
      );
    }

    if (body.adminRevision !== revision) {
      reject(
        409,
        'PLAN_CHANGED',
        'El plan cambió desde que lo abriste. Recarga el catálogo antes de guardar.'
      );
    }

    const before = values(current);
    const next = { ...before };

    for (const key of editable) {
      if (Object.hasOwn(body, key)) {
        next[key] = body[key];
      }
    }

    if (
      typeof next.name !== 'string' ||
      !next.name.trim() ||
      next.name.trim().length > 120 ||
      typeof next.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(next.color) ||
      typeof next.popular !== 'boolean'
    ) {
      reject(
        400,
        'VALIDATION',
        'Revisa el nombre, el color hexadecimal y el indicador de plan destacado.'
      );
    }

    next.name = next.name.trim();

    checkMap(
      next.limits,
      ['qDay', 'groups', 'tests'],
      'Límites'
    );

    checkMap(
      next.badges,
      ['login', 'purchase', 'correct'],
      'Badges'
    );

    if (
      !Array.isArray(next.features) ||
      next.features.some(id => typeof id !== 'string') ||
      new Set(next.features).size !== next.features.length
    ) {
      reject(
        400,
        'VALIDATION',
        'La lista de funcionalidades no es válida.'
      );
    }

    const changed = editable.filter(
      key => JSON.stringify(before[key]) !== JSON.stringify(next[key])
    );

    if (!changed.length) {
      return { ...current, id: ref.id };
    }

    const patch = Object.fromEntries(
      changed.map(key => [key, next[key]])
    );

    if (changed.includes('features')) {
      const catalog = await tx.get(db.collection(COL.features));

      const names = new Map(
        catalog.docs.map(doc => [
          doc.id,
          doc.data().name_es || doc.data().name,
        ])
      );

      if (
        next.features.some(
          id => !names.has(id) || typeof names.get(id) !== 'string'
        )
      ) {
        reject(
          400,
          'VALIDATION',
          'Selecciona funcionalidades existentes en el catálogo.'
        );
      }

      // La web del estudiante utiliza estos textos para mostrar beneficios.
      patch.featuresText = next.features.map(id => names.get(id));
    }

    if (patch.limits) {
      patch.limits = { ...current.limits, ...patch.limits };
    }

    if (patch.badges) {
      patch.badges = { ...current.badges, ...patch.badges };
    }

    patch.adminRevision = revision + 1;
    patch.updatedAt = new Date().toISOString();
    patch.updatedBy = req.user.id;

    // Actualiza únicamente los campos editados.
    // Conserva precios, referencias de Stripe y otros campos existentes.
    tx.update(ref, patch);

    // El cambio y su auditoría se guardan en la misma transacción.
    tx.create(auditRef, {
      actorUid: req.user.id,
      actorName: req.user.name || '',
      action: 'plan.updated',
      targetType: 'plan',
      targetId: ref.id,
      details: {
        fields: changed,
        before,
        after: next,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      ...current,
      ...patch,
      id: ref.id,
    };
  });

  return ok(res, result);
}));

// Se habilitarán junto con la integración del catálogo y Stripe.
r.all(['/plans', '/plans/:id'], requireRole('admin'), (_req, res) => {
  return fail(
    res,
    409,
    'PLAN_CATALOG_READ_ONLY',
    'Crear o eliminar planes todavía está pendiente. Puedes editar la configuración de los planes existentes.'
  );
});

export default r;
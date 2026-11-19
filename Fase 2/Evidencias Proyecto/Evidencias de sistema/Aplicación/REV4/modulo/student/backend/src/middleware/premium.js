// Gating de plan de pago. El wireframe marca con "⭐ Premium" el contacto a
// tutores y el analisis de falencias; ambos responden 403 PLAN_REQUIRED en free.
import { fail } from '../lib/envelope.js';
import { effectivePlan } from '../lib/entitlements.js';

export function isPremium(user) {
  return effectivePlan(user) !== 'free';
}

export function premiumRequired(req, res, next) {
  if (!req.user) return fail(res, 401, 'AUTH_REQUIRED', 'Falta el token de acceso');
  if (!isPremium(req.user)) {
    return fail(res, 403, 'PLAN_REQUIRED', 'Esta funcion requiere un plan de pago', {
      details: [{ upgradeTo: ['uni', 'all'] }],
    });
  }
  next();
}

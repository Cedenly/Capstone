// Cuota diaria gratuita: base 10, +5 por colegio, +5 por direccion, max 20.
// El plan uni es ilimitado solo en la prueba contratada; el resto conserva
// la cuota gratuita. El plan all es ilimitado en todas las pruebas.
import { effectivePlan } from './entitlements.js';

export const BASE_QUOTA = 10;
export const MAX_QUOTA = 20;

export function isUnlimited(user, testId = null) {
  const plan = effectivePlan(user);
  if (plan === 'all') return true;
  if (plan !== 'uni') return false;

  // Sin testId, indica si la cuenta posee alguna prueba ilimitada.
  if (testId == null) return true;

  const chosen = user.billingProvider === 'stripe'
    ? user.billingTestId
    : (user.billingTestId || user.selectedTests?.[0]);

  return typeof chosen === 'string' && testId === chosen;
}

export function freeQuotaMax(user) {
  const b = user.bonuses || {};
  let max = BASE_QUOTA;
  if (b.school) max += 5;
  if (b.address) max += 5;
  return Math.min(max, MAX_QUOTA);
}

export function quotaMax(user, testId = null) {
  return isUnlimited(user, testId) ? 999999 : freeQuotaMax(user);
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Reinicia el contador si cambio el dia.
export function ensureQuotaDay(user) {
  const today = todayKey();
  if (!user.quota || user.quota.day !== today) {
    user.quota = { day: today, used: 0, total: 0 };
  }
  return user.quota;
}

export function resetsAt() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}
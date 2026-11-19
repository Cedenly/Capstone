// APR-81: normalización y diagnóstico de lectura. No escribe ni concede acceso.
// Los dos backends mantienen este archivo idéntico y lo prueban con las mismas entradas.
const MIN_TIME = -62135596800000; // 0001-01-01T00:00:00.000Z
const MAX_TIME = 253402300799999; // 9999-12-31T23:59:59.999Z
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validCustomer = value => validId(value) && value.startsWith('cus_');
const finiteTime = value => Number.isFinite(value) && value >= MIN_TIME && value <= MAX_TIME;

function isoTime(value) {
  // No se aceptan fechas locales, atajos de Date.parse ni números como texto.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction = '', zone, sign, zh = '0', zm = '0'] = match;
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] =
    [y, mo, d, h, mi, s, zh, zm].map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59 ||
      zone === '-00:00') return null;
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
  // setUTCFullYear evita la conversión implícita de los años 00–99 a 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null; // rechaza, por ejemplo, 30 de febrero
  const offset = zone === 'Z' ? 0 : (zoneHour * 60 + zoneMinute) * (sign === '+' ? 1 : -1);
  const time = date.getTime() - offset * 60000;
  return finiteTime(time) ? time : null;
}

function timestampTime(value) {
  // Timestamp del SDK y su forma JSON pública. No se invocan métodos arbitrarios
  // toMillis/toDate ni se adivina la unidad de un número libre.
  let seconds, nanos;
  try {
    const hasPublic = 'seconds' in value || 'nanoseconds' in value;
    const hasPrivate = '_seconds' in value || '_nanoseconds' in value;
    const publicShape = Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds);
    const privateShape = Number.isInteger(value._seconds) && Number.isInteger(value._nanoseconds);
    if ((hasPublic && !publicShape) || (hasPrivate && !privateShape)) return null;
    if (publicShape) {
      seconds = value.seconds; nanos = value.nanoseconds;
      if (privateShape && (value._seconds !== seconds || value._nanoseconds !== nanos)) return null;
    } else if (privateShape) {
      seconds = value._seconds; nanos = value._nanoseconds;
    } else return null;
    const keys = Object.keys(value);
    if (keys.some(key => !['seconds', 'nanoseconds', '_seconds', '_nanoseconds'].includes(key))) return null;
  } catch { return null; }
  if (!Number.isSafeInteger(seconds) || nanos < 0 || nanos >= 1e9) return null;
  // Contrato API a milisegundos: se trunca, no se amplía la vigencia por redondeo.
  const time = seconds * 1000 + Math.floor(nanos / 1e6);
  return finiteTime(time) && Number.isSafeInteger(time) ? time : null;
}

export function billingTime(value) {
  if (typeof value === 'string') return isoTime(value);
  if (!record(value)) return null;
  if (value instanceof Date) {
    try {
      const time = Date.prototype.getTime.call(value);
      return finiteTime(time) ? time : null;
    } catch { return null; }
  }
  return timestampTime(value);
}

export function normalizeBillingDate(value) {
  const time = billingTime(value);
  return time === null ? null : new Date(time).toISOString();
}

function answer(issues, success = 'consistent') {
  const unique = [...new Set(issues)];
  const onlyPolicy = unique.length === 1 && unique[0] === 'MANUAL_POLICY_PENDING';
  return { status: onlyPolicy ? 'manual_policy_pending' : unique.length ? 'inconsistent' : success,
    issues: unique };
}

function subscriptionBase({ userId, user, subscriptionId, subscription }, issues) {
  if (!validId(userId)) issues.push('USER_ID_INVALID');
  if (!record(user)) issues.push('USER_NOT_FOUND');
  if (record(user) && user.id != null && user.id !== userId) issues.push('USER_ID_MISMATCH');
  if (!validId(subscriptionId)) issues.push('SUBSCRIPTION_ID_INVALID');
  if (!record(subscription)) { issues.push('SUBSCRIPTION_NOT_FOUND'); return false; }
  if (subscription.provider !== 'stripe') issues.push('PROVIDER_MISMATCH');
  if (subscription.livemode !== false) issues.push('MODE_MISMATCH');
  if (subscription.userId !== userId) issues.push('SUBSCRIPTION_OWNER_MISMATCH');
  if (!validCustomer(subscription.stripeCustomerId)) issues.push('SUBSCRIPTION_CUSTOMER_MISMATCH');
  if ((subscription.id != null && subscription.id !== subscriptionId) ||
      (subscription.stripeSubscriptionId != null && subscription.stripeSubscriptionId !== subscriptionId)) {
    issues.push('SUBSCRIPTION_ID_MISMATCH');
  }
  return true;
}

export function diagnoseSubscription({ userId, user, subscriptionId, subscription } = {}) {
  if (validId(userId) && record(user) && subscription == null && subscriptionId == null &&
      user.stripeSubscriptionId == null && user.stripeCustomerId == null && user.billingProvider !== 'stripe') {
    return user.id != null && user.id !== userId
      ? answer(['USER_ID_MISMATCH']) : { status: 'unlinked', issues: [] };
  }
  const issues = [];
  if (!subscriptionBase({ userId, user, subscriptionId, subscription }, issues)) return answer(issues);
  if (!record(user)) return answer(issues);
  const period = billingTime(subscription.currentPeriodEnd);
  if (period === null) issues.push('INVALID_SUBSCRIPTION_PERIOD');
  // Un contrato anterior se verifica por su propietario estable; los campos
  // actuales del alumno pueden pertenecer legítimamente a otro contrato.
  const historical = validId(user.stripeSubscriptionId) && user.stripeSubscriptionId !== subscriptionId;
  if (historical) return answer(issues, 'historical');
  if (user.stripeSubscriptionId !== subscriptionId) issues.push('SUBSCRIPTION_ID_MISMATCH');
  if (user.billingProvider !== 'stripe') issues.push('USER_PROVIDER_MISMATCH');
  if (!validCustomer(user.stripeCustomerId) || user.stripeCustomerId !== subscription.stripeCustomerId) {
    issues.push('SUBSCRIPTION_CUSTOMER_MISMATCH');
  }
  if (user.planSource === 'manual') {
    issues.push('MANUAL_POLICY_PENDING');
    // No interpretar una asignación manual como una modificación del proveedor.
    return answer(issues);
  }
  const userPeriod = billingTime(user.billingPeriodEnd);
  if (userPeriod === null) issues.push('INVALID_USER_PERIOD');
  if (period !== null && userPeriod !== null && period !== userPeriod) issues.push('PERIOD_MISMATCH');
  const confirmed = subscription.accessActive === true &&
    (typeof user.billingAccessActive === 'boolean' ? user.billingAccessActive : user.billingStatus === 'active');
  if (confirmed) {
    if (user.plan !== subscription.plan) issues.push('PLAN_MISMATCH');
    if (subscription.plan === 'uni' && (!validId(subscription.testId) ||
        !validId(user.billingTestId) || subscription.testId !== user.billingTestId)) {
      issues.push('SUBJECT_MISMATCH');
    }
  }
  return answer(issues);
}

export function diagnoseInvoice({ userId, user, invoiceId, invoice, subscriptionId, subscription } = {}) {
  const issues = [];
  if (!validId(invoiceId)) issues.push('INVOICE_ID_INVALID');
  if (!record(invoice)) return answer([...issues, 'INVOICE_NOT_FOUND']);
  if (invoice.provider !== 'stripe') issues.push('PROVIDER_MISMATCH');
  if (invoice.livemode !== false) issues.push('MODE_MISMATCH');
  if (invoice.userId !== userId) issues.push('INVOICE_OWNER_MISMATCH');
  if ((invoice.id != null && invoice.id !== invoiceId) ||
      (invoice.stripeInvoiceId != null && invoice.stripeInvoiceId !== invoiceId)) {
    issues.push('INVOICE_ID_MISMATCH');
  }
  if (!validId(invoice.stripeSubscriptionId) || invoice.stripeSubscriptionId !== subscriptionId) {
    issues.push('INVOICE_SUBSCRIPTION_MISMATCH');
  }
  if (subscriptionBase({ userId, user, subscriptionId, subscription }, issues)) {
    if (!validCustomer(invoice.stripeCustomerId) || invoice.stripeCustomerId !== subscription.stripeCustomerId) {
      issues.push('INVOICE_CUSTOMER_MISMATCH');
    }
  }
  // El propietario y cliente de la factura se contrastan con su contrato
  // inmutable, nunca con el contrato que el alumno tenga hoy.
  const historical = record(user) && validId(user.stripeSubscriptionId) && user.stripeSubscriptionId !== subscriptionId;
  return answer(issues, historical ? 'historical' : 'consistent');
}

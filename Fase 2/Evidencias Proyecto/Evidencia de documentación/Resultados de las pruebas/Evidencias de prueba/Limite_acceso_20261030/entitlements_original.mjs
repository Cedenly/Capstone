// Determina el plan disponible según el acceso confirmado
// y la fecha límite del periodo ya pagado.
export function effectivePlan(user, now = Date.now()) {
  if (!user || !user.plan || user.plan === 'free') return 'free';

  const isSubscription =
    user.billingProvider === 'stripe' ||
    user.planSource === 'subscription';

  if (isSubscription) {
    const periodEnd = Date.parse(user.billingPeriodEnd || '');

    const confirmedAccess =
      typeof user.billingAccessActive === 'boolean'
        ? user.billingAccessActive
        : user.billingStatus === 'active';

    return (
      confirmedAccess &&
      ['active', 'past_due'].includes(user.billingStatus) &&
      Number.isFinite(periodEnd) &&
      periodEnd > now
    )
      ? user.plan
      : 'free';
  }

  if (user.planSource === 'free') return 'free';

  return user.plan;
}
// Logica de gamificacion de medallas.
// Niveles y ruta de canje: 5 de un nivel = 1 del siguiente.
export const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'platinum'];
export const NEXT = { bronze: 'silver', silver: 'gold', gold: 'diamond', diamond: 'platinum' };

export function emptyWallet() {
  return { bronze: 0, silver: 0, gold: 0, diamond: 0, platinum: 0 };
}

export function award(wallet, tier, amount) {
  wallet[tier] = (wallet[tier] || 0) + amount;
  return wallet;
}

// Progreso hacia el siguiente nivel del primer nivel con saldo.
export function walletProgress(wallet) {
  for (const t of TIERS) {
    if (NEXT[t]) {
      const have = (wallet[t] || 0) % 5;
      return { [t]: { have, needed: 5, next: NEXT[t] } };
    }
  }
  return {};
}

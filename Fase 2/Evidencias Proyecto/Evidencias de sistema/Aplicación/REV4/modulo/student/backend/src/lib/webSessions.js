import { createHash, randomBytes } from 'node:crypto';
import { authTransaction } from '../data/repo.js';
import { sessionConfig } from './sessionConfig.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const tokenHash = token => typeof token === 'string' && /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token) ? sha(token) : null;
const makeToken = sid => `${sid}.${randomBytes(32).toString('base64url')}`;
const fail = (status, code, message) => ({ status, code, message });
const invalid = () => fail(401, 'REFRESH_TOKEN_INVALID', 'La sesión no es válida. Inicia sesión nuevamente.');

function revision(user) {
  const counter = user.authSessionVersion ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  const auditedAt = typeof user.auditedAt === 'string' ? user.auditedAt :
    typeof user.auditedAt?.toMillis === 'function' ? String(user.auditedAt.toMillis()) : '';
  return sha(JSON.stringify([counter, auditedAt, user.passwordHash || '']));
}

function checkUser(user, session, now) {
  if (!user || !session || session.revokedAt || session.expiresAt <= now) return invalid();
  if (user.state === 'suspended') return fail(403, 'ACCOUNT_SUSPENDED', 'La cuenta está suspendida.');
  if (!revision(user) || session.userRevision !== revision(user)) return invalid();
  return null;
}

const revoke = (session, now, reason) => ({ ...session, revokedAt: now, revocationReason: reason });

// Persistencia atómica de familia, hashes y revisión del usuario. Las claves
// de renovación nunca se guardan en claro, ni como JWT recuperable del servidor.
export async function createWebSession(expectedUser) {
  const sid = randomBytes(16).toString('hex');
  const token = makeToken(sid);
  const now = Date.now();
  const expiresAt = now + sessionConfig.refreshTtl * 1000;
  const result = await authTransaction(async tx => {
    const user = await tx.get('users', expectedUser.id);
    if (!user || !revision(user) || user.passwordHash !== expectedUser.passwordHash) return invalid();
    if (user.state === 'suspended') return fail(403, 'ACCOUNT_SUSPENDED', 'La cuenta está suspendida.');
    const session = { id: sid, userId: user.id, userRevision: revision(user), createdAt: now,
      expiresAt, revokedAt: null, rotation: 0 };
    tx.set('authSessions', sid, session);
    tx.set('authRefreshTokens', sha(token), { sessionId: sid, userId: user.id,
      createdAt: now, expiresAt, usedAt: null });
    return { user, session };
  });
  return result.status ? result : { ...result, refreshToken: token, expiresAt };
}

export async function rotateWebSession(token) {
  const hash = tokenHash(token);
  if (!hash) return invalid();
  const sid = token.slice(0, 32);
  const nextToken = makeToken(sid);
  const now = Date.now();
  const result = await authTransaction(async tx => {
    const prior = await tx.get('authRefreshTokens', hash);
    if (!prior || prior.sessionId !== sid) return invalid();
    const session = await tx.get('authSessions', sid);
    const user = session ? await tx.get('users', session.userId) : null;
    if (!session || prior.userId !== session.userId) return invalid();
    const denied = checkUser(user, session, now);
    if (denied) {
      if (!session.revokedAt) tx.set('authSessions', sid, revoke(session, now, denied.code));
      return denied;
    }
    if (prior.usedAt != null) {
      if (now - prior.usedAt <= sessionConfig.concurrencyWindowMs) {
        return fail(409, 'REFRESH_CONCURRENT', 'Otra solicitud ya renovó la sesión. Reintenta con la cookie vigente.');
      }
      tx.set('authSessions', sid, revoke(session, now, 'REFRESH_REUSE'));
      return invalid();
    }
    tx.set('authRefreshTokens', hash, { ...prior, usedAt: now });
    tx.set('authRefreshTokens', sha(nextToken), { sessionId: sid, userId: user.id,
      createdAt: now, expiresAt: session.expiresAt, usedAt: null });
    const next = { ...session, rotation: session.rotation + 1, lastRotatedAt: now };
    tx.set('authSessions', sid, next);
    return { user, session: next };
  });
  return result.status ? result : { ...result, refreshToken: nextToken, expiresAt: result.session.expiresAt };
}

export async function revokeWebSession(token, accessPayload = null) {
  const hash = tokenHash(token);
  const sid = typeof accessPayload?.sid === 'string' && /^[a-f0-9]{32}$/.test(accessPayload.sid) ? accessPayload.sid : null;
  if (!hash && !sid) return;
  await authTransaction(async tx => {
    const prior = hash ? await tx.get('authRefreshTokens', hash) : null;
    const cookieSession = prior ? await tx.get('authSessions', prior.sessionId) : null;
    const accessSession = sid ? (cookieSession?.id === sid ? cookieSession : await tx.get('authSessions', sid)) : null;
    // Todas las lecturas antes de cualquier escritura para Firestore.
    const sessions = new Map();
    if (cookieSession && cookieSession.userId === prior.userId) sessions.set(cookieSession.id, cookieSession);
    if (accessSession && accessSession.userId === accessPayload.sub) sessions.set(accessSession.id, accessSession);
    for (const [id, session] of sessions) {
      if (!session.revokedAt) tx.set('authSessions', id, revoke(session, Date.now(), 'LOGOUT'));
    }
  });
}

export async function validateWebAccess(payload) {
  if (typeof payload.sid !== 'string' || !/^[a-f0-9]{32}$/.test(payload.sid) ||
      typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.sub)) {
    return fail(401, 'AUTH_INVALID', 'La sesión anterior expiró. Inicia sesión nuevamente.');
  }
  return authTransaction(async tx => {
    const session = await tx.get('authSessions', payload.sid);
    if (!session || session.userId !== payload.sub) return fail(401, 'AUTH_INVALID', 'Sesión inválida.');
    const user = await tx.get('users', session.userId);
    const denied = checkUser(user, session, Date.now());
    if (denied) {
      if (!session.revokedAt) tx.set('authSessions', payload.sid, revoke(session, Date.now(), denied.code));
      return { ...denied, code: denied.status === 403 ? denied.code : 'AUTH_INVALID' };
    }
    return { user, session };
  });
}

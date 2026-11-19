// Sesión web: acceso únicamente en memoria; renovación en cookie HttpOnly.
const API_ORIGIN = (import.meta.env?.VITE_API_URL || '')
  .trim()
  .replace(/\/+$/, '');
const BASE = `${API_ORIGIN}/api/v1`;
const AUTH_LOCK = `aprueba-session:${BASE}`;
const CHANNEL = `aprueba-session-events:${BASE}`;
const LOGOUT_PENDING = `aprueba-logout-pending:${BASE}`;

let accessToken = null;
let pendingLogoutToken = null;
let onAuthFail = null;
let sessionVersion = 0;
let refreshJob = null;
let authQueue = Promise.resolve();
let renewalBlocked = false;
let channel = null;

const tokenValue = value => typeof value === 'string' && value ? value : null;

// No se migra un refresh token antiguo: la versión nueva exige iniciar sesión.
try { localStorage.removeItem('aprueba_tokens'); } catch {}
// Solo se conserva la intención de salir, nunca una credencial. Si la petición
// de logout falla, una recarga no debe restaurar automáticamente su cookie.
try { renewalBlocked = localStorage.getItem(LOGOUT_PENDING) === '1'; } catch {}

function rememberLogout(pending) {
  try {
    if (pending) localStorage.setItem(LOGOUT_PENDING, '1');
    else localStorage.removeItem(LOGOUT_PENDING);
  } catch {}
}

function changeLocalSession({ blockRenewal = false, notify = false } = {}) {
  sessionVersion += 1;
  accessToken = null;
  refreshJob = null;
  renewalBlocked = blockRenewal;
  if (notify && onAuthFail) onAuthFail();
  return sessionVersion;
}

// No se intercambian tokens ni datos de usuario entre pestañas.
if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = event => {
      if (event.data?.type === 'session-changed') {
        changeLocalSession({ blockRenewal: true, notify: true });
      }
    };
  } catch {}
}

function announceSessionChange() {
  try { channel?.postMessage({ type: 'session-changed' }); } catch {}
}

export function clearTokens() {
  changeLocalSession({ blockRenewal: true });
}

export function hasSession() {
  return !!accessToken;
}

export function getSessionVersion() {
  return sessionVersion;
}

export function setAuthFailHandler(handler) {
  onAuthFail = typeof handler === 'function' ? handler : null;
}

function responseError(json, status) {
  return Object.assign(new Error(
    json?.error?.message || 'No se pudo completar la solicitud'
  ), {
    code: json?.error?.code || 'HTTP_ERROR',
    status,
    field: json?.error?.field || null,
  });
}

function sessionChangedError() {
  return Object.assign(new Error('La sesion cambio. Vuelve a iniciar sesion.'), {
    code: 'SESSION_CHANGED', status: 401,
  });
}

function assertCurrent(expectedVersion) {
  if (expectedVersion !== sessionVersion) throw sessionChangedError();
}

function invalidateSession(expectedVersion) {
  if (expectedVersion === sessionVersion) {
    changeLocalSession({ blockRenewal: true, notify: true });
  }
}

async function readJson(response) {
  if (response.status === 204) return { data: null, meta: null };
  try { return await response.json(); } catch {
    throw Object.assign(new Error('Respuesta invalida del servidor'), {
      code: 'PARSE', status: response.status,
    });
  }
}

// La cola local funciona también sin Web Locks. Cuando está disponible, el
// bloqueo coordina las pestañas del mismo origen y partición de almacenamiento.
function withAuthLock(operation) {
  const run = () => {
    const locks = globalThis.navigator?.locks;
    return locks?.request
      ? locks.request(AUTH_LOCK, operation)
      : operation();
  };
  const result = authQueue.then(run, run);
  authQueue = result.catch(() => {});
  return result;
}

async function authRequest(path, body = {}, revokeToken = null) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(revokeToken ? { Authorization: `Bearer ${revokeToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, json: await readJson(response) };
}

function validAccess(json) {
  const token = tokenValue(json?.data?.accessToken);
  if (!token) {
    throw Object.assign(new Error('Respuesta de sesion invalida'), {
      code: 'INVALID_SESSION_RESPONSE', status: 502,
    });
  }
  return token;
}

async function tryRefresh(expectedVersion) {
  assertCurrent(expectedVersion);
  if (renewalBlocked) throw sessionChangedError();
  if (refreshJob?.version === expectedVersion) return refreshJob.promise;

  const job = { version: expectedVersion, promise: null };
  job.promise = withAuthLock(async () => {
    assertCurrent(expectedVersion);
    if (renewalBlocked) throw sessionChangedError();
    let result = await authRequest('/auth/refresh');
    assertCurrent(expectedVersion);

    // Sin Web Locks pueden competir dos pestañas. El servidor no borra la
    // cookie por esta carrera; una sola repetición puede usar la cookie nueva.
    if (result.response.status === 409 &&
        result.json?.error?.code === 'REFRESH_CONCURRENT') {
      await new Promise(resolve => setTimeout(resolve, 100));
      assertCurrent(expectedVersion);
      result = await authRequest('/auth/refresh');
      assertCurrent(expectedVersion);
    }

    if (!result.response.ok) {
      if (result.response.status === 401 ||
          result.json?.error?.code === 'ACCOUNT_SUSPENDED') {
        invalidateSession(expectedVersion);
      }
      throw responseError(result.json, result.response.status);
    }
    accessToken = validAccess(result.json);
    return true;
  });
  refreshJob = job;
  try { return await job.promise; } finally {
    if (refreshJob === job) refreshJob = null;
  }
}

export async function restoreSession() {
  if (accessToken) return true;
  const expectedVersion = sessionVersion;
  try { return await tryRefresh(expectedVersion); } catch (error) {
    if (error.status === 401 || error.code === 'ACCOUNT_SUSPENDED') return false;
    throw error;
  }
}

export async function authenticate(path, body) {
  if (path !== '/auth/login' && path !== '/auth/register') {
    throw new Error('Ruta de autenticacion no admitida');
  }
  const expectedVersion = changeLocalSession({ blockRenewal: true });
  return withAuthLock(async () => {
    assertCurrent(expectedVersion);
    const { response, json } = await authRequest(path, body);
    assertCurrent(expectedVersion);
    if (!response.ok) throw responseError(json, response.status);
    accessToken = validAccess(json);
    renewalBlocked = false;
    pendingLogoutToken = null;
    rememberLogout(false);
    announceSessionChange();
    return json;
  });
}

export async function logoutSession() {
  // Invalida inmediatamente la memoria y las respuestas que aún están en vuelo.
  // La petición espera a cualquier login/refresh anterior para revocar su cookie.
  const revokeToken = accessToken || pendingLogoutToken;
  pendingLogoutToken = revokeToken;
  changeLocalSession({ blockRenewal: true });
  rememberLogout(true);
  announceSessionChange();
  return withAuthLock(async () => {
    try {
      const { response, json } = await authRequest('/auth/logout', {}, revokeToken);
      if (!response.ok) throw responseError(json, response.status);
      rememberLogout(false);
      if (pendingLogoutToken === revokeToken) pendingLogoutToken = null;
      return json;
    } catch (cause) {
      // No se afirma una revocación que el servidor no ha confirmado.
      throw Object.assign(new Error(
        'No se pudo confirmar el cierre de sesion en el servidor. Vuelve a pulsar Cerrar sesion.'
      ), { code: 'LOGOUT_UNCONFIRMED', status: cause.status || 0, cause });
    }
  });
}

async function raw(method, path, body, retry = true) {
  if (method === 'POST' && (path === '/auth/login' || path === '/auth/register')) {
    return authenticate(path, body);
  }
  if (method === 'POST' && path === '/auth/logout') return logoutSession();
  const expectedVersion = sessionVersion;
  const sentAccessToken = accessToken;
  const authPath = path.startsWith('/auth/');
  if (!authPath && renewalBlocked) throw sessionChangedError();

  const response = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(sentAccessToken ? { Authorization: `Bearer ${sentAccessToken}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(response);
  assertCurrent(expectedVersion);
  if (response.ok) return json;

  if (response.status === 401 && !authPath) {
    if (retry) {
      // Otra petición pudo renovar mientras llegaba este 401 tardío.
      if (accessToken && accessToken !== sentAccessToken) {
        return raw(method, path, body, false);
      }
      await tryRefresh(expectedVersion);
      assertCurrent(expectedVersion);
      return raw(method, path, body, false);
    }
    invalidateSession(expectedVersion);
  } else if (!authPath && json?.error?.code === 'ACCOUNT_SUSPENDED') {
    invalidateSession(expectedVersion);
  }
  throw responseError(json, response.status);
}

export const api = {
  get: path => raw('GET', path),
  post: (path, body) => raw('POST', path, body),
  put: (path, body) => raw('PUT', path, body),
  patch: (path, body) => raw('PATCH', path, body),
  del: (path, body) => raw('DELETE', path, body),
};

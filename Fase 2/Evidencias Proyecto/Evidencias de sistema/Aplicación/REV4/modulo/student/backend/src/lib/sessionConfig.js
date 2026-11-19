// APR-77. Configuración explícita; no se deducen dominios de Host/proxy.
const loopback = (host) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
const envBoolean = (name, fallback) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} debe ser true o false.`);
  return value === 'true';
};

export function readSessionConfig() {
  const origins = String(process.env.AUTH_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of origins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('AUTH_ALLOWED_ORIGINS contiene un origen inválido.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      throw new Error('AUTH_ALLOWED_ORIGINS requiere orígenes exactos sin ruta, credenciales o comodines.');
    }
    if (url.protocol === 'http:' && !loopback(url.hostname)) {
      throw new Error('AUTH_ALLOWED_ORIGINS solo permite HTTP para loopback local.');
    }
  }
  const secure = envBoolean('AUTH_COOKIE_SECURE', true);
  const sameSite = String(process.env.AUTH_COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('AUTH_COOKIE_SAME_SITE inválido.');
  if (!secure && (process.env.NODE_ENV === 'production' || !loopback(process.env.HOST || '') ||
      !origins.length || origins.some(origin => !loopback(new URL(origin).hostname)))) {
    throw new Error('AUTH_COOKIE_SECURE=false requiere entorno no productivo, HOST loopback y solo orígenes loopback explícitos.');
  }
  if (sameSite === 'none' && !secure) throw new Error('SameSite=None requiere Secure.');
  const refreshTtl = Number(process.env.JWT_REFRESH_TTL || 2592000);
  if (!Number.isSafeInteger(refreshTtl) || refreshTtl < 60 || refreshTtl > 2592000) {
    throw new Error('JWT_REFRESH_TTL debe estar entre 60 y 2592000 segundos.');
  }
  return Object.freeze({ origins: Object.freeze([...new Set(origins)]), secure, sameSite, refreshTtl,
    cookieName: 'aprueba_refresh', cookiePath: '/api/v1/auth', concurrencyWindowMs: 5000 });
}

export const sessionConfig = readSessionConfig();

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && sessionConfig.origins.includes(origin);
}

export function isLocalPeer(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
}

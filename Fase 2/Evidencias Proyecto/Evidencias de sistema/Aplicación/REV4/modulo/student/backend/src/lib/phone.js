// Utilidades de telefono: normalizacion a E.164 y deteccion de pais/idioma
// a partir del prefijo (alimenta la pantalla confirm-locale del wireframe).
import { COUNTRIES, findCountry } from '../data/catalog.js';

// Quita espacios, guiones y parentesis. Exige prefijo internacional.
export function normalizePhone(input) {
  const raw = String(input || '').trim().replace(/[\s().-]/g, '');
  if (!raw) return null;
  const e164 = raw.startsWith('+') ? raw : `+${raw}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

// Devuelve el pais soportado cuyo dialCode calza con el numero (mas largo primero).
export function countryFromPhone(e164) {
  const candidates = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  return candidates.find((c) => String(e164 || '').startsWith(c.dialCode)) || null;
}

// { country, language } detectados; si el prefijo no esta soportado devuelve nulls.
export function detectLocale(e164) {
  const c = countryFromPhone(e164);
  return {
    country: c?.code || null,
    language: c?.defaultLanguage || null,
    dialCode: c?.dialCode || null,
    supported: !!c,
  };
}

// Enmascara el numero dejando solo el prefijo y los ultimos 4: +56*****5678
export function maskPhone(e164) {
  const s = String(e164 || '');
  if (s.length < 8) return s;
  const head = s.slice(0, 3); // '+' + codigo de pais corto
  return `${head}${'*'.repeat(s.length - head.length - 4)}${s.slice(-4)}`;
}

export function languageForCountry(code, fallback = 'es') {
  return findCountry(code)?.defaultLanguage || fallback;
}

// Catalogo educativo por pais (paises, grados/pruebas y asignaturas por grado).
// Es la fuente de verdad del onboarding de la app (pantallas confirm-locale,
// select-grade y select-tests del wireframe Aprueba_App.html), que antes vivia
// hardcodeada en el cliente (EDUCATION_CATALOG / getAvailableTests).

export const COUNTRIES = [
  {
    code: 'CL', dialCode: '+56', flag: '🇨🇱',
    name: { es: 'Chile', en: 'Chile' },
    languages: ['es', 'en'], defaultLanguage: 'es', currency: 'CLP',
  },
  {
    code: 'UK', dialCode: '+44', flag: '🇬🇧',
    name: { es: 'Reino Unido', en: 'United Kingdom' },
    languages: ['en', 'es'], defaultLanguage: 'en', currency: 'GBP',
  },
];

// Conjuntos de asignaturas. `null` => se resuelven desde la coleccion `tests`
// (las pruebas PAES sembradas con preguntas reales).
export const SUBJECT_SETS = {
  'cl-school': [
    { id: 'language', label: { es: 'Lenguaje', en: 'Language' }, color: '#1A365D' },
    { id: 'maths', label: { es: 'Matematica', en: 'Maths' }, color: '#10B981' },
    { id: 'science', label: { es: 'Ciencias', en: 'Science' }, color: '#6366F1' },
    { id: 'history', label: { es: 'Historia', en: 'History' }, color: '#F5B041' },
  ],
  'cl-paes': null,
  'uk-school': [
    { id: 'eng', label: { es: 'English', en: 'English' }, color: '#1A365D' },
    { id: 'maths', label: { es: 'Maths', en: 'Maths' }, color: '#10B981' },
    { id: 'science', label: { es: 'Science', en: 'Science' }, color: '#6366F1' },
    { id: 'history', label: { es: 'History', en: 'History' }, color: '#F5B041' },
  ],
  'uk-exam': [
    { id: 'eng-lang', label: { es: 'English Language', en: 'English Language' }, color: '#1A365D' },
    { id: 'eng-lit', label: { es: 'English Literature', en: 'English Literature' }, color: '#10B981' },
    { id: 'maths', label: { es: 'Maths', en: 'Maths' }, color: '#6366F1' },
    { id: 'sciences', label: { es: 'Sciences', en: 'Sciences' }, color: '#F5B041' },
    { id: 'history', label: { es: 'History', en: 'History' }, color: '#EF4444' },
  ],
};

// Etiquetas EN de las pruebas PAES (la coleccion `tests` solo trae ES).
export const TEST_LABELS_EN = {
  lectora: 'Reading comprehension',
  m1: 'Maths M1',
  m2: 'Maths M2',
  cien: 'Science',
  hist: 'History & social sciences',
};

const range = (n, from = 1) => Array.from({ length: n }, (_, i) => i + from);

export const GRADE_GROUPS = {
  CL: [
    {
      key: 'primary', label: { es: 'Educacion basica', en: 'Primary education' },
      items: range(8).map((n) => ({
        id: `cl-basic-${n}`, kind: 'school', subjectSet: 'cl-school',
        label: { es: `${n}º Basico`, en: `Year ${n}` },
      })),
    },
    {
      key: 'secondary', label: { es: 'Educacion media', en: 'Secondary education' },
      items: range(4).map((n) => ({
        id: `cl-media-${n}`, kind: 'school', subjectSet: 'cl-school',
        label: { es: `${n}º Medio`, en: `Secondary ${n}` },
      })),
    },
    {
      key: 'entrance', label: { es: 'Prueba de acceso', en: 'University entrance' },
      items: [{ id: 'cl-paes', kind: 'exam', subjectSet: 'cl-paes', label: { es: 'PAES', en: 'PAES' } }],
    },
  ],
  UK: [
    {
      key: 'primary', label: { es: 'Primary school', en: 'Primary school' },
      items: range(6).map((n) => ({
        id: `uk-year-${n}`, kind: 'school', subjectSet: 'uk-school',
        label: { es: `Year ${n}`, en: `Year ${n}` },
      })),
    },
    {
      key: 'secondary', label: { es: 'Secondary school', en: 'Secondary school' },
      items: range(5, 7).map((n) => ({
        id: `uk-year-${n}`, kind: 'school', subjectSet: 'uk-school',
        label: { es: `Year ${n}`, en: `Year ${n}` },
      })),
    },
    {
      key: 'sixth-form', label: { es: 'Sixth form', en: 'Sixth form' },
      items: [12, 13].map((n) => ({
        id: `uk-year-${n}`, kind: 'school', subjectSet: 'uk-school',
        label: { es: `Year ${n}`, en: `Year ${n}` },
      })),
    },
    {
      key: 'qualifications', label: { es: 'National qualifications', en: 'National qualifications' },
      items: [
        { id: 'uk-gcse', kind: 'exam', subjectSet: 'uk-exam', label: { es: 'GCSE', en: 'GCSE' } },
        { id: 'uk-a-levels', kind: 'exam', subjectSet: 'uk-exam', label: { es: 'A levels', en: 'A levels' } },
      ],
    },
  ],
};

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export function findCountry(code) {
  return COUNTRIES.find((c) => c.code === String(code || '').toUpperCase()) || null;
}

export function allGrades(countryCode) {
  return (GRADE_GROUPS[String(countryCode || '').toUpperCase()] || []).flatMap((g) => g.items);
}

export function findGrade(gradeId) {
  for (const code of COUNTRY_CODES) {
    const g = allGrades(code).find((x) => x.id === gradeId);
    if (g) return { ...g, country: code };
  }
  return null;
}

// Localiza un objeto { es, en } segun el idioma pedido.
export function loc(value, lang = 'es') {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value[lang] || value.es || value.en || null;
}

import { assertTestDataEnvironment } from '../lib/testDataSafety.js';
// Driver de datos en memoria con persistencia en disco (./.data/db.json).
// Permite ejecutar el backend sin Firebase. Cada coleccion es un objeto { id: doc }.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let store = {};

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[memory] no se pudo leer db.json:', e.message);
    store = {};
  }
}
function persist(next) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${DB_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, DB_FILE);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    // Una revocación que no se guardó no puede responder como exitosa.
    throw error;
  }
}
load();

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const colObj = (name) => (store[name] ||= {});
let writes = Promise.resolve();
function exclusive(fn) {
  const job = writes.then(fn);
  writes = job.catch(() => {});
  return job;
}
function commit(next) {
  persist(next);
  store = next;
}

export const memoryDriver = {
  async list(name) {
    return Object.values(colObj(name)).map(clone);
  },
  async get(name, id) {
    const d = colObj(name)[id];
    return d ? clone(d) : null;
  },
  async set(name, id, data) {
    return exclusive(() => {
      const next = clone(store);
      (next[name] ||= {})[id] = { ...clone(data), id };
      commit(next);
      return clone(next[name][id]);
    });
  },
  async patch(name, id, partial) {
    return exclusive(() => {
      const cur = colObj(name)[id];
      if (!cur) return null;
      const next = clone(store);
      next[name][id] = { ...cur, ...clone(partial), id };
      commit(next);
      return clone(next[name][id]);
    });
  },
  async del(name, id) {
    return exclusive(() => {
      const next = clone(store);
      delete (next[name] ||= {})[id];
      commit(next);
    });
  },
  async reset(seedData) {
    assertTestDataEnvironment('reset');
    return exclusive(() => commit(clone(seedData)));
  },
  // Solo para sesiones: todas las lecturas y escrituras comparten el mismo
  // turno exclusivo. No es un almacén apto para varios procesos/servidores.
  async authTransaction(fn) {
    return exclusive(async () => {
      const next = clone(store);
      let changed = false;
      const result = await fn({
        get: async (name, id) => clone(next[name]?.[id] || null),
        set: (name, id, data) => {
          (next[name] ||= {})[id] = { ...clone(data), id };
          changed = true;
        },
      });
      if (changed) commit(next);
      return result;
    });
  },
};

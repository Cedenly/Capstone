import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {effectivePlan} from './entitlements_original.mjs';
const r=JSON.parse(await fs.readFile(new URL('./Resultado_limite_acceso.json',import.meta.url),'utf8'));
const bytes=await fs.readFile(new URL('./entitlements_original.mjs',import.meta.url));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),r.source.sha256);
for(const c of r.results)assert.equal(effectivePlan(c.user,c.now),c.expected,c.id);
console.log(`${r.results.length} comprobaciones locales correctas. No se contactaron servicios externos.`);

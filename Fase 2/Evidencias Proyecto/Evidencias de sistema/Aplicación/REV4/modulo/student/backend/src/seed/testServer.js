import { once } from 'node:events';
import { assertTestDataEnvironment } from '../lib/testDataSafety.js';

// Solo lo usan smoke/dump tras validar que la carga de datos es local.
export const TEST_ORIGIN = 'http://127.0.0.1:5174';

export async function startTestServer(port) {
  assertTestDataEnvironment('prueba HTTP');
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.AUTH_ALLOWED_ORIGINS = TEST_ORIGIN;
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.AUTH_COOKIE_SAME_SITE = 'lax';
  const { server } = await import('../index.js');
  if (!server.listening) await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/api/v1`;
}

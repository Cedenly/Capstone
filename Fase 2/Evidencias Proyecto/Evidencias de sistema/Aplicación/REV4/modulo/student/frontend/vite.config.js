import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Las llamadas /api van al backend Express del alumno.
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
});

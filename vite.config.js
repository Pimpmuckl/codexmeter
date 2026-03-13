import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget =
  process.env.VITE_CODEXMETER_API_URL ||
  process.env.CODEXMETER_API_URL ||
  'http://127.0.0.1:3210';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_CODEXMETER_API_URL': JSON.stringify(apiTarget),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': apiTarget,
    },
  },
});

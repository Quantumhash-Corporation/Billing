import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The API port lives in the project's root .env, next to the server's settings.
  const env = loadEnv(mode, '..', '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': `http://localhost:${env.SERVER_PORT || 4600}` },
    },
  };
});

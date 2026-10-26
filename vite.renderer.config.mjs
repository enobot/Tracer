import { defineConfig } from 'vite';
import { buildContentSecurityPolicy } from './src/security-policy.mjs';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: false,
  },
  plugins: [
    {
      name: 'tracer-content-security-policy',
      apply: 'build',
      transformIndexHtml(html) {
        const policy = buildContentSecurityPolicy();
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  ],
});

import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// The `key` pins the unpacked extension ID to hfbincjmdcgfhffnpanjdfcccpejdkei.
// The Claude Code native-messaging host whitelists that exact ID, so it must not
// change between reloads. Public half of a throwaway keypair; not a secret.
//
// The Chrome Web Store assigns its own ID and packages carrying `key` can be
// rejected on upload, so `--mode store` drops it. The bridge installer
// allowlists both IDs, so either build can talk to it.
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7Ecffx9/wCqGJl7zBFlMuvOMD+LVHyxMaLpFcCxg6LljDRU2NH/GnXFNjVgQv9jzfwYk9C3pIXtR68/mQ4YDcGy3RwLL39IeF+oabqOZQN2SDWIJCsLFapvlZwsaKMEiQ1DrPW5EqDR39VOk70y0vFFtmhX9WrLh5yYtUX4NVDxCVG6MNVfTIC21jDkrVOAYHx69gaB7RGfz0DRAAF4r9dXiOjJZLu0fVfw/wVRoVTK7AgkZ5Lu9MLe2GY9qoP9GlQPcnWGknDhCkpjBFtFYPVXCIYGoS5XVplLO/d4oaPX96ICMKaubISWHeGBuduA5w4klIO/ITsJmbFeKkW5gowIDAQAB';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => ({
    name: 'Skillo - Resume Tailor',
    description:
      'Tailor your Overleaf LaTeX resume to a job posting using your own LLM API key or local Claude Code.',
    ...(mode === 'store' ? {} : { key: DEV_PUBLIC_KEY }),
    minimum_chrome_version: '116',
    permissions: ['storage', 'sidePanel', 'scripting', 'tabs', 'offscreen'],
    optional_permissions: ['nativeMessaging'],
    host_permissions: [
      'https://*.linkedin.com/*',
      'https://www.overleaf.com/*',
      'https://openrouter.ai/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
    ],
    action: {
      default_title: 'Open Skillo',
    },
  }),
});

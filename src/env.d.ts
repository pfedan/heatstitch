// Set by vite.config.ts from src/build/version.ts; absent in tests that don't go through the build.
interface ImportMetaEnv {
  readonly APP_VERSION?: string;
  readonly APP_CHANNEL?: 'release' | 'beta' | 'preview' | 'dev';
}

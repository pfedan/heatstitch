import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import DurationSequencer from './tests/sequencer';

// The app's config, and the test files split over the CI machines by how long they run
// (tests/sequencer.ts). Kept apart so the site build does not load the test runner.
// Worktrees of parallel work under .claude/ are other checkouts with their own copy of the tests.
export default mergeConfig(viteConfig, defineConfig({ test: { exclude: [...configDefaults.exclude, '.claude/**'], sequence: { sequencer: DurationSequencer } } }));

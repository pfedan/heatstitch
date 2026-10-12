import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import DurationSequencer from './tests/sequencer';

// The app's config, and the test files split over the CI machines by how long they run
// (tests/sequencer.ts). Kept apart so the site build does not load the test runner.
export default mergeConfig(viteConfig, defineConfig({ test: { sequence: { sequencer: DurationSequencer } } }));

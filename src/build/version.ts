/**
 * Which version a build is and where it runs, decided when the site is built (vite.config.ts) and
 * shown in the app (src/ui/version.ts). There is no version in package.json to keep up to date: a
 * release is a git tag (vX.Y.Z), so a release build shows that tag and every other build the last
 * release and how many commits came after it.
 *
 *   release   heatstitch.app, built from a published release (.github/workflows/release.yml)
 *   beta      beta.heatstitch.app, built from develop on every merge
 *   preview   the address of one pull request
 *   dev       a local build or the dev server
 */

import { execFileSync } from 'node:child_process';

export type Channel = 'release' | 'beta' | 'preview' | 'dev';

const CHANNELS: readonly Channel[] = ['release', 'beta', 'preview', 'dev'];

/** The channel from CHANNEL, or preview for PREVIEW=1 (the pull request builds), else dev. */
export function buildChannel(env: Record<string, string | undefined>): Channel {
  const c = env.CHANNEL as Channel | undefined;
  if (c && CHANNELS.includes(c)) return c;
  if (c) throw new Error(`CHANNEL=${c} is not one of ${CHANNELS.join(', ')}`);
  return env.PREVIEW ? 'preview' : 'dev';
}

/**
 * The version from `git describe --tags`: "v1.4.0" is 1.4.0, "v1.4.0-23-gabc1234" (23 commits after
 * it) is 1.4.0+23. Without any release tag yet it is 0.0.0, with the commits counted if git says how many.
 */
export function versionFromDescribe(describe: string | null, commits = 0): string {
  const m = describe && /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)(?:-(\d+)-g[0-9a-f]+)?$/.exec(describe.trim());
  if (!m) return commits ? `0.0.0+${commits}` : '0.0.0';
  return m[2] && m[2] !== '0' ? `${m[1]}+${m[2]}` : m[1];
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The version of this build: HEATSTITCH_VERSION (set by the release workflow, without the v), else from git. */
export function buildVersion(env: Record<string, string | undefined>): string {
  if (env.HEATSTITCH_VERSION) return env.HEATSTITCH_VERSION.replace(/^v/, '');
  const describe = git(['describe', '--tags', '--match', 'v[0-9]*']);
  return versionFromDescribe(describe, describe ? 0 : Number(git(['rev-list', '--count', 'HEAD']) ?? 0));
}

// The site left at the old address pfedan.github.io/heatstitch/ after the move to heatstitch.app,
// published to the gh-pages branch by .github/workflows/deploy.yml. Every page the old site had is the
// moving page (index.html here), GitHub Pages shows it for any other path as 404.html, and sw.js
// replaces the app's service worker. Usage: node tools/moved/build.mjs [out-dir, default dist-moved]
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] ?? 'dist-moved';
const pages = ['index.html', 'docs.html', 'videos.html', 'de/index.html', 'de/docs.html', 'de/videos.html', '404.html'];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'de'), { recursive: true });
for (const page of pages) copyFileSync(join(here, 'index.html'), join(out, page));
copyFileSync(join(here, 'sw.js'), join(out, 'sw.js'));
// Without it, Pages runs Jekyll over the branch.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`moving site written to ${out}/`);

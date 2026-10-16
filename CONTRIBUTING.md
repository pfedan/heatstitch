# Contributing to heatstitch

Thanks for helping. Bug reports, embroidery files that load or check wrongly, translations and pull
requests are all welcome. By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE) of this project.

## Reporting a problem

Open an issue and include:

- what you did, what you expected and what happened instead
- browser and operating system
- the file, if you can share it (zip it if GitHub refuses the extension). If you can't share it,
  the format (DST/PES, PES version) and the software that wrote it help a lot
- for validation or correction issues: the chosen fabric and thread, and a screenshot

The app runs entirely in the browser, so nothing about your file reaches us unless you attach it.

For maintainers: a session can be recorded and replayed to reproduce a bug (`heatstitch.record()`
in the browser console, then save the project); see [docs/aufzeichnung.md](docs/aufzeichnung.md).

## Setup

You need Node.js 22 (the version CI uses) and npm.

```sh
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript only
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build: http://localhost:4173/
```

There is no backend and no separate lint step; `tsc` in strict mode is the gate.

For a map of the codebase (layers, data model, data flow, workers, tests) read
[ARCHITECTURE.md](ARCHITECTURE.md) first.

## Making a change

1. Fork the repository (or create a branch if you have write access) and branch off `develop`, the
   default branch. `main` only follows the releases.
2. Keep a pull request to one topic. Refactorings that are not needed for the change go in their own PR.
3. Run `npm test` and `npm run build` before pushing. CI runs exactly these two.
4. Open the pull request against `develop`. Start its title with its type (see below), describe what a
   user sees before and after, and add a screenshot for visible changes. A change a user notices also
   gets a line in both languages under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
5. Pull requests are merged with a merge commit or squashed; please don't force-push once a
   review has started.

### Code style

- TypeScript, ES modules, no framework. Follow the style of the surrounding code: small modules,
  named exports, two-space indentation, single quotes.
- Comments explain *why*, not *what*. Keep them short.
- No new runtime dependencies without discussing it in an issue first. The app is meant to stay
  small and work offline.
- Files never leave the user's machine. Don't add network calls, analytics or uploads.

### Commits and pull request titles

Write the subject in the imperative, in English, under about 70 characters
(for example `Pick examples from a small dropdown`). Add a body when the reason is not obvious.

A pull request's title starts with its type, as in [Conventional Commits](https://www.conventionalcommits.org/):
`feat: Pick examples from a small dropdown`. A check fails on a title without one. The type sets the
label that decides where the change goes in the release notes and which number the next version gets:

| Title starts with | Label | Next version |
|---|---|---|
| `feat:` | `feature` | minor (1.4.0 → 1.5.0) |
| `fix:` | `fix` | patch (1.4.0 → 1.4.1) |
| `feat!:` (something users rely on goes away) | `breaking` | major (1.4.0 → 2.0.0) |
| `chore:`, `refactor:`, `docs:`, `test:`, `ci:`, `build:`, `perf:`, `style:` | `intern` | not in the notes |

A label can be changed by hand on the pull request. A new project file format is a feature, not a
breaking change: newer versions open older files.

## Tests

Tests live in `tests/` and run with Vitest in Node (no browser; only `tests/langSwitch.test.ts`
opens one, see App texts below).

- Fixtures are generated synthetically (`tests/helpers/encode.ts`, `shapes.ts`, `designs.ts`), so
  tests don't depend on binary files. Prefer building a small synthetic pattern over adding a file.
- Parsers and writers: round trips read → write → read must stay record-equal
  (`tests/writers.test.ts`). A change to a writer needs a test there.
- Validation and correction: assert on the finding or result a user would see, e.g. that a zone is
  critical or that the correction removes it without making the area worse.
- Density: the grid must sum exactly to the total thread length or stitch count.

### Demo files

The guide's demo files in `public/examples/demos/` are written by the app's own writers from
`tests/helpers/demos.ts`. `tests/demos.test.ts` fails when they are out of date or no longer show the
finding the guide describes. After changing the designs, a writer or anything that changes their
bytes, regenerate them and commit the result:

```sh
UPDATE_DEMOS=1 npm test
```

### Tooltip pictures

Some tooltips show a small screenshot (`data-tip-img`, pictures in `public/tips/`). They are taken
from the app itself by `tools/tips/shoot.mjs`. After a change that alters how they look, take them
anew from a running build:

```sh
npm run build && npm run preview   # in a second shell
node tools/tips/shoot.mjs          # or only some: node tools/tips/shoot.mjs echo shadow
```

### Fonts

The lettering fonts in `public/fonts/` are converted from the Ink/Stitch font repository, at a fixed
commit, by `tools/fonts/convert.mjs`. It checks each font's license, skips what heatstitch cannot sew
yet and writes the fonts, their licenses and the catalog `index.json`. To update them:

```sh
git clone https://github.com/inkstitch/embroidery-fonts /tmp/embroidery-fonts
node tools/fonts/convert.mjs /tmp/embroidery-fonts/src <commit>
```

Ink/Stitch's code is GPL: read it to understand the font format, but never copy from it.

### Motifs

The motif library in `public/library/` is built from Twemoji (CC BY 4.0) with the CLDR names of
emojibase-data (MIT) by `tools/library/build.mjs`; `tools/library/check.mjs` then sews every motif in
the app's own code and leaves out the ones Prüfen shows red for (listed in
`tools/library/excluded.json`, which the next build leaves out too). Sources go in only under CC0,
CC BY, OFL or a license like MIT, never GPL or non-commercial. To update:

```sh
git clone --depth 1 https://github.com/jdecked/twemoji /tmp/twemoji
npm pack emojibase-data@17.0.0 && tar xzf emojibase-data-17.0.0.tgz -C /tmp
node tools/library/build.mjs /tmp/twemoji /tmp/package <commit>
node tools/library/check.mjs        # takes a while; PAGES=4 sews four at a time
```

## Pull request previews

Every pull request is built and uploaded as a preview version of the site, at
`https://pr-N-heatstitch.<account>.workers.dev`. A bot comment on the PR links it. Pull requests from
forks get theirs once their run has been approved (`.github/workflows/fork-preview.yml`). When the PR
is closed, its address shows a short note that leads to heatstitch.app instead (`cloudflare/closed/`).

A preview has an address of its own, so it shares nothing with heatstitch.app: no stored files, no
settings, no service worker. `CHANNEL=preview` (or `PREVIEW=1`, set by the workflow) marks the build: it
ships no service worker, so a reload always shows the latest push, and it is marked `noindex`. The beta
is built with `CHANNEL=beta` (`noindex`, a badge beside the logo), a release with `CHANNEL=release` and
`HEATSTITCH_VERSION`. To build a preview locally:

```sh
PREVIEW=1 npm run build
```

## Releases

heatstitch follows [Semantic Versioning](https://semver.org/). Work goes into `develop`, which is live at
<https://beta.heatstitch.app/> after every merge; heatstitch.app only changes with a release.

- **The draft.** With every merge into `develop`, `.github/workflows/release-drafter.yml` updates a draft
  release on GitHub: its version (from the labels since the last release) and the list of pull requests.
- **The notes.** [CHANGELOG.md](CHANGELOG.md) holds the notes for people who use heatstitch, in German and
  English, under `[Unreleased]` until the release. The build makes the page *What is new*
  (`releases.html`, `de/releases.html`) from it; the beta shows `[Unreleased]` there as *New in the beta*.
- **Releasing.** Before publishing, rename `[Unreleased]` to the draft's version with today's date and put
  an empty `[Unreleased]` on top (a small `docs:` pull request). Then publish the draft. Publishing tags
  the newest `develop` commit; `.github/workflows/release.yml` waits for its checks, builds it with its
  version, deploys it to heatstitch.app, puts the CHANGELOG section on top of the release's list and moves
  `main` to it. A release published without renaming still works: it shows the `[Unreleased]` notes under
  its number, and the next notes pull request does the renaming.
- **A pre-release** (a tag like `v1.2.0-rc.1`, marked *pre-release*) goes to the beta only, to try the
  release workflow out.
- **A hotfix**, when heatstitch.app needs a fix and `develop` is not ready to release: the fix is merged
  into `develop` as usual, then cherry-picked onto a branch from the last release tag, merged into `main`
  through a pull request, and released with the next patch number and `main` as the target. The next
  regular release merges `develop` into `main`.

## English and German

The app and the guide are bilingual. Every user-facing change ships in both languages in the same
pull request. If you only speak one of them, say so in the PR and leave a best effort; a maintainer
will polish it.

### App texts (i18n)

- All strings live in `src/i18n/de.ts` and `src/i18n/en.ts`. `de.ts` defines the keys; `en.ts` is
  typed as `Record<keyof typeof de, string>`, so a missing or extra key fails the typecheck.
- Never hard-code user-facing text in TypeScript or HTML. Use `t('key', { vars })` in code and
  `data-i18n`, `data-i18n-title` or `data-i18n-aria` attributes in markup.
- The language switches without a reload. Markup with `data-i18n` follows on its own; a part that
  writes text with `t()` and keeps it (a panel, a card, a menu, a hint) draws it anew in
  `onLangChange(...)`, registered in its constructor. A cache key that skips redrawing would
  otherwise keep the old language. `tests/langSwitch.test.ts` switches in a real browser in several
  states and fails on any text of the old language left on the page; add a state there for a new
  panel: `BROWSER_TESTS=1 npx vitest run tests/langSwitch.test.ts` (needs
  `npx playwright install chromium`).
- Keys are dotted and grouped by area (`files.example.cat`, `controls.metric`). Add new keys next to
  related ones in both files, in the same order.
- Placeholders use `{name}` and must appear in both languages.
- Use the established terms. German: *Stickmuster, Objekt, Form, Sprung, Fadenschnitt, Einstich,
  Füllung, Satin, Steppstich, Unterlage, Ablauf, Dichte*; English: *design, object, shape, jump,
  trim, needle point, fill, satin, running stitch, underlay, Sequence, Density*. The full list with
  the reasons is in [docs/terms.md](docs/terms.md).

### Guide (`docs.html`)

- The guide has one `<article lang="en">` and one `<article lang="de">`. Both must cover the same
  sections in the same order; change them together.
- Screenshots go to `public/guide/` as JPEG. Screenshots that show UI text exist per language
  (`name-en.jpg`, `name-de.jpg`); images without text (`kinds.jpg`, `stitchplan.jpg`) are shared.
- Give every image `width`, `height` and a descriptive `alt` in the article's language, and
  `loading="lazy"` except for the first one.
- Take screenshots from the realistic thread view where it helps, and from the demo files, so they
  can be reproduced.
- `tools/guide-shots.mjs` takes the per-language screenshots with Playwright from the built app
  (1280 px wide, dark scheme). After a UI change, rebuild, start the preview and run it; it writes
  straight into `public/guide/`. Shots are named like the files they produce, so one or more names
  limit the run:

  ```sh
  npm run build && npm run preview &
  node tools/guide-shots.mjs            # all shots
  node tools/guide-shots.mjs cat hoop   # only these
  ```

  It needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or
  point `PLAYWRIGHT_CHROMIUM` at a Chrome binary). Look at every new image before committing it;
  the composite images (`patterns.jpg`, `guided.jpg`, `tolerance-*.jpg`) are assembled by hand.
- Use the terms of [docs/terms.md](docs/terms.md), as they appear in the app: German
  *Stickmuster* (the design), *Stickdatei* (the file), *Objekt*, *Form*, *Umriss*, *Stichart*,
  *Steppstich*, *Konturfüllung*, *Randlauf*, *Umrandung*, *Querlinie*, *Leitlinie*, *Stickrahmen*;
  English *design*, *embroidery file*, *object*, *shape*, *outline*, *stitch type*, *running
  stitch*, *contour fill*, *edge run*, *border*, *rung*, *guide line*, *hoop*. No long dashes.

### README

The README is in English only. Update it when you add a feature, change a rule or threshold, or
change how something is built or deployed.

## Questions

Open an issue or start a discussion in the pull request. Thanks for contributing!

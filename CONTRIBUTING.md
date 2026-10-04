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

## Setup

You need Node.js 22 (the version CI uses) and npm.

```sh
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript only
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build: http://localhost:4173/heatstitch/
```

There is no backend and no separate lint step; `tsc` in strict mode is the gate.

## Making a change

1. Fork the repository (or create a branch if you have write access) and branch off `main`.
2. Keep a pull request to one topic. Refactorings that are not needed for the change go in their own PR.
3. Run `npm test` and `npm run build` before pushing. CI runs exactly these two.
4. Open the pull request against `main`. Describe what a user sees before and after, and add a
   screenshot for visible changes.
5. Pull requests are merged with a merge commit or squashed; please don't force-push once a
   review has started.

### Code style

- TypeScript, ES modules, no framework. Follow the style of the surrounding code: small modules,
  named exports, two-space indentation, single quotes.
- Comments explain *why*, not *what*. Keep them short.
- No new runtime dependencies without discussing it in an issue first. The app is meant to stay
  small and work offline.
- Files never leave the user's machine. Don't add network calls, analytics or uploads.

### Commits

Write the subject in the imperative, in English, under about 70 characters
(for example `Pick examples from a small dropdown`). Add a body when the reason is not obvious.

## Tests

Tests live in `tests/` and run with Vitest in Node (no browser).

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

## Pull request previews

Every pull request from a branch in this repository is built and deployed to
`https://pfedan.github.io/heatstitch/pr-preview/pr-N/`. A bot comment on the PR links it, and the
preview is removed when the PR is closed. Pull requests from forks are tested and built, but get no
preview because the workflow can't write to the repository from a fork.

A preview shares the origin with the real site, so the build keeps them apart:

- `BASE_PATH` (set by the workflow) moves the build into the subfolder (`vite.config.ts`).
- The service worker is built self-destroying in previews, and the real site's worker never answers
  navigations under `/pr-preview/`.
- Stored files and settings get a per-preview namespace (`src/storage/namespace.ts`), so a preview
  never touches what the real site stored.
- Previews are marked `noindex`.

If your change touches paths, storage keys, the IndexedDB schema or the PWA setup, check it in the
preview as well as locally. To test a preview build locally:

```sh
BASE_PATH=/heatstitch/pr-preview/pr-0/ npm run build
```

## English and German

The app and the guide are bilingual. Every user-facing change ships in both languages in the same
pull request. If you only speak one of them, say so in the PR and leave a best effort; a maintainer
will polish it.

### App texts (i18n)

- All strings live in `src/i18n/de.ts` and `src/i18n/en.ts`. `de.ts` defines the keys; `en.ts` is
  typed as `Record<keyof typeof de, string>`, so a missing or extra key fails the typecheck.
- Never hard-code user-facing text in TypeScript or HTML. Use `t('key', { vars })` in code and
  `data-i18n`, `data-i18n-title` or `data-i18n-aria` attributes in markup.
- Keys are dotted and grouped by area (`files.example.cat`, `controls.metric`). Add new keys next to
  related ones in both files, in the same order.
- Placeholders use `{name}` and must appear in both languages.
- Use the established terms. German: *Sprung, Schnitt, Einstich, Füllung, Satin, Unterlage, Ablauf,
  Dichte*; English: *jump, trim, penetration, fill, satin, underlay, Sequence, Density*.

### Guide (`docs.html`)

- The guide has one `<article lang="en">` and one `<article lang="de">`. Both must cover the same
  sections in the same order; change them together.
- Screenshots go to `public/guide/` as JPEG. Screenshots that show UI text exist per language
  (`name-en.jpg`, `name-de.jpg`); images without text (`kinds.jpg`, `stitchplan.jpg`) are shared.
- Give every image `width`, `height` and a descriptive `alt` in the article's language, and
  `loading="lazy"` except for the first one.
- Take screenshots from the realistic thread view where it helps, and from the demo files, so they
  can be reproduced.

### README

The README is in English only. Update it when you add a feature, change a rule or threshold, or
change how something is built or deployed.

## Questions

Open an issue or start a discussion in the pull request. Thanks for contributing!

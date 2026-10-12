# Motifs of the library

The app's motif library (Motive) is built from these sources by `tools/library/build.mjs` and
checked by `tools/library/check.mjs`. When a motif is put in, the app turns it into stitches.

## Twemoji (`twemoji/`)

Graphics: Twemoji, © Twitter, Inc. and other contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: <https://github.com/jdecked/twemoji>, commit `b6b55fe`. The files are unchanged; only
emoji that make sense as an embroidery motif are taken, and those that do not pass Prüfen when sewn
are left out (`tools/library/excluded.json`).

Names and keywords (German and English): Unicode CLDR annotations as packaged by
[emojibase-data](https://github.com/milesj/emojibase) 17.0.0, MIT License, data © Unicode, Inc.
under the [Unicode License v3](https://www.unicode.org/license.txt).

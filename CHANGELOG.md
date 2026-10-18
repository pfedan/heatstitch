# Changelog

What changed in each version of heatstitch, newest first, for the people who use it. The site shows
it as "What is new" (releases.html, de/releases.html), and each GitHub release carries the same text.

How it is kept (see [CONTRIBUTING.md](CONTRIBUTING.md#releases)):

- Everything merged into `develop` that a user notices gets a line under `[Unreleased]`, in German and
  English, in plain words: what you can do now, not how it was built.
- Before a release, `[Unreleased]` is renamed to the new version with its date, and an empty
  `[Unreleased]` goes on top. A release published before that shows the `[Unreleased]` notes under its
  own number.
- Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions after
  [Semantic Versioning](https://semver.org/): a new feature raises the minor number, fixes alone the
  patch number, and the major number only goes up when a feature or a format to save in goes away.

## [Unreleased]

### Deutsch

- **Winkel auf der Fläche ziehen:** Den Winkel einer Füllung stellst du jetzt auch direkt auf dem Stickmuster ein: Knopf neben dem Winkel-Regler oder Taste W, dann eine Linie über die Fläche ziehen. Die Reihen laufen schon beim Ziehen quer dazu, so wie sie nacheinander gestickt werden, Umschalt rastet auf 15°, Esc bricht ab.
- **Probestück für deinen Stoff:** Unter Material erstellt ein Klick ein beschriftetes Raster aus Füllungen oder Satinringen, Zeilen nach Stichabstand, Spalten nach Zugausgleich, mit einer Sollkante zum Vergleichen. Stick es auf deinem Stoff, wähle in der App das Feld, das am besten aussieht, und neue Objekte auf diesem Stoff bekommen diese Werte.

### English

- **Drag the angle on the area:** You can now set a fill's angle right on the design: the button beside the angle slider or the W key, then drag a line over the area. The rows run across it while you drag, the way they are sewn one after the other, Shift snaps to 15°, Esc cancels.
- **Test swatch for your fabric:** Under Material one click makes a labelled grid of fills or satin rings, rows by stitch spacing, columns by pull compensation, with a nominal edge to compare against. Stitch it on your fabric, pick the cell that looks best in the app, and new objects on that fabric get those values.

## [1.0.0] - 2026-10-16

### Deutsch

Die erste Version mit Versionsnummer. Von hier an steht auf dieser Seite, was jede neue Version bringt.

- **Was ist neu:** Im Menü „Mehr“ steht jetzt die Versionsnummer, ein Klick führt zu dieser Seite.
- **Beta:** Wer Neues schon vor der nächsten Version ausprobieren möchte, findet den neuesten Stand auf [beta.heatstitch.app](https://beta.heatstitch.app/). Entwürfe dort sind getrennt von heatstitch.app; nimm sie als Projektdatei mit.

### English

The first version with a version number. From here on, this page says what each new version brings.

- **What is new:** The "More" menu now shows the version number; a click leads to this page.
- **Beta:** If you want to try new things before the next version, the newest state is at [beta.heatstitch.app](https://beta.heatstitch.app/). Designs there are kept apart from heatstitch.app; take them along as a project file.

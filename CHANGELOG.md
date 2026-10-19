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

- **Gleichmäßige Reihen bei 45°:** Bei 0°, 45°, 90° und ähnlichen Winkeln liegen die Reihen einer Füllung jetzt genau auf dem 0,1-mm-Raster, in dem jede Stickdatei Einstiche speichert. Bisher rundete jeder Einstich für sich, und bei 45° wirkten die Reihen paarweise. Der Abstand rückt dafür auf die nächste Rasterlinie, bei 45° zum Beispiel von 0,4 auf 0,42 mm.

### English

- **Even rows at 45°:** At 0°, 45°, 90° and similar angles the rows of a fill now lie exactly on the 0.1 mm grid every embroidery file saves needle points on. Until now each needle point was rounded on its own, and at 45° the rows looked paired. The spacing moves to the nearest grid line for it, at 45° for example from 0.4 to 0.42 mm.

## [1.1.0] - 2026-10-19

### Deutsch

- **Realistische Fäden per Taste:** Umschalt+R schaltet die realistische Ansicht ein oder aus, ohne das Ansicht-Menü zu öffnen.
- **Winkel auf der Fläche ziehen:** Den Winkel einer Füllung stellst du jetzt auch direkt auf dem Stickmuster ein: Knopf neben dem Winkel-Regler oder Taste W, dann eine Linie über die Fläche ziehen. Die Reihen laufen schon beim Ziehen quer dazu, so wie sie nacheinander gestickt werden, Umschalt rastet auf 15°, Esc bricht ab.
- **Probestück für deinen Stoff:** Unter Material erstellt ein Klick ein beschriftetes Raster aus Füllungen oder Satinringen, Zeilen nach Stichabstand, Spalten nach Zugausgleich, mit einer Sollkante zum Vergleichen. Stick es auf deinem Stoff, wähle in der App das Feld, das am besten aussieht, und neue Objekte auf diesem Stoff bekommen diese Werte. Die Zahlen sind in dreifachem Laufstich gestickt und bleiben so auch auf Frottee lesbar.
- **Schrift für kleine Texte:** Hershey Sans ist eine Schrift aus einer einzigen Linie, gestickt als dreifacher Laufstich. Sie bleibt schon ab 3 mm Höhe lesbar, wo eine Satinschrift zu schmal wird.
- **Verbindungen versteckt statt geschnitten:** Liegt der Weg zwischen zwei Objekten derselben Farbe ganz unter einer dichten Füllung, die später gestickt wird, läuft der Faden dort als Steppstich hin. Satin ab 2 mm Breite deckt auch (Säulen, Satinlinien und Satinränder). Das spart Schnitte und Zeit. Unter offenen oder lichten Mustern, schmalem oder lichtem Satin, Laufstichlinien und ausgesparten Stellen bleibt der Schnitt, weil man den Faden dort sehen würde. Versteckte Verbindungen stehen gepunktet in der Liste *Sprünge und Schnitte* und auf der Bühne; ein Klick wählt sie aus, *Schneiden und vernähen* setzt dort einen Schnitt, *Verstecken* nimmt ihn zurück. Einen Schnitt von Hand merkt sich das Objekt, auch nach Rückgängig und Speichern.
- **Abstand über zwei Reihen gezählt, dichtere Vorgabe:** Der Abstand einer Füllung zählt jetzt über zwei Reihen, hin und zurück, wie in gängiger Sticksoftware und wie beim Satin auf einer Seite. Die Vorgabe für Webware mit 40er Garn ist 0,4 mm, die Reihen liegen also 0,2 mm auseinander und damit dichter als bisher; die anderen Stoffe und die Grenzen beim Prüfen sind mitgezogen. Unter Material im Probestück kannst du eigene Werte für Abstand und Zugausgleich auch direkt eintragen.
- **Eingemessene Werte bleiben beim Stickmuster:** Ein Stickmuster speichert die Werte aus dem Probestück mit, so wird es in jedem Browser gleich digitalisiert, geprüft und abgestimmt. Unter Material steht, welche Werte gelten und ob sie vom Stoff kommen oder eingemessen sind. Misst du später neu, bietet das Panel die neuen Werte für das offene Stickmuster an, statt sie still zu übernehmen.
- **Enge Reihen teilen sich das Loch am Rand:** Wo Füllreihen höchstens 0,25 mm auseinanderliegen, enden zwei Reihen im selben Einstich und der Wendestich läuft schräg. So häufen sich am Rand keine Kurzstiche mehr, auch bei gebogenen Reihen in Wirbel, Strahlen und Kreisen.
- **Frottee, Kappe und Jeans:** Diese Stoffe vertragen beim Prüfen jetzt so viel Faden wie Webware, Frottee bekommt auch denselben Stichabstand (0,4 bis 0,5 mm statt 0,61 bis 0,78). Frottee und Kappen werden üblicherweise eher dichter gestickt, Jeans nicht lockerer; bisher kam dort zu früh Achtung.

### English

- **Realistic threads by key:** Shift+R turns the realistic view on or off without opening the View menu.
- **Drag the angle on the area:** You can now set a fill's angle right on the design: the button beside the angle slider or the W key, then drag a line over the area. The rows run across it while you drag, the way they are sewn one after the other, Shift snaps to 15°, Esc cancels.
- **Test swatch for your fabric:** Under Material one click makes a labelled grid of fills or satin rings, rows by stitch spacing, columns by pull compensation, with a nominal edge to compare against. Stitch it on your fabric, pick the cell that looks best in the app, and new objects on that fabric get those values. The numbers are sewn in triple running stitch, so they stay readable on terry too.
- **A font for small text:** Hershey Sans is a font of a single line, sewn as triple running stitch. It stays readable from 3 mm, where a satin font gets too narrow.
- **Connections hidden instead of trimmed:** Where the way between two objects of one color lies wholly under a dense fill sewn later, the thread runs there as a running stitch. Satin 2 mm wide or wider covers too (columns, satin lines and satin borders). That saves trims and time. Under open or light patterns, narrow or open satin, running lines and knocked-out parts the trim stays, because the thread would show there. Hidden connections show dotted in the *Jumps and trims* list and on the stage; a click selects one, *Trim and tie* cuts there, *Hide* takes it back. A trim set by hand stays with the object, through undo and saving too.
- **Spacing counted across two rows, denser default:** A fill's spacing now counts across two rows, there and back, as common embroidery software counts it and as a satin's on one side. The default on woven fabric with 40 wt thread is 0.4 mm, so the rows lie 0.2 mm apart, denser than before; the other fabrics and the limits of the check moved along. Under Material in the test swatch you can also type in your own values for spacing and pull compensation.
- **Measured values stay with the design:** A design saves the values from the test swatch with it, so it is digitized, checked and tuned the same in every browser. Under Material you see which values apply and whether they come from the fabric or were measured. Measure again later and the panel offers the new values for the open design instead of taking them silently.
- **Close rows share the hole at the edge:** Where fill rows lie 0.25 mm apart or less, two rows end in the same needle point and the turn runs slanted. Short stitches no longer pile up along the edge, also on the curved rows of swirls, rays and circles.
- **Terry, caps and denim:** These fabrics now take as much thread in the check as woven fabric, and terry gets the same spacing too (0.4 to 0.5 mm instead of 0.61 to 0.78). Terry and caps are usually stitched rather denser, denim not more openly; until now they reached Caution too soon.

## [1.0.0] - 2026-10-16

### Deutsch

Die erste Version mit Versionsnummer. Von hier an steht auf dieser Seite, was jede neue Version bringt.

- **Was ist neu:** Im Menü „Mehr“ steht jetzt die Versionsnummer, ein Klick führt zu dieser Seite.
- **Beta:** Wer Neues schon vor der nächsten Version ausprobieren möchte, findet den neuesten Stand auf [beta.heatstitch.app](https://beta.heatstitch.app/). Entwürfe dort sind getrennt von heatstitch.app; nimm sie als Projektdatei mit.

### English

The first version with a version number. From here on, this page says what each new version brings.

- **What is new:** The "More" menu now shows the version number; a click leads to this page.
- **Beta:** If you want to try new things before the next version, the newest state is at [beta.heatstitch.app](https://beta.heatstitch.app/). Designs there are kept apart from heatstitch.app; take them along as a project file.

# heatstitch

Stickdateien ansehen, prüfen und korrigieren, komplett im Browser (kein Backend, keine Uploads).

Zwei Modi, oben umschaltbar (Tasten 1 und 2):

- **Ablauf**: wie die Maschine die Datei abarbeitet. Farbblöcke als Ebenen (ausblenden, hervorheben),
  Stiche färben nach Garnfarbe, Reihenfolge, Stichart oder Stichlänge, Markierungen für Sprünge,
  Fadenschnitte, Farbwechsel, Start/Ende und Einstiche, ein Player mit geschätzter Nähzeit, und eine
  Liste der Sprünge, die sich einzeln oder nach Länge schneiden und vernähen oder ohne Schnitt
  mitziehen lassen.
- **Dichte**: Heatmap, Prüfung für Stoff und Garn, Korrektur (alles unten Beschriebene).

## Funktionen

- **Formate:** DST (Tajima) und PES (Brother, liest den PEC-Block)
- **Zwei Dichtemetriken**, per Umschalter:
  - *Garnlänge* in mm/mm²: jedes Stichsegment wird exakt auf die Rasterzellen verteilt, die es durchläuft
  - *Einstiche* in 1/mm²: Nadeleinstiche pro Fläche (Perforationsrisiko)
- Rasterzelle 0,5 bis 5 mm, optionale Gauss-Glättung
- Absolute Farbskala mit einstellbarem Maximum
- **Validierung** jeder geladenen Datei (Sicher / Vorsicht / Kritisch) für ein wählbares Material (Stoff × Garnstärke), mit orange/rotem Overlay, Gesamturteil und Zonenliste, siehe unten
- Ungetrimmte Sprünge optional als Garn zählen
- Stichplan-Overlay in Garnfarben, wahlweise als realistische Fäden mit Schattierung und Schatten, Sprünge gestrichelt
- Zoom (Mausrad, Pinch), Verschieben, Tooltip mit Dichte und Position
- Statistik: Stiche, Sprünge, Schnitte, Farbwechsel, Größe, Garnlänge, Max-Dichte
- Mehrere Dateien laden und umschalten (auch per Pfeiltasten oder j/k, `f` = Einpassen)
- PNG-Export der aktuellen Ansicht inkl. Legende
- **Korrektur:** automatisch nach Digitalisier-Praxis (Füllung unter Kanten zurückziehen, Kurzstiche in Satinkurven, gleichmäßig neu verteilen, Fokus Fadendichte oder Lochdichte, praxisübliche Funde und quittierte Zonen bleiben unangetastet) und von Hand (Einstiche wählen, verschieben, löschen, Auswahl ausdünnen), mit Rückgängig/Wiederholen und Vergleichsansicht Original/korrigiert, siehe unten
- **Speichern als DST oder PES** (eigene Writer, kein pyembroidery)
- Deutsch / Englisch
- PWA: installierbar, offline nutzbar, "Öffnen mit" für .dst/.pes
- Kurzanleitung auf Deutsch und Englisch (`docs.html`, Link "Anleitung" oben rechts)

## Validierung

Läuft automatisch, sobald eine Datei geladen ist, unabhängig von den Darstellungsreglern. Die Messung
(Web Worker) hängt nicht vom Material ab; die Einstufung schon, sie ist billig und läuft beim Wechsel
von Stoff oder Garn sofort für alle geladenen Dateien neu.

### Materialprofile

Die Grenzwerte gelten für 40 wt auf stabiler Webware und werden mit einem Faktor aus Stoff und Garn
skaliert (Verhältnis des empfohlenen Stichabstands zur Referenz 0,40 mm).

| Stoff | Faktor | empf. Abstand (40 wt) |
|---|---|---|
| Webware, stabil (Twill, Canvas, Denim) | 1,0 | 0,40 bis 0,45 mm |
| Kappe, strukturiert | 0,9 | 0,40 bis 0,50 mm |
| Strick, Fleece (Piqué, Jersey) | 0,85 | 0,42 bis 0,50 mm |
| Frottee, Flor | 0,65 | 0,55 bis 0,70 mm |
| Leicht, empfindlich (Seide, Batist) | 0,6 | 0,60 bis 0,70 mm |
| Leder, Kunstleder (+ Perforationsprüfung) | 0,7 | 0,50 bis 0,80 mm |

| Garn | 60 wt | 40 wt | 30 wt | 12 wt |
|---|---|---|---|---|
| Faktor (nach Madeira-Abstandstabelle) | 1,15 | 1,0 | 0,8 | 0,5 |

### Regeln

| Regel | Vorsicht | Kritisch |
|---|---|---|
| Garnlänge pro Fläche, Füllstich | ab 7,0 mm/mm² (ca. 3 Lagen) | ab 9,5 mm/mm² (4 Lagen) |
| Garnlänge pro Fläche, reiner Satin | ab 11 mm/mm² | ab 12 mm/mm² |
| Kurzstich-Häufung | ≥ 8 Stiche unter 1 mm in einer Zelle (Webware, Caps) | ≥ 8 (alle anderen Stoffe) |
| Perforation (nur Leder) | ≥ 6 Einstiche im Umkreis von 1 mm | ≥ 9 |

Dichtewerte jeweils × Profilfaktor. Eine Füllstichlage mit 0,4 mm Abstand hat 2,5 mm/mm², ein Satin
mit 0,4 mm Abstand (zwischen Einstichen auf derselben Seite) 5,0 mm/mm².

- **Raster:** feste 1-mm-Zellen. Die Dichte wird auf 0,2-mm-Unterzellen berechnet, mit σ = 0,6 mm
  geglättet; jede Zelle bekommt den **Spitzenwert** ihrer Unterzellen. So werden schmale Säulen
  (Schrift, Ränder) nicht mit ihrer leeren Umgebung weggemittelt; gleichmäßige Füllflächen lesen
  sich höchstens etwa 7 % über ihrem Nennwert.
- **Schwellen liegen zwischen typischen Aufbauten**, damit nicht die Rasterlage entscheidet: zwei
  Füllflächen mit Unterlage erreichen bis 6,4, drei Lagen ab 7,4, vier Lagen ab 9,95, ein Satinrand
  über einer Füllfläche (beide mit Unterlage) bis 9,0.
- **Satin:** liegt oben auf und sticht nur an den Kanten ein. Die Grenzen einer Zelle werden linear
  nach ihrem Satinanteil zwischen Füllstich- und Satinwerten interpoliert (Satin = Zickzack-Stiche
  1 bis 12,1 mm, nahezu gegenläufig).
- **Kurzstich-Häufung:** bis zu 6 kurze Stiche direkt nach Blockbeginn (Vernähen nach Sprung,
  Schnitt, Farbwechsel oder Designstart) bzw. direkt vor Blockende zählen nicht. Längere Ketten
  kurzer Stiche zählen ab dem siebten Stich.
- **Perforation:** pro Einstich die Zahl der anderen Einstiche im Umkreis von 1 mm (Vernähstiche
  ausgenommen). Eine Lochreihe mit Abstand p ergibt 2 × ⌊1/p⌋: 4 bei 0,35 bis 0,5 mm, 6 bei
  0,33 mm, 10 bei 0,2 mm. Gestapelte Kanten und enge Innenkurven addieren sich.
- **Zonen:** zusammenhängende (8er-Nachbarschaft) markierte Zellen bilden eine Zone; ihre Stufe ist
  die der schlimmsten Zelle. Klick (oder `n` / Umschalt+`n`) zoomt hin, Überfahren rahmt sie ein,
  `v` blendet die Markierungen ein und aus. Bei kritischen Dichte-Zonen steht dabei, wie viel
  Prozent der Spitzenwert über der Grenze liegt, damit knappe Fälle erkennbar sind.
- **Praxisübliche Funde** (`src/validation/practice.ts`) bleiben in der Liste, zählen aber nicht
  zum Gesamturteil, und die Korrektur lässt sie aus. Perforation zählt immer.
  - *Kleine Stelle:* Vorsicht bis 3 mm² oder eine einzelne kritische Zelle (Satin-Enden,
    Objektübergänge, Wendepunkte, Vernähknoten).
  - *Satin-Übergang:* überwiegend Satin, kompakt (höchstens 16 mm², Seitenverhältnis bis 2,5) und
    höchstens 30 % über der Grenze, also zwei Satinlagen, wo Säulen sich treffen oder kreuzen.
    Zwei Säulen übereinander der Länge nach ergeben eine lange Zone und bleiben ein Befund.
  - *Kurzstiche auf stabilem Stoff:* reine Kurzstich-Zonen auf Webware und Caps.

  Mit *Trotzdem prüfen* zählt eine solche Zone wieder mit; *Quittieren* nimmt jede andere Zone aus
  dem Urteil. Beides wird mit der Datei gespeichert und verfällt, wenn die Zone durch eine Änderung
  verschwindet oder deutlich wächst.
- **Tooltip:** zeigt neben dem Anzeigewert den Prüfwert der Zelle und die für sie geltenden Grenzen.
- API: `measurePattern(pattern)` (profilunabhängig) und `classify(measurement, profile)` in
  `src/validation/validate.ts`. Schwellen in `src/validation/thresholds.ts`, Profile in
  `src/validation/profiles.ts`.

## Korrektur

Das Panel *Korrektur* steht in der rechten Spalte unter den Befunden und arbeitet mit dem gewählten
Material und den eingeschalteten Prüfungen. Jede Änderung ist ein Rückgängig-Schritt (Strg+Z /
Strg+Umschalt+Z), *Original* stellt die geladene Datei wieder her.

Die bearbeitete Fassung wird bei jeder Änderung im Browser neben dem unveränderten Original
gespeichert (IndexedDB) und nach dem Neuladen der Seite wiederhergestellt; ein Rückgängig-Schritt
führt dann zurück zum Original. Das Original selbst wird nie überschrieben, und *×* entfernt beide.

### Automatisch

Die Korrektur arbeitet wie ein Digitalisierer von Hand: Sie verändert Stiche nur dort, wo es im
fertigen Stick nicht auffällt, und lässt Stellen, die in der Praxis normal sind, in Ruhe. *Ziel* ist
entweder „keine Warnung“ (Vorsicht und Kritisch beheben) oder „nur Kritisch“ (Standard). *Nur gewählte Zone*
beschränkt sie auf die Zone, die in der Liste gewählt ist. Sie läuft im Web Worker, und jeder
Schritt wird nur übernommen, wenn das Ergebnis im Bereich dadurch nicht schlechter wird.

*Fokus* legt fest, welche Regel Stiche einspart:

- **Beides** (Standard): Fadendichte, Kurzstich-Häufungen und bei Leder die Perforation.
- **Fadendichte**: nur zu viel Garn pro Fläche. Verdeckte Füllreihen werden ausgedünnt.
- **Lochdichte**: nur Einstiche (Kurzstiche, Perforation); zusätzlich werden Einstiche
  verschiedener Lagen, die im selben Loch landen, um höchstens 0,3 mm getrennt.

Die Schritte, in dieser Reihenfolge:

1. **Aufräumen** (`src/correct/shorts.ts`): Stiche ohne Bewegung fallen weg, Ketten winziger Stiche
   werden zusammengefasst, solange kein Punkt mehr als 0,3 mm abweicht.
2. **Füllung unter der Kante zurückziehen** (`src/correct/pullback.ts`): Reicht eine Füllung weit
   unter eine später gestickte Satinkante, wird das Reihenende auf die übliche Überlappung von etwa
   30 % der Kantenbreite zurückgenommen (unter einer Füllung 0,6 mm). Die Kante verdeckt das
   Reihenende ohnehin, gespart wird doppelte Lage am Rand.
3. **Kurzstiche in Satinkurven** (`src/correct/satinShort.ts`): Auf der Innenseite enger Kurven
   drängen sich die Einstiche. Wie in Digitalisierprogrammen endet dort jeder zweite Stich ein
   Viertel der Säulenbreite vor der Kante; die Kontur bleibt geschlossen.
4. **Verdeckte Reihen ausdünnen** (nur Fadendichte, `src/correct/thin.ts`): Füllreihen, die
   vollständig unter mindestens einer vollen späteren Lage liegen, werden paarweise entfernt. Man
   sieht sie nicht, Streifen entstehen also nicht.
5. **Gleichmäßig neu verteilen** (`src/correct/respace.ts`): Ist eine Füllung oder ein Satin danach
   noch zu dicht, wird die ganze Bahn mit gleichmäßig größerem Reihen- bzw. Stichabstand neu
   aufgebaut statt einzelne Reihen herauszunehmen. Kontur, Stichversatz und Bahnrichtung bleiben,
   und der Abstand wird nie größer als der für das Material empfohlene (Webware 40er: 0,45 mm).
   Schmale Details und schon ungleichmäßige Bahnen bleiben unverändert.
6. **Einstiche trennen** (`src/correct/nudge.ts`): bei Fokus Lochdichte und bei Perforation auf
   Leder; verschoben werden nur Einstiche zwischen zwei ausreichend langen Stichen.

Vernähstiche, Sprünge, Schnitte und Farbwechsel bleiben unverändert.

**Was in Ruhe bleibt:** praxisübliche und quittierte Zonen (siehe Validierung) fasst die Korrektur
nicht an; sie sorgt nur dafür, dass sie nicht schlimmer werden. Was danach noch übrig ist, meldet
das Panel als „von Hand prüfen“: meist mehrere gestapelte Lagen, also eine Designentscheidung.

### Von Hand

*Stiche bearbeiten* (`e`) blendet Stichplan und, ab etwa 6 px/mm Zoom, die Einstiche ein.

- Klick wählt einen Einstich, Umschalt+Klick erweitert, Umschalt+Ziehen wählt ein Rechteck,
  Strg+A alles. Klick ins Leere hebt die Auswahl auf, Ziehen im Leeren verschiebt die Ansicht.
- Gewählte Einstiche ziehen oder mit den Pfeiltasten verschieben (0,1 mm, mit Umschalt 0,5 mm).
- Entf / Rücktaste löscht; die Nachbarn werden durch einen Stich verbunden.
- *Ausdünnen* entfernt 25, 33 oder 50 % der Zyklen in Füllungen und Zickzacks, die überwiegend in
  der Auswahl liegen.

### Vergleich

*Mit Original vergleichen* (`c`, sobald die Datei geändert wurde) teilt die Ansicht: links das
Original, rechts die aktuelle Fassung, jeweils mit eigener Heatmap, Markierungen und Stichplan. Die
Trennlinie lässt sich ziehen, Zoom und Verschieben gelten für beide Seiten, der Tooltip zeigt die
Werte der Seite unter dem Zeiger. Darunter stehen Stiche, Garnlänge, kritische und Vorsicht-Fläche
und maximale Dichte beider Fassungen nebeneinander.

### Speichern

*Als DST* / *Als PES* schreibt das aktuelle Muster (`src/writers/`). Nach einer Änderung heißt die
Datei `name-corrected.dst`. Gespeichert werden nur Stiche und Farben: PE-Design-Objekte und
Rahmeneinstellungen des Originals gehen verloren.

- **DST:** Ein Schnitt wird als Folge von 3 Sprüngen geschrieben, aber nur, wenn die Sprungfolge danach
  nicht schon lang genug ist. Schnitte wachsen deshalb beim wiederholten Speichern nicht (anders als
  bei pyembroidery). Ungetrimmte Sprungfolgen, die sonst als Schnitt gelesen würden, werden
  zusammengefasst. Lange Stiche werden in Sprünge plus einen Stich zerlegt (keine zusätzlichen
  Einstiche). Sprünge über 36 mm brauchen 3 oder mehr Datensätze und werden beim Lesen zum Schnitt;
  das ist eine Eigenschaft des Formats. DST enthält keine Farben.
- **PES:** Version 1 mit CEmbOne/CSewSeg-Objekt für Designsoftware und PEC-Block mit
  Vorschaubildern für Maschinen. Nur Sprünge nach einem Schnitt tragen das Schnitt-Flag (pyembroidery
  markiert jeden Sprung). Farben behalten ihren PEC-Paletten-Platz; Farben aus DST bekommen den
  nächstgelegenen.
- Die Tests (`tests/writers.test.ts`) prüfen Lesen → Schreiben → Lesen für DST, PES und beide
  Konvertierungen auf Datensatz-Gleichheit. Die geschriebenen Dateien wurden außerdem mit
  pyembroidery 1.5.1 gegengelesen.

## Entwicklung

```sh
npm install
npm run dev       # Dev-Server
npm test          # Unit-Tests (Vitest)
npm run build     # Typecheck + Produktionsbuild nach dist/
npm run preview   # Build lokal ansehen: http://localhost:4173/heatstitch/
```

Die Tests erzeugen ihre DST/PES-Fixtures synthetisch (`tests/helpers/encode.ts`) und prüfen u.a.,
dass die Summe des Rasters exakt der Gesamtgarnlänge bzw. Stichzahl entspricht.

## Beispieldateien

`public/examples/` enthält echte Stickdateien zum Ausprobieren, z. B. `cat-60mm.pes` (Katze, 60 mm, PES v6).
Der Knopf "Beispiel laden" unter dem Dateifeld lädt sie direkt in die App.

`public/examples/demos/` enthält kleine synthetische Demos für die Anleitung, jede mit einem Befund:
`overlap.pes` (gestapelte Füllungen), `letters.pes` (Füllung unter Satin), `sun.dst` (Kurzstiche auf
Strick), `leather-patch.dst` (Perforation auf Leder) und `confetti.pes` (lange Sprünge ohne Schnitt,
kurze mit Schnitt). Sie entstehen mit den App-eigenen Writern aus
`tests/helpers/demos.ts`; `tests/demos.test.ts` prüft, dass sie aktuell sind und den beschriebenen
Befund zeigen. Nach Änderungen an Designs oder Writern: `UPDATE_DEMOS=1 npm test`. Die Bilder der
Anleitung liegen in `public/guide/` und werden nicht vorab gecacht.

## Deployment

`.github/workflows/deploy.yml` testet und baut jeden Push; Pushes auf `main` werden auf
GitHub Pages veröffentlicht. Einmalig nötig: *Settings → Pages → Source: GitHub Actions*.

## Hinweise zu den Formaten

- **DST** kennt keinen expliziten Fadenschnitt. Wie bei pyembroidery gilt eine Folge von
  mindestens 3 Sprüngen als Schnitt (`DST_TRIM_JUMP_COUNT` in `src/parsers/dst.ts`). DST enthält
  außerdem keine Garnfarben; die Farbblöcke bekommen Ersatzfarben.
- **PES**: Farben kommen aus der PEC-Palette. Die RGB-Garnlisten neuerer PES-Versionen werden noch nicht gelesen.
- Die Validierungsschwellen sind aus Digitalisier-Richtwerten hergeleitet und an synthetischen Aufbauten kalibriert; ein Abgleich mit echten Probestickungen steht noch aus.

## Aufbau

```
src/parsers/   DST- und PES-Parser, PEC-Palette
src/model/     Pattern-Datenmodell, Garnsegmente, Statistik, Bearbeitungsfunktionen,
               Ablauf (Farbblöcke, Sticharten, Sprünge, Marker), Sprünge schneiden/mitziehen
src/density/   Dichteraster, Gauss-Blur, Web Worker
src/validation/  Messung, Profile, Stufen, Satin-Erkennung, Kurzstich- und Perforationsregel, Zonen
src/correct/   Automatische Korrektur: Rückzug unter Kanten, Satin-Kurzstiche, Neuverteilen, Ausdünnen, Einstiche trennen
src/writers/   DST- und PES-Writer (PEC-Block, Vorschaubilder)
src/render/    Viewport, Farbskala, Heatmap, Stichplan, Legende, Ablauf-Darstellung (Färbung, Marker, Nadel)
src/ui/        Dateiliste, Validierung, Korrektur-Panel, Stich-Editor, Controls, Statistik, Tooltip, Export,
               Farben-Liste, Sprung-Liste, Player
src/i18n/      Übersetzungen DE/EN
public/examples/  Beispiel-Stickdateien (per Knopf ladbar)
docs.html      Kurzanleitung DE/EN (src/docs.ts, src/docs.css)
public/og-image.jpg, robots.txt, sitemap.xml  Vorschaubild für Social Media, Crawler
```

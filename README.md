# heatstitch

Stickdichte-Heatmap für Stickdateien, komplett im Browser (kein Backend, keine Uploads).

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
- **Korrektur:** automatisch (Reihen ausdünnen, Kurzstiche bereinigen, gleiche Einstichlöcher trennen) und von Hand (Einstiche wählen, verschieben, löschen, Auswahl ausdünnen), mit Rückgängig/Wiederholen und Vergleichsansicht Original/korrigiert, siehe unten
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
| Kurzstich-Häufung | | ≥ 8 Stiche unter 1 mm in einer Zelle |
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
  `v` blendet die Markierungen ein und aus.
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

*Ziel* ist entweder „keine Warnung“ (Vorsicht und Kritisch beheben) oder „nur Kritisch“. Die
Korrektur zielt 10 % unter die jeweilige Grenze, misst nach jeder Runde neu (bis zu 4 Runden) und
läuft im Web Worker. *Nur gewählte Zone* beschränkt sie auf die Zone, die in der Liste gewählt ist.

- **Reihen ausdünnen** (`src/correct/thin.ts`): Füllungen und Satins sind Hin-und-her-Bahnen. Ohne
  Objektdaten erkennt heatstitch sie an den Wendepunkten eines Stichzugs, die periodisch
  wiederkehren (Satin: jeder zweite Wendepunkt liegt auf derselben Kante, Füllung mit
  Verbindungsstich: jeder vierte). Entfernt wird jeweils ein Zyklus (zwei Füllreihen bzw. ein Zick
  und ein Zack), die Enden verbindet ein kurzer Stich. Wie viele Zyklen fallen, ergibt sich je Zelle
  aus dem Überschuss von Dichte, Kurzstichen oder Perforation; die Entfernungen werden gleichmäßig
  verteilt. Mindestens 60 % des entfernten Garns müssen in markierten Zellen liegen (in späteren
  Runden 30 %), damit eine lange Füllreihe nicht wegen eines kleinen Flecks verschwindet. Das ist die
  einzige Korrektur, die die Garnmenge pro Fläche wirklich senkt.
- **Kurzstiche bereinigen** (`src/correct/shorts.ts`): entfernt Stiche ohne Bewegung (überall) und
  fasst in Zellen mit Kurzstich-Häufung Ketten kurzer Stiche zusammen, solange kein Punkt mehr als
  0,3 mm vom neuen Stich abweicht. Schmale Zickzack-Säulen bleiben dabei unverändert und werden
  stattdessen ausgedünnt.
- **Gleiche Einstichlöcher trennen** (`src/correct/nudge.ts`, standardmäßig aus): schiebt Einstiche
  verschiedener Lagen, die näher als 0,2 mm beieinander liegen, um höchstens 0,3 mm auseinander, bei
  Leder auch Einstiche in Perforationszonen. Senkt die Dichte nicht. Aus, weil echte Dateien Löcher
  oft absichtlich wiederverwenden (nachgezogene Konturen, gemeinsame Objektkanten).
- Vernähstiche am Anfang und Ende eines Blocks werden nie entfernt; Sprünge, Schnitte und
  Farbwechsel behalten ihre Ankerstiche.

Was übrig bleibt, meldet das Panel; meist sind das kleine Flecken, in denen lange Reihen nur kurz
durch eine dichte Stelle laufen. Ausgedünnte Füllungen haben ihre Reihen paarweise (zwei Reihen
bleiben, zwei fallen weg), der Abstand wird nicht neu verteilt.

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
src/model/     Pattern-Datenmodell, Garnsegmente, Statistik, Bearbeitungsfunktionen
src/density/   Dichteraster, Gauss-Blur, Web Worker
src/validation/  Messung, Profile, Stufen, Satin-Erkennung, Kurzstich- und Perforationsregel, Zonen
src/correct/   Automatische Korrektur: Ausdünnen, Kurzstiche, Einstiche trennen
src/writers/   DST- und PES-Writer (PEC-Block, Vorschaubilder)
src/render/    Viewport, Farbskala, Heatmap, Stichplan, Legende
src/ui/        Dateiliste, Validierung, Korrektur-Panel, Stich-Editor, Controls, Statistik, Tooltip, Export
src/i18n/      Übersetzungen DE/EN
public/examples/  Beispiel-Stickdateien (per Knopf ladbar)
docs.html      Kurzanleitung DE/EN (src/docs.ts, src/docs.css)
public/og-image.png, robots.txt, sitemap.xml  Vorschaubild für Social Media, Crawler
```

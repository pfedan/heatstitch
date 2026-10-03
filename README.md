# heatstitch

Stickdichte-Heatmap für Stickdateien, komplett im Browser (kein Backend, keine Uploads).

## Funktionen

- **Formate:** DST (Tajima) und PES (Brother, liest den PEC-Block)
- **Zwei Dichtemetriken**, per Umschalter:
  - *Garnlänge* in mm/mm²: jedes Stichsegment wird exakt auf die Rasterzellen verteilt, die es durchläuft
  - *Einstiche* in 1/mm²: Nadeleinstiche pro Fläche (Perforationsrisiko)
- Rasterzelle 0,5 bis 5 mm, optionale Gauss-Glättung
- Absolute Farbskala mit einstellbarem Maximum
- **Validierung** jeder geladenen Datei (Sicher / Vorsicht / Kritisch) mit orange/rotem Overlay und Zusammenfassung, siehe unten
- Ungetrimmte Sprünge optional als Garn zählen
- Stichplan-Overlay in Garnfarben, Sprünge gestrichelt
- Zoom (Mausrad, Pinch), Verschieben, Tooltip mit Dichte und Position
- Statistik: Stiche, Sprünge, Schnitte, Farbwechsel, Größe, Garnlänge, Max-Dichte
- Mehrere Dateien laden und umschalten (auch per Pfeiltasten oder j/k, `f` = Einpassen)
- PNG-Export der aktuellen Ansicht inkl. Legende
- Deutsch / Englisch
- PWA: installierbar, offline nutzbar, "Öffnen mit" für .dst/.pes

## Validierung

Läuft automatisch im Web Worker, sobald eine Datei geladen ist, unabhängig von den Darstellungsreglern.

| Stufe | Garnlänge pro Fläche | entspricht (0,4 mm Abstand) | Overlay |
|---|---|---|---|
| Sicher | < 6,0 mm/mm² | 1 bis 2 Lagen | keins |
| Vorsicht | 6,0 bis < 10,0 mm/mm² | ca. 3 Lagen | orange |
| Kritisch | ≥ 10,0 mm/mm² | 4+ Lagen | rot |

- **Raster:** feste 1-mm-Zellen. Die Dichte wird auf 0,2-mm-Unterzellen berechnet, mit σ = 0,5 mm geglättet
  und dann gemittelt. So entstehen keine Aliasing-Muster zwischen typischen 0,4-mm-Reihen und dem 1-mm-Raster.
- **Satin-Ausnahme:** besteht der Faden einer Zelle zu mindestens 50 % aus Satin (Zickzack-Stiche 1 bis 12,1 mm,
  nahezu gegenläufig), bleibt sie bis unter 7,5 mm/mm² Sicher.
- **Kurzstich-Häufung:** ≥ 8 Stiche unter 1,0 mm in einer Zelle sind Kritisch. Ausgenommen sind Ketten kurzer
  Stiche direkt nach Blockbeginn (Vernähen nach Sprung, Schnitt, Farbwechsel oder Designstart) oder direkt
  vor Blockende.
- **Zonen:** zusammenhängende (8er-Nachbarschaft) markierte Zellen bilden eine Zone; ihre Stufe ist die der
  schlimmsten Zelle. Klick auf eine Zone in der Zusammenfassung zoomt dorthin.
- API: `validatePattern(pattern)` in `src/validation/validate.ts` liefert Dichte und Stufe je Zelle,
  Zellkoordinaten je Stufe und die Zonenliste. Schwellen stehen in `src/validation/thresholds.ts`.

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

## Deployment

`.github/workflows/deploy.yml` testet und baut jeden Push; Pushes auf `main` werden auf
GitHub Pages veröffentlicht. Einmalig nötig: *Settings → Pages → Source: GitHub Actions*.

## Hinweise zu den Formaten

- **DST** kennt keinen expliziten Fadenschnitt. Wie bei pyembroidery gilt eine Folge von
  mindestens 3 Sprüngen als Schnitt (`DST_TRIM_JUMP_COUNT` in `src/parsers/dst.ts`). DST enthält
  außerdem keine Garnfarben; die Farbblöcke bekommen Ersatzfarben.
- **PES**: Farben kommen aus der PEC-Palette. Die RGB-Garnlisten neuerer PES-Versionen werden noch nicht gelesen.
- Die Validierungsschwellen sind theoretisch hergeleitet und sollten mit echten Dateien überprüft werden.

## Aufbau

```
src/parsers/   DST- und PES-Parser, PEC-Palette
src/model/     Pattern-Datenmodell, Garnsegmente, Statistik
src/density/   Dichteraster, Gauss-Blur, Web Worker
src/validation/  Stufen, Satin-Erkennung, Kurzstich-Regel, Zonen
src/render/    Viewport, Farbskala, Heatmap, Stichplan, Legende
src/ui/        Dateiliste, Validierung, Controls, Statistik, Tooltip, Export
src/i18n/      Übersetzungen DE/EN
```

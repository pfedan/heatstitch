# Aufzeichnung einer Sitzung

Ein Werkzeug für Entwickler: Die App schreibt mit, was in ihr getan wird, und legt es beim
Speichern in die Projektdatei. Daraus entsteht ein Playwright-Skript im Format der
Screencast-Abläufe (`docs/screencasts/*/ablauf.mjs`). Es spielt die Sitzung nach, um einen Bug
nachzustellen, und ist der Rohentwurf für ein Tutorial-Video. Wer die App nur benutzt, sieht
davon nichts.

## Aufnehmen

In der App die Konsole des Browsers öffnen (Mac: Wahltaste + Cmd + J) und eingeben:

```js
heatstitch.record()
```

Unten links erscheint **● REC**. Die Aufzeichnung läuft bis zum Neuladen der Seite oder bis
`heatstitch.stop()`. Dann wie gewohnt **Speichern** (Projekt); die Datei enthält die
Aufzeichnung. `heatstitch.save()` speichert auch, wenn kein Stickmuster offen ist.

Was beim Start offen war (Stickmuster, Bild, Einstellungen), kommt mit in die Aufzeichnung.
Man kann also mitten in der Arbeit anfangen, kurz bevor man den Fehler auslöst.

## Was mitgeschrieben wird

Bedienschritte, keine rohen Ereignisse:

- **Knöpfe und Felder** mit Rolle und Namen, so wie Playwright sie findet (`button „Duplizieren“`),
  dazu id und CSS-Pfad als Rückfall.
- **Bühne** in mm des Stickmusters; ein Ziehweg in mm bei der Vergrößerung beim Drücken. So
  trifft das Abspielen dieselbe Stelle, auch in einem anderen Fenster und bei anderem Zoom.
- **Tasten** (Strg auf Windows und Cmd auf dem Mac werden zu `ControlOrMeta`), **Eingaben** als
  Endwert je Feld, **Dateien** (gewählt oder hineingezogen) samt Inhalt.
- **Stand des Stickmusters** nach jeder Änderung: Zahl der Stiche und ein Hash. Beim Abspielen
  zeigt der Vergleich den ersten Schritt, an dem es anders ausgeht.

Die Aufzeichnung bleibt in der Projektdatei auf dem eigenen Rechner; ein paar tausend Schritte
sind gezippt weit unter 1 MB, offene Bilder und Dateien kommen in voller Größe dazu.

## Abspielen (Bug nachstellen)

Die App gebaut bereitstellen (`npm run build && npm run preview`), dann:

```sh
node tools/recording/replay.mjs projekt.heatstitch OUT_DIR [--headed] [--slow]
```

Das schreibt `OUT_DIR/ablauf.mjs` mit `material/` und spielt es in einem frischen Browser im
Fenster der Aufnahme ab. Am Ende steht „Wie aufgezeichnet.“ oder jede Abweichung mit Schritt
und Stand; `differs.png` zeigt die erste, `end.png` das Ende. Bei einer Abweichung ist der
Rückgabewert 1, ein behobener Bug kann so als Test dienen. `--headed --slow` zeigt den Ablauf
im Originaltempo.

## Zum Video

```sh
node tools/recording/ablauf.mjs projekt.heatstitch docs/screencasts/14-thema
```

Das Skript hat eine Szene je Abschnitt (getrennt an Pausen über 5 s und wo eine Datei kommt).
Je Szene `say`, `text` und `textEn` ergänzen, Wartezeiten und Wege glätten, dann weiter wie in
[konzept.md](screencasts/konzept.md) und [lokal.md](screencasts/lokal.md). `record.mjs` lädt
die Einstellungen und den Startstand der Aufzeichnung mit; die Punkte auf der Bühne passen sich
dem Fenster mit 1920 × 1080 an.

## Teile

- `src/dev/tap.ts`: hört als Erstes auf Eingaben, damit kein Handler sie vorher abfängt.
- `src/dev/recorder.ts`: die Aufzeichnung; wird erst mit `heatstitch.record()` geladen.
- `src/dev/console.ts`: `window.heatstitch` (record, stop, save und für das Abspielen state,
  view, setView, toPage).
- `tools/recording/ablauf.mjs`, `steps.mjs`, `replay.mjs`: Skript schreiben, Schritte, Abspielen.

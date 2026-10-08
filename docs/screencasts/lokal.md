# Aufnahme auf dem eigenen Rechner

Stand Oktober 2026. Anleitung für die Aufnahmen auf Daniels Rechner, für ihn und für den
Claude-Thread, der dort arbeitet. Was ein Video zeigt und wie es aussieht, steht im
[Konzept](konzept.md); hier steht nur, wie es lokal entsteht.

## Branches

`claude/project-thread-xszfzs` ist die gemeinsame Basis: Konzept und Werkzeuge. Jede Aufnahme
bekommt einen eigenen Branch davon, benannt nach dem Schlüssel des Videos, zum Beispiel
`screencast/01-neues-stickmuster`. Ändert eine Aufnahme ein Werkzeug, kommt die Änderung
zurück in die Basis, damit die nächste Aufnahme sie hat.

## Einmal einrichten

Gebraucht werden Node 20 oder neuer, Git, ffmpeg mit ffprobe, Python 3 mit Pillow und die
Schrift Inter.

```sh
git clone https://github.com/pfedan/heatstitch.git
cd heatstitch
git switch claude/project-thread-xszfzs
npm install
npx playwright install chromium
python3 -m pip install Pillow
```

- **ffmpeg:** macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg`, Linux über
  den Paketmanager.
- **Inter:** von <https://rsms.me/inter> laden und entpacken. Die Umgebungsvariable `FONT_DIR`
  zeigt auf den Ordner mit `Inter-Regular.otf` (im Paket `extras/otf`). Unter Linux mit dem
  Paket `fonts-inter` ist nichts zu tun.
- **Replicate:** Token von <https://replicate.com/account/api-tokens> als
  `REPLICATE_API_TOKEN` setzen. Die Stimme ist dieselbe wie bisher (Gemini TTS, Aoede); jede
  Sprachaufnahme wird nur einmal bezahlt und liegt danach unter `ton/`.

Dann in einem eigenen Terminal die App bauen und bereitstellen:

```sh
npm run build && npm run preview
```

Und prüfen, ob alles da ist:

```sh
node tools/screencast/check.mjs
```

Jede Zeile muss `ok` zeigen. Für eine fehlende Sache steht darunter, was zu tun ist.

## Ein Video herstellen

`NN-kurzname` ist der Schlüssel aus dem Konzept, `OUT` ein Arbeitsordner außerhalb des Repos.

1. **Vorlage.** `docs/screencasts/NN-kurzname/vorlage.md` mit Szenen, Sprechtext und dem, was
   im Bild passiert. Vorher die Szenen einmal in der laufenden App durchklicken; jedes Wort,
   das die Stimme nennt, muss so auf dem Bildschirm stehen. Daniel nimmt die Vorlage ab,
   bevor Ton entsteht.
2. **Ablauf.** `ablauf.mjs` im selben Ordner: Titel, Teilnummer, Stimme und je Szene `say`
   (mit englischer Regie in eckigen Klammern), `text` und `textEn` (Untertitel) und `run`
   (die Aktionen). Ein Beispiel für den Aufbau ist der Ablauf des alten Teils 1:
   `git show 0f4491b^:docs/screencasts/01-neues-stickmuster/ablauf.mjs`. Seine Ziele
   (`#new-design`, `#hoop`) gibt es nicht mehr; neue Abläufe sprechen Bedienelemente über
   Rolle und Namen an, etwa `s.page.getByRole('button', { name: 'Ellipse' })`.
3. **Stimme.**

   ```sh
   node tools/screencast/tts.mjs docs/screencasts/NN-kurzname/ablauf.mjs OUT
   ```

   Neue Sätze gehen an Replicate, schon vorhandene kommen aus `ton/`. Probe hören, bevor es
   weitergeht.
4. **Aufnahme.**

   ```sh
   node tools/screencast/record.mjs docs/screencasts/NN-kurzname/ablauf.mjs OUT
   ```

   Chromium läuft unsichtbar und rechnet Bild für Bild, der Rechner kann nebenbei weiter
   genutzt werden, darf aber nicht schlafen gehen. Mit `--scenes 3-5` werden nur einzelne
   Szenen aufgenommen (die anderen laufen ohne Bilder mit, damit der Zustand stimmt).
   Liegt in `OUT` schon eine ganze Aufnahme, ersetzen sie dort nur diese Szenen; danach genügt
   ein neuer Schnitt.
   Mit `--jobs 4` laufen vier Teile gleichzeitig in je einem eigenen Chromium; jeder Teil spielt
   die Szenen davor ohne Bilder durch. Auf einem Rechner mit vielen Kernen geht das deutlich schneller.
   Hinweise beim Überfahren sind ausgeblendet; eine Szene, die einen zeigen soll, ruft
   `s.tips(true)` auf.
5. **Schnitt.**

   ```sh
   python3 tools/screencast/compose.py OUT --part N --title "Titel aus dem Konzept" \
     --video OUT/NN-kurzname
   ```

   Schreibt MP4, Untertitel DE und EN und das Poster.
6. **Abnahme.** Video ansehen, Daniel schickt Änderungen. Geänderte Sätze kosten nur ihre
   eigene Sprachaufnahme neu.
7. **Ablegen.** Nur Vorlage, Ablauf und `material/` in den Branch des Videos, Pull Request
   gegen die Basis. `ton/` und die fertigen Dateien bleiben draußen (`ton/` steht in
   `.gitignore`); wohin sie kommen, regelt das Konzept unter „Fertige Dateien“.

## Gut zu wissen

- Chromium startet mit Software-Grafik (`--disable-gpu-compositing
  --disable-accelerated-2d-canvas`, WebGL über SwiftShader), auch wenn der Rechner eine
  Grafikkarte hat. So sieht das Bild auf jedem Rechner und im Container gleich aus.
- Probeaufnahmen, Hörproben und Standbilder kommen nicht ins Repo, sondern in die
  Projektdateien unter `screencasts/NN-kurzname/`.

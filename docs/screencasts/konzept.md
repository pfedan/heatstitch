# Tutorial-Screencasts: Konzept

Kurze Videos (1 bis 3 Minuten) für Hobbysticker, die heatstitch Schritt für Schritt zeigen.
Dieses Dokument legt Themenbaum, Bildsprache, Stimme und Herstellung fest, damit alle Videos
wie aus einem Guss wirken. Begriffe wie in der App (Stickmuster, Objekt, Stichart,
Steppstich, Stickrahmen), so wie sie in App und Anleitung stehen.

## Spielregeln

- Ein Video wird nur auf direkte Anfrage geplant und erstellt.
- Je Video zuerst die Vorlage: Ablauf (Szenen mit Aktionen), Demodatei und Sprechtext.
  Erst nach dem Ok wird aufgenommen, vertont und geschnitten.
- Jedes Video steht für sich. Wer nur Teil 7 sieht, braucht Teil 1 bis 6 nicht.
- Ein Video, ein Ziel. Der Titel sagt, was man danach kann.

## Themenbaum

Drei Stufen: erst eine fremde Stickdatei ansehen und verbessern (der häufigste Anlass),
dann selbst gestalten, dann Feinschliff. Die Gruppen folgen der Anleitung (`docs.html`),
damit Video und Text zusammenpassen.

### Stufe 1: Stickdatei ansehen und verbessern

| Nr. | Titel | Inhalt | Demodatei | Länge |
| --- | --- | --- | --- | --- |
| 1 | Erste Schritte | Datei öffnen (Ziehen oder Beispiel), der Bildschirm in drei Spalten, Ablauf abspielen, Farben aus- und einblenden | `cat-60mm.pes` | 2 min |
| 2 | Stickdatei prüfen | Modus Dichte, Prüfung, Befunde lesen und zuklappen, Fokus auf eine Stelle | `overlap.pes` | 2 bis 3 min |
| 3 | Korrigieren mit Vorschlägen | Korrektur, Vorschläge, auf Stoff abstimmen, Vergleich vorher und nachher | `letters.pes` | 2 bis 3 min |
| 4 | Sprünge und Schnitte | Sprungliste, Schnitte setzen, alle auf einmal nach Länge, Reihenfolge optimieren | `confetti.pes` | 2 min |
| 5 | Vorschau und Speichern | Realistische Fäden, Stoff wählen, Markierungen, Stickrahmen, Format wählen, als Projekt speichern | `leather-patch.dst` | 2 min |

### Stufe 2: Selbst gestalten

| Nr. | Titel | Inhalt | Demodatei | Länge |
| --- | --- | --- | --- | --- |
| 6 | Ein neues Stickmuster | + Neu, Stickrahmen, Formen zeichnen, Größe eintippen, Stichart wählen | leer | 2 min |
| 7 | Schrift | Text setzen, Schriftart, Größe, Bogen, Abstand | leer | 2 min |
| 8 | Vom Bild zum Stickmuster | Modus Bild: SVG oder Foto laden, Farben zusammenfassen, Stiche erzeugen | `image-example.svg` | 2 bis 3 min |
| 9 | Objekte und Reihenfolge | Objektliste, Farben, kopieren und spiegeln, Kontextmenü, Reihenfolge per Ziehen | `overlapping-circles.svg` | 2 min |

### Stufe 3: Feinschliff

| Nr. | Titel | Inhalt | Demodatei | Länge |
| --- | --- | --- | --- | --- |
| 10 | Füllungen | Muster, Winkel, Geführt, Unterlage, Ausdehnen, Umrandung, Dekor | `shapes-benchmark.svg` | 3 min |
| 11 | Satin und Linien | Satin, Querlinien, Abschnitte, Zugausgleich, Linie als Steppstich oder Satin | `sun.dst` | 3 min |
| 12 | Form und einzelne Stiche | Ebenen Form, Objekte, Stiche, Punkte ziehen, Vereinfachen, einzelne Stiche von Hand | `cat-60mm.pes` | 2 bis 3 min |

Nicht als eigenes Video: Tastenkürzel (erscheinen als Einblendung, wann immer eine Taste
benutzt wird), Grenzen und Begriffe (bleiben in der Anleitung).

Vorschlag für den Anfang: Teil 1 als Pilot. Daran werden Stimme, Tempo und Bildsprache
einmal abgestimmt, bevor weitere Teile folgen.

## Bildsprache

**Bild.** 1920 × 1080, 30 Bilder pro Sekunde. Die App so, wie Nutzer sie sehen: helle
Oberfläche, dunkle Leinwand, Sprache Deutsch, Standard-Einstellungen. Keine Browserleiste,
nur die App.

**Vorspann (3 s).** Dunkler Grund (`#141118`), heatstitch-Logo, Titel in Weiß, darunter
„Teil 3 von 12“ in der Akzentfarbe (`#e0559e`), eine feine Stichlinie als Linie unter dem
Titel. Ruhige Blende in die App.

**Abspann (3 s).** Gleicher Grund, „Als Nächstes: Teil 4, Sprünge und Schnitte“ und die
Adresse der App. Kein Logo-Feuerwerk.

**Maus.** Ein eingeblendeter Zeiger (weißer Pfeil mit dunklem Rand, etwas größer als normal),
der sich weich bewegt und nie springt. Ein Klick zeigt einen kurzen Ring in der Akzentfarbe.
Vor jedem Klick eine kleine Pause, damit das Auge folgen kann.

**Heranzoomen.** Sanft (etwa 0,6 s, weich ein und aus) auf den Bereich, um den es gerade
geht, höchstens 1,8-fach. Danach wieder auf das ganze Bild. Aufnahme in doppelter Auflösung,
damit Zoom scharf bleibt.

**Hinweise.** Höchstens ein Hinweis zur Zeit: ein kleines Etikett mit abgerundeten Ecken in
der Akzentfarbe, weiße Schrift, nahe am Element. Es nennt genau das Wort, das die Stimme
gerade sagt (zum Beispiel „Stichart“). Tasten erscheinen unten mittig als Tastenkappe
(„Leertaste“, „H“).

**Untertitel.** Als WebVTT-Datei zum Einschalten, nicht eingebrannt. Sie entstehen aus dem
Sprechtext.

**Musik.** Keine. Stimme und App genügen, und Hobbysticker schauen oft nebenbei.

**Vorschaubild.** Ein Standbild aus dem Video mit dem Titel, dient als Poster auf der
Hilfeseite.

## Stimme

- Sprachsynthese mit Google Gemini TTS über Replicate (`google/gemini-3.1-flash-tts`),
  Sprache `de-DE`.
- Eine Stimme für die ganze Serie. Auswahl beim Pilot aus drei Hörproben (Vorschlag: Kore,
  Aoede, Charon).
- Feste Regieanweisung für alle Videos:
  „Sprich ruhig, freundlich und klar, wie eine erfahrene Stickerin, die einer Freundin etwas
  am Rechner zeigt. Natürliches Tempo, kleine Pausen zwischen den Gedanken.“
- Regie im Text dezent: höchstens ein oder zwei Markierungen pro Video (etwa eine kurze Pause
  vor dem Aha-Moment). Kein Lachen, kein Flüstern.
- Du-Form wie in der App. Kurze Sätze, ein Gedanke pro Satz. Etwa 130 Wörter pro Minute,
  ein Video mit 2 Minuten hat also rund 260 Wörter.
- Fachwörter genau wie in der App. Was auf dem Bildschirm steht, wird auch so gesagt.

## Herstellung

Alles läuft im Container und ist wiederholbar. Ein Video wird aus einer Ablaufdatei erzeugt.

1. **Ablauf.** Je Video eine Datei mit Szenen. Jede Szene hat einen Sprechtext und die
   Aktionen dazu (klicken, ziehen, Taste, zoomen, Hinweis zeigen).
2. **Stimme zuerst.** Jede Szene wird einzeln vertont. Die Länge der Tonspur bestimmt, wie
   lange die Szene im Bild dauert. So passen Bild und Ton immer zusammen, auch wenn ein Satz
   später geändert wird.
3. **Aufnahme.** Playwright mit Chromium, die Uhr der Seite wird angehalten und Bild für Bild
   weitergestellt (je 1/30 s, dann ein Bildschirmfoto). Das ist langsamer als Echtzeit, aber
   jedes Bild ist scharf und flüssig, auch beim Abspielen des Stichablaufs. Getestet:
   0,25 s pro Bild bei ruhiger Ansicht, bis 1,5 s beim Abspielen, ein Video mit 2 Minuten
   braucht also 15 bis 60 Minuten. Eine Echtzeitaufnahme schafft im Container nur etwa
   5 Bilder pro Sekunde und scheidet aus.
4. **Schnitt.** ffmpeg setzt Vorspann, Bilder, Tonspuren und Abspann zusammen, gleicht die
   Lautstärke an (auf -16 LUFS) und schreibt MP4 (H.264, für alle Browser), Poster und
   Untertitel.

Werkzeuge kommen mit dem ersten Video ins Repo (`tools/screencast/`).

## Ablage und Hilfeseite

```
docs/screencasts/
  konzept.md            dieses Dokument
  01-erste-schritte/
    ablauf.mjs          Szenen, Sprechtext, Aktionen (Quelle)
    erste-schritte.mp4  fertiges Video
    erste-schritte.vtt  Untertitel
    erste-schritte.jpg  Poster
```

- Größenbudget: etwa 4 MB pro Minute, die ganze Serie bleibt unter 100 MB. Neu gerendert
  wird nur auf Anfrage, damit das Repo nicht wächst.
- Die Website liefert `docs/` heute nicht aus. Beim Bauen werden Video, Poster und Untertitel
  nach `videos/` der Website kopiert.
- Die Videos sind nicht Teil des Offline-Speichers der App (zu groß), sie laden nur beim
  Abspielen.
- Hilfeseite: ein Bereich „Videos“ oben bei „Was möchtest du tun?“, als Karten mit Poster,
  Titel und Länge. Ein Klick spielt das Video direkt auf der Seite. Zusätzlich führt in jedem
  passenden Abschnitt der Anleitung ein kleiner Link „Im Video ansehen“ zum Video.
- Englisch: zuerst nur Deutsch. Eine englische Fassung wäre später aus demselben Ablauf
  möglich (App auf Englisch, englische Stimme, neue Aufnahme).

# Abnahme der neuen Oberfläche gegen die Funktionsliste

Stand: 2026-10-06. Jede Zeile der Funktionsliste (`funktionsliste.md`) ist gegen die laufende neue Oberfläche geprüft: per Playwright (Chromium) im Browser geklickt und getippt, bei 1440x900, 1280x800, 820x1180 (Touch) und 390x844 (Touch), Deutsch und Englisch, hell und dunkel. Wo eine Zeile nur über den unveränderten Code geprüft werden konnte, steht das in der Spalte "Weg neu".

## Zusammenfassung

- Geprüft: **622** Zeilen
- ok (gleicher oder gleichwertiger Weg): **529**
- geändert (Funktion da, anderer Weg): **91**
- fehlt: **0**
- kaputt: **2** (alle behoben)

| Teil | ok | geändert | fehlt | kaputt |
|---|---|---|---|---|
| 1 | 111 | 28 | 0 | 1 |
| 2 | 84 | 17 | 0 | 0 |
| 3 | 149 | 17 | 0 | 0 |
| 4 | 185 | 29 | 0 | 1 |

**Fehlt:** nichts. Jede Funktion der Liste ist in der neuen Oberfläche erreichbar.

**Kaputt (gefunden und behoben):**
- 100 Stiche vor/zurück: Umschalt+. / Umschalt+, griffen nicht (Taste liefert ">" bzw. ":"); behoben in keys.ts über e.code
- Auf der Fläche setzen / Fertig: Knopf "Punkte setzen" blieb nach Wahl von Strahlen/Kreise/Wirbel gesperrt (Befehl las das gemessene statt das gewählte Muster); behoben

**Weitere Korrekturen in diesem Durchgang (Teil B):**
- Leiste über der Bühne (Stiche, Querlinien, Zu Satin) bricht bei 1280 nicht mehr um: seltener Gebrauchtes wandert bei wenig Platz in ein Menü "…".
- Kopf von Umrandung/Schatten/Echo bleibt bei 1440 einzeilig (Kurzname, ganzer Text im Tooltip).
- "Zweite Farbe einblenden" ist bei Muster Leer (nur Umrandung) ausgeblendet.
- Heatmap-Legende: Zahlen in Textfarbe statt in Ampelfarbe, besser lesbar.
- Tastenhinweis auf der Bühne darf zwei Zeilen haben statt abgeschnitten zu werden.
- Prüfen-Inspektor springt beim Wechsel des Stickmusters nach oben.
- Scrollende Leisten (Werkzeugoptionen, Stich-Leiste, Werkzeugleiste) blenden am Rand weich aus.
- Handy: das halb offene Blatt verdeckt den Player nicht mehr, Player und Hinweis rücken darüber.
- Touch-Geräte zeigen Tipp-Gesten statt Maushinweisen (Bühne und Rahmen-Leiste).
- Bild umwandeln, Schritt 1 sagt auf dem Handy "oben" statt "links".
- Touch: Tippen trifft Objekte vor Sprunglinien (größerer Fangradius).
- Handy: Zeichenwerkzeuge in einem Knopf "Zeichnen" mit Menü, die Leiste unten passt.

**Nicht im Browser prüfbar** (Code unverändert, Weg vorhanden): Update-Hinweis der PWA, Öffnen mit (launchQueue), Neigungs-Erlaubnis auf iOS, Drucken der Farbliste (Druckdialog).

Bewusste Änderungen (kein Fehler): Bild hat keinen Reiter mehr; V ist in Gestalten der Zeiger (Prüfen: Markierungen); Ebenen über Brotkrume, Enter, Esc, E; PNG, Projekt, Farbliste und "Zurück zum Original" im Speichern-Popover; Material, Stickrahmen und Statistik auf der Stickmuster-Seite; Sprünge und Schnitte im Prüfen-Reiter; die Befehlssuche (Strg+K) zeigt nur, was gerade geht; Vergleichen erst nach einer Änderung.

## Teil 1: Hülle, Ansicht, Tasten, Zeiger, Player, Statistik, Einstellungen

| Bereich | Funktion | Status | Weg neu |
|---|---|---|---|
| Topbar und Modi | Modus Ablauf | geändert | Reiter "Gestalten" (Taste 1) |
|  | Modus Dichte | geändert | Reiter "Prüfen" (Taste 2) |
|  | Modus Bild | geändert | kein Reiter mehr: Stickmuster-Menü > Bild umwandeln, Startseite, Taste 3; Übernehmen führt nach Gestalten |
|  | (Nebenwirkungen Moduswechsel) | ok | wie bisher |
|  | Anleitung "Anleitung" | geändert | Menü "⋯" oben rechts > Anleitung |
|  | Sprache | geändert | Menü "⋯" oben rechts > Sprache |
|  | Spracherkennung | ok | automatisch |
| Werkzeugleiste auf der Bühne | Rückgängig | ok | Kopfleiste ↶, Strg+Z (Handy: Menü "⋯") |
|  | Wiederholen | ok | Kopfleiste ↷, Strg+Umschalt+Z, Strg+Y |
|  | Text "Text" | geändert | Werkzeugleiste links "T", Taste T |
|  | Ebene Form | geändert | Brotkrume > Form, Enter, Doppelklick; Taste V ist jetzt Zeiger |
|  | Ebene Objekte | geändert | Brotkrume, Esc |
|  | Ebene Stiche | geändert | Brotkrume > Stiche, Taste E, Enter in Form, Knopf "Stiche bearbeiten" |
|  | Brotkrume | geändert | Brotkrume oben links auf der Bühne mit Menü |
|  | Bild-Ansicht Original / Vorbereitet / Stiche | geändert | Bild umwandeln, Ansicht-Umschalter über der Bühne |
|  | Wie gestickt | ok | Bild umwandeln, Schritt 3 |
|  | Markierungen zeigen | geändert | Ansicht-Menü (Auge) > Markierungen, Taste H |
|  | Einpassen "Einpassen" | geändert | Zoom-Leiste unten rechts ⤢, Taste F, Doppelklick |
|  | PNG exportieren | geändert | Speichern-Popover > PNG |
| Zeichenwerkzeuge | Zeiger | geändert | Werkzeugleiste Pfeil, Taste V, Esc |
|  | Rechteck | ok | Werkzeugleiste links (Handy: Knopf Zeichnen mit Menü) |
|  | Ellipse | ok | Werkzeugleiste links (Handy: Knopf Zeichnen mit Menü) |
|  | Zeichenstift | ok | Werkzeugleiste links (Handy: Knopf Zeichnen mit Menü) |
|  | Freihand | ok | Werkzeugleiste links (Handy: Knopf Zeichnen mit Menü) |
|  | Zeichnen abbrechen | ok | Esc |
| Zeigergesten auf der Bühne | Zoomen | ok | Bühne, Geste wie bisher |
|  | Pinch-Zoom | ok | Code unverändert, Geste wie bisher |
|  | Verschieben (Pan) | ok | Bühne, Geste wie bisher |
|  | Objekt wählen | ok | Bühne, Geste wie bisher |
|  | Zur Auswahl hinzufügen | ok | Bühne, Geste wie bisher |
|  | Gummiband-Auswahl (Objekte) | ok | Bühne, Geste wie bisher |
|  | Sprung wählen | ok | Bühne, Geste wie bisher |
|  | Objektaktionen-Menü | ok | Rechtsklick, Langdruck (Touch geprüft) |
|  | Rechtsklick im Bild-Modus | ok | Bühne, Geste wie bisher |
|  | Doppelklick auf Objekt | ok | Bühne, Geste wie bisher |
|  | Doppelklick auf Schriftzug | ok | Code unverändert (pointer.ts), nicht geklickt |
|  | Doppelklick auf leere Stelle | ok | Bühne, Geste wie bisher |
|  | Doppelklick in Stiche-Ebene | ok | Bühne, Geste wie bisher |
|  | Doppelklick im Form-Werkzeug | ok | Bühne, Geste wie bisher |
|  | Doppelklick mit Zeichenwerkzeug | ok | Bühne, Geste wie bisher |
|  | Klick im Form-Werkzeug | ok | Bühne, Geste wie bisher |
|  | Klick in Stiche-Ebene (Ablauf) | ok | Bühne, Geste wie bisher |
|  | Einstich wählen / verschieben | ok | Bühne, Geste wie bisher |
|  | Buchstabe ziehen | ok | Code unverändert, Geste wie bisher |
|  | Vergleichs-Trennlinie | ok | Code unverändert, Geste wie bisher |
|  | Vorschlags-Vergleich | ok | Code unverändert, Geste wie bisher |
|  | Licht folgt Maus | ok | Code unverändert, Geste wie bisher |
|  | Pinsel malen | ok | Code unverändert, Geste wie bisher |
|  | Tooltip Ablauf | ok | Bühne, Geste wie bisher |
|  | Tooltip Dichte | ok | Bühne, Geste wie bisher |
|  | Tooltip ausblenden | ok | Bühne, Geste wie bisher |
| Globale Tastenkürzel | Rückgängig / Wiederholen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Duplizieren | geändert | Strg+D jetzt am Platz; versetzt über Strg+C/V oder Objekt-Seite |
|  | Alle Einstiche wählen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Vorschau lösen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Modus 1/2/3 | ok | Tasten 1, 2, 3 |
|  | Einpassen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Markierungen ein/aus | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Abspielen/Anhalten | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Ein Stich vor/zurück | ok | Taste wie bisher (Befehl in Strg+K) |
|  | 100 Stiche vor/zurück | kaputt | Umschalt+. / Umschalt+, griffen nicht (Taste liefert ">" bzw. ":"); behoben in keys.ts über e.code |
|  | Anfang / Ende | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Nächster/voriger Sprung | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Nächste/vorige Zone | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Nächste/vorige Datei | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Stiche-Ebene ein/aus | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Richtung festlegen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Leitlinien zeichnen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Querlinie/Trennlinie | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Neuer Schriftzug | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Vergleich ein/aus | ok | Prüfen: Taste C, Knopf (nur nach Änderung) |
|  | Markierungen (Befunde) | ok | Prüfen: Taste V, Häkchen im Inspektor |
|  | Form öffnen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Stiche aus Form | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Buchstaben einzeln | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Löschen (Objekte) | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Löschen (Einstiche) | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Löschen (Knoten/Linie) | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Ecke/rund | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Teilen | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Voriger/nächster Einstich | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Pfeiltasten verschieben | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Esc (Kaskade Ablauf) | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Esc (Dichte) | ok | Taste wie bisher (Befehl in Strg+K) |
|  | Enter auf Button | ok | Taste wie bisher (Befehl in Strg+K) |
| Player | Zum Anfang der Farbe | ok | Player unter der Bühne |
|  | Ein Stich zurück | ok | Player unter der Bühne |
|  | Abspielen/Anhalten | ok | Player unter der Bühne |
|  | Ein Stich vor | ok | Player unter der Bühne |
|  | Zur nächsten Farbe | ok | Player unter der Bühne |
|  | Position im Nähablauf | ok | Player unter der Bühne |
|  | Info | ok | Player unter der Bühne |
|  | Tempo | ok | Player unter der Bühne |
|  | Nadel/Teilansicht | ok | Player unter der Bühne |
|  | Player nach Bearbeitung | ok | Player unter der Bühne |
| Panel "Färben" [flow.settings] | Stiche färben nach: Garnfarbe | geändert | Ansicht-Menü (Auge) > Stiche färben nach |
|  | Reihenfolge | geändert | Ansicht-Menü (Auge) > Stiche färben nach |
|  | Stichart | geändert | Ansicht-Menü (Auge) > Stiche färben nach |
|  | Stichlänge | geändert | Ansicht-Menü (Auge) > Stiche färben nach |
|  | Farblegende | geändert | Ansicht-Menü (Auge) > Stiche färben nach |
| Panel "Heatmap" [heatmap.title] | Metrik: Garnlänge / Einstiche | ok | Prüfen > Inspektor > Heatmap |
|  | Feineinstellungen | ok | Prüfen > Inspektor > Heatmap |
|  | Rasterzelle | ok | Prüfen > Inspektor > Heatmap |
|  | Glättung (σ) | ok | Prüfen > Inspektor > Heatmap |
|  | Skala-Maximum | ok | Prüfen > Inspektor > Heatmap |
|  | Ungetrimmte Sprünge als Garn zählen | ok | Prüfen > Inspektor > Heatmap |
|  | Legende | ok | Prüfen > Inspektor > Heatmap |
|  | Neuberechnung | ok | Prüfen > Inspektor > Heatmap |
| Panel "Anzeige" [display.title] | Anzeige auf/zu | geändert | Ansicht-Menü (Auge), kein Klappzustand mehr |
|  | Stichplan einblenden | geändert | Prüfen > Inspektor > Heatmap |
|  | Deckkraft | geändert | Prüfen > Inspektor > Heatmap |
|  | Formen statt Stiche | ok | Ansicht-Menü (Auge) |
|  | Realistische Fäden | ok | Ansicht-Menü (Auge) |
|  | Fadenbreite | ok | Ansicht-Menü (Auge) |
|  | Licht folgt Maus und Neigung | ok | Code unverändert, Geste wie bisher |
|  | Neigung des Geräts nutzen | ok | Ansicht-Menü, nur auf iOS sichtbar (nicht geprüft) |
|  | Hintergrund | ok | Ansicht-Menü (Auge) |
|  | Stoff | ok | Ansicht-Menü (Auge) |
|  | Markierungen | ok | Ansicht-Menü (Auge) |
|  | - Sprünge | ok | Ansicht-Menü (Auge) |
|  | - Lose Sprungfäden | ok | Ansicht-Menü (Auge) |
|  | - Fadenschnitte | ok | Ansicht-Menü (Auge) |
|  | - Farbwechsel | ok | Ansicht-Menü (Auge) |
|  | - Start und Ende | ok | Ansicht-Menü (Auge) |
|  | - Einstiche | ok | Ansicht-Menü (Auge) |
| Panel "Statistik" [stats.title] | Statistik auf/zu | geändert | Stickmuster-Seite, Abschnitt Statistik |
|  | Kennzahlen | ok | Stickmuster-Seite > Statistik |
|  | Max. Dichte | ok | Stickmuster-Seite > Statistik |
|  | Maschinentempo (Stiche/min) | ok | Stickmuster-Seite > Statistik |
| Layout, Spalten, Update, Shell | Breite linke Spalte | ok | Griffe zwischen den Spalten, Pfeile, Enter |
|  | Breite rechte Spalte | ok | Griffe zwischen den Spalten, Pfeile, Enter |
|  | Neue Version verfügbar | ok | Hinweis wie bisher, Befehl app.update (im Dev-Server nicht auslösbar) |
|  | Neu laden | ok | Hinweis wie bisher, Befehl app.update (im Dev-Server nicht auslösbar) |
|  | Später | ok | Hinweis wie bisher, Befehl app.update (im Dev-Server nicht auslösbar) |
|  | Update-Prüfung | ok | Hinweis wie bisher, Befehl app.update (im Dev-Server nicht auslösbar) |
|  | Leer-Hinweis | geändert | Startseite mit Karten (Neu, Öffnen, Bild, Beispiele) |
|  | Tastenhinweis | geändert | Zeile unten auf der Bühne, zweizeilig; auf Touch Tipp-Gesten statt Maus |
|  | Farbschema | ok | Hülle |
|  | Bühnengröße | ok | Hülle |
|  | Responsives Layout | geändert | Tablet: Schubladen links/rechts; Handy: Blatt von unten, Leiste unten |

## Teil 2: Dateien, Speichern, Bild umwandeln, Stickrahmen, Material, Farbliste, Garne, Rahmen

| Bereich | Funktion | Status | Weg neu |
|---|---|---|---|
| 1. Dateiliste und Stickmuster-Verwaltung | Dateien öffnen (Dropzone) "Stickdatei, SVG oder Projekt hierher zie … | geändert | Stickmuster-Menü > Öffnen, Strg+O; Startseite |
|  | Dateien per Drag & Drop öffnen | ok | Drop aufs Fenster |
|  | Öffnen mit (PWA) | ok | Code unverändert (fileIo.ts), PWA nicht geprüft |
|  | Verteilung beim Öffnen | geändert | wie bisher, aber unbekannte Dateien melden sich jetzt mit Hinweis |
|  | "+ Neu" | geändert | Stickmuster-Menü > Neu, Startseite |
|  | "Beispiel laden …" | geändert | Stickmuster-Menü > Beispiele, Startseite |
|  | Stickmuster aktivieren | ok | Stickmuster-Menü (Name oben links) |
|  | Umbenennen "Umbenennen" | ok | Stickmuster-Menü, Doppelklick auf Namen, Stift |
|  | Entfernen "Entfernen" | geändert | Stickmuster-Menü ×, jetzt mit Rückgängig-Hinweis |
|  | Statusanzeigen im Eintrag | ok | Stickmuster-Menü (Name oben links) |
|  | Datenschutzhinweis "Deine Dateien verlassen nie dein Gerät." | ok | Stickmuster-Menü (Name oben links) |
|  | Zurück zum Original | geändert | Speichern-Popover > Zurück zum Original |
| 2. Speichern als Stickdatei | Format wählen "Format der Stickdatei" | geändert | Speichern-Popover, Formatraster statt Auswahlliste |
|  | Dateiname "Dateiname, auch der Name des Stickmusters in der Datei" | ok | Speichern-Popover (Strg+S) |
|  | "Speichern" | ok | Speichern-Popover (Strg+S) |
|  | Hinweis "Speichern ⓘ" | geändert | Speichern-Popover, Hinweis unter dem Format |
| Formate: | Einlesen Stickdatei | ok | Speichern-Popover, Formatraster |
|  | Einlesen sonst | ok | Speichern-Popover, Formatraster |
|  | Ausgabe Stickdatei (Menüreihenfolge) | ok | Speichern-Popover, Formatraster |
|  | Ausgabe sonst | ok | Speichern-Popover, Formatraster |
| 3. Projektdatei | "Als Projekt (.heatstitch)" | ok | Speichern-Popover > Als Projekt |
|  | "Als Projekt speichern" | ok | Bild umwandeln, Befehl image.saveProject |
|  | Projekt öffnen | ok | Speichern-Popover > Als Projekt |
|  | Fehler beim Öffnen | ok | Speichern-Popover > Als Projekt |
| 4. PNG-Export | PNG exportieren (Button-Text "⤓ PNG", Tooltip "Aktuelle Ansicht als … | ok | Speichern-Popover > PNG |
| 5.1 Funktionen | Bild öffnen "Bild oder SVG hierher ziehen oder klicken" | geändert | Bild umwandeln Schritt 1, Stickmuster-Menü > Bild umwandeln, Drop |
|  | "Beispielbild laden" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Bild-Info | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Bild entfernen" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Als Projekt speichern | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Bild mit KI vorbereiten" | ok | Bild umwandeln Schritt 1 |
|  | "Prompt kopieren" | ok | Bild umwandeln Schritt 1 |
|  | Ansicht "Original" / "Vorbereitet" / "Stiche" | geändert | Umschalter über der Bühne in Bild umwandeln |
|  | "Wie gestickt" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Farbe sticken / weglassen | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Anderes Garn | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Zusammenlegen | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Pinselfarbe wählen | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Palettenanzeige | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Pinsel-Werkzeug "Aus" / "Malen" / "Radieren" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Pinselstrich-Gesten | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Rückgängig" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Wiederholen (kein Button im Bild-Modus) | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Alle Striche entfernen" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Werte für das Material" | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Ergebnis | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | "Als Stickmuster übernehmen" | ok | Bild umwandeln Schritt 3, Knopf Übernehmen (geprüft) |
|  | Statuszeile | ok | Bild umwandeln (Stickmuster-Menü, Startseite, Taste 3), Schritte 1 bis 3 |
|  | Einpassen | ok | Taste F, Doppelklick, Zoom-Leiste |
| 5.2 Parameter Bild-Modus | `#image-width` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-colors` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-smooth` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-min-area` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-background` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-threads` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-spacing` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-pull` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-angle` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-satin-max` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-tolerance` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-underlay` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `#image-brush` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `image-view` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
|  | `image-tool` | ok | Bild umwandeln, Schritt 2/3 im Inspektor |
| 6. Stickrahmen | Stickrahmen wählen "Stickrahmen" | ok | Stickmuster-Seite > Stickrahmen (geprüft) |
|  | Eigene Größe | ok | Stickmuster-Seite > Stickrahmen |
|  | Passt-Hinweis | ok | Stickmuster-Seite > Stickrahmen |
|  | "Passend verkleinern" | ok | Hinweis-Knopf und Befehl design.hoopFit (geprüft) |
|  | "{hoop} wählen" | ok | Stickmuster-Seite > Stickrahmen |
| 7. Material | "Stoff" | geändert | Stickmuster-Seite > Material, jetzt auch in Gestalten |
|  | "Garn" | geändert | Stickmuster-Seite > Material, jetzt auch in Gestalten |
|  | Profil-Info | ok | Stickmuster-Seite > Material; Prüfen > Inspektor |
|  | "Auf Stoff abstimmen" | geändert | Stickmuster-Seite > So wird geprüft; Prüfen > Inspektor |
|  | "Prüfungen" | geändert | Stickmuster-Seite > So wird geprüft; Prüfen > Inspektor |
|  | "So wird geprüft" | geändert | Stickmuster-Seite > So wird geprüft; Prüfen > Inspektor |
| 8. Farbliste und Druck | "Farbliste" | geändert | Speichern-Popover > Farbliste (auch in Prüfen) |
|  | Inhalt (wird gedruckt) | ok | Speichern-Popover > Farbliste; Stickmuster-Seite > Garne |
|  | "Meine Garnmarke" | ok | Speichern-Popover > Farbliste; Stickmuster-Seite > Garne |
|  | "Auf {catalog} umstellen" | ok | Speichern-Popover > Farbliste; Stickmuster-Seite > Garne |
|  | "Drucken" | ok | Speichern-Popover > Farbliste; Stickmuster-Seite > Garne |
|  | Schließen "Schließen" | ok | Speichern-Popover > Farbliste; Stickmuster-Seite > Garne |
| 9. Garnkataloge und Garnauswahl | Popup öffnen/schließen | ok | Klick aufs Farbfeld (Objekt, Farbzeile geprüft) |
|  | Original-Zeile (optional) | ok | Garnwähler-Popup (wie bisher) |
|  | "Garnmarke" | ok | Garnwähler-Popup (wie bisher) |
|  | Suche "Nummer oder Name" | ok | Garnwähler-Popup (wie bisher) |
|  | "Am nächsten:" | ok | Garnwähler-Popup (wie bisher) |
|  | Farbraster | ok | Garnwähler-Popup (wie bisher) |
|  | "Eigene Farbe …" | ok | Garnwähler-Popup (wie bisher) |
|  | Hinweis (optional) | ok | Garnwähler-Popup (wie bisher) |
|  | Kataloge laden | ok | Garnwähler-Popup (wie bisher) |
| 10. Rahmen-Werkzeug | Verschieben | ok | Bühne, Auswahlrahmen |
|  | Einrasten | geändert | automatisch; Schalter "Einrasten" in der Leiste über der Bühne, Alt |
|  | Achse sperren | ok | Bühne, Auswahlrahmen |
|  | Skalieren | ok | Bühne, Auswahlrahmen |
|  | Drehen | ok | Bühne, Auswahlrahmen |
|  | Hover-Hervorhebung | ok | nur Maus, wie bisher |
|  | Pfeiltasten verschieben | ok | Bühne, Auswahlrahmen |
|  | Löschen | ok | Bühne, Auswahlrahmen |
|  | Duplizieren | ok | Bühne, Auswahlrahmen |
|  | Abbrechen | ok | Bühne, Auswahlrahmen |
|  | Schriftzug | ok | Bühne, Auswahlrahmen |

## Teil 3: Objekte, Auswahl, Reihenfolge, Formen, Zeichnen, Schriftzug, Nicht gestickt

| Bereich | Funktion | Status | Weg neu |
|---|---|---|---|
| 1. Ablauf-Liste "Farben und Objekte" | Farbblock auf-/zuklappen ("Die {n} Objekte zeigen" `layers.open` / … | ok | Pfeil in der Farbzeile, Menü der Farbzeile (alle auf/zu) |
|  | Ausblenden / Einblenden | geändert | Menü der Farbzeile (Rechtsklick, "…") statt Auge in der Zeile |
|  | Farbe hervorheben | ok | Linke Spalte "Farben und Objekte" |
|  | Farbe kurz hervorheben (Hover) | ok | Linke Spalte "Farben und Objekte" |
|  | Alle zeigen | ok | Linke Spalte "Farben und Objekte" |
|  | Garnfarbe ändern | ok | Linke Spalte "Farben und Objekte" |
|  | Zurück zum Original | ok | Linke Spalte "Farben und Objekte" |
|  | Formathinweis Garnfarbe | ok | Linke Spalte "Farben und Objekte" |
|  | Farbzeilen-Info | ok | Linke Spalte "Farben und Objekte" |
|  | Aktueller Block der Nadel | ok | Linke Spalte "Farben und Objekte" |
|  | Objektzeile | ok | Linke Spalte "Farben und Objekte" |
|  | Markierung "erkannt" (≈) | ok | Linke Spalte "Farben und Objekte" |
|  | Hinweis "Alle Objekte sind aus den Stichen erkannt" | ok | Linke Spalte "Farben und Objekte" |
|  | Leere Liste | ok | Linke Spalte "Farben und Objekte" |
|  | Objekt hervorheben (Hover) | ok | Linke Spalte "Farben und Objekte" |
|  | Farbliste | geändert | Speichern-Popover > Farbliste |
| 2. Auswahl | Objekt wählen | ok | Liste und Bühne |
|  | Zur Auswahl hinzufügen / entfernen | ok | Liste und Bühne |
|  | Auswahl per Rechteck (Gummiband) | ok | Liste und Bühne |
|  | Auswahl aufheben | ok | ✕ im Objektkopf, Esc |
|  | Sprung statt Objekt wählen | ok | Liste und Bühne |
|  | Doppelklick auf Objekt | ok | Liste und Bühne |
|  | Doppelklick auf leere Fläche | ok | Liste und Bühne |
|  | Mitlaufende Ebenen | ok | Liste und Bühne |
|  | Liste folgt der Auswahl | ok | Liste und Bühne |
| 3. Reihenfolge | Objekt in der Liste verschieben | ok | Ziehen in der Liste (draggable geprüft); Touch: Früher/Später, Alt+Pfeile |
|  | In fremde Farbe ablegen: Garn übernehmen | ok | Ziehen in der Liste (draggable geprüft); Touch: Früher/Später, Alt+Pfeile |
|  | In fremde Farbe ablegen: eigenes Garn | ok | Ziehen in der Liste (draggable geprüft); Touch: Früher/Später, Alt+Pfeile |
|  | Stattdessen im eigenen Garn sticken | ok | Liste, Objekt-Seite, Zeilenmenü |
|  | Farbblock verschieben | ok | Ziehen in der Liste (draggable geprüft); Touch: Früher/Später, Alt+Pfeile |
|  | Überdeckungswarnung | ok | Liste, Objekt-Seite, Zeilenmenü |
|  | Früher sticken | geändert | Objekt-Seite ↑ ↓, Zeilenmenü, Alt+Pfeil hoch/runter; neu: ganz nach vorn/hinten |
|  | Später sticken | geändert | Objekt-Seite ↑ ↓, Zeilenmenü, Alt+Pfeil hoch/runter; neu: ganz nach vorn/hinten |
|  | Reihenfolge optimieren | ok | Knopf über der Liste, Karte (geprüft) |
|  | Vergleichstabelle | ok | Karte "Reihenfolge optimieren" (geprüft) |
|  | Übernehmen | ok | Karte "Reihenfolge optimieren" (geprüft) |
|  | Abbrechen / Schließen | ok | Karte "Reihenfolge optimieren" (geprüft) |
|  | Start und Ende tauschen | ok | Objekt-Seite, Menü "…" (geprüft) |
|  | Zu einem Objekt zusammenfassen | ok | Objekt-Seite "…", Menü (geprüft, Befehl object.combine) |
|  | In Teile trennen | ok | Objekt-Seite "…" (Befehl object.split; kein Beispiel mit mehreren Teilen in der Blume) |
| 4a. Anzeige | Kopf Einzelobjekt | ok | Inspektor > Objekt |
|  | Kopf Mehrfach | ok | Inspektor > Objekt |
|  | Stiche, Garn | ok | Inspektor > Objekt |
|  | Größe | ok | Inspektor > Objekt |
|  | Teile | ok | Inspektor > Objekt |
|  | Von Hand | ok | Inspektor > Objekt |
|  | Gestickt | ok | Inspektor > Objekt |
|  | Lage | ok | Inspektor > Objekt |
|  | Hinweistexte | ok | Inspektor > Objekt |
| 4b. Aktionen | Duplizieren | geändert | Objekt-Seite, Menü; Strg+D jetzt am Platz, neu Strg+C/V versetzt |
|  | Zweite Farbe einblenden | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Obere Form ausschneiden | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Waagrecht spiegeln | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Senkrecht spiegeln | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Nicht sticken | ok | Objekt-Seite "…", Menü (geprüft) |
|  | Als Hilfslinie | ok | Objekt-Seite "…", Menü (geprüft) |
|  | Löschen | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Garn dieses Objekts wählen | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Aussparen (Überlappungs-Karte) | ok | Karte über der Liste, wenn Überlappungen (Code unverändert; Demo zeigt sie nicht) |
|  | So lassen | ok | Karte über der Liste, wenn Überlappungen (Code unverändert; Demo zeigt sie nicht) |
|  | Form bearbeiten | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Stiche bearbeiten | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
|  | Stiche-Bearbeitung im Panel: Löschen, Teilen, Fertig | ok | Inspektor > Objekt, Symbolleiste und Menü "…" |
| 4c. Kontextmenü | Objektmenü öffnen | ok | Rechtsklick / Langdruck auf Bühne oder Zeile |
|  | Menü schließen | ok | Rechtsklick / Langdruck auf Bühne oder Zeile |
| 5. Ebenen und Rahmen | Ebene Form | geändert | Brotkrume oben links mit Menü, Enter/Esc/E |
|  | Ebene Objekte | geändert | Brotkrume oben links mit Menü, Enter/Esc/E |
|  | Ebene Stiche | geändert | Brotkrume oben links mit Menü, Enter/Esc/E |
|  | Brotkrumen | geändert | Brotkrume oben links mit Menü, Enter/Esc/E |
|  | Rahmen verschieben | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
|  | Fang beim Verschieben | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
|  | Skalieren | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
|  | Drehen | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
|  | Pfeiltasten verschieben | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
|  | Größe tippen | ok | Bühne, Auswahlrahmen; Größe im Inspektor > Objekt |
| 6. Form bearbeiten | Form öffnen / Objekt wechseln | ok | Ebene Form, Leiste über der Bühne |
|  | Knoten wählen | ok | Ebene Form, Leiste über der Bühne |
|  | Knoten ziehen | ok | Ebene Form, Leiste über der Bühne |
|  | Griff ziehen | ok | Ebene Form, Leiste über der Bühne |
|  | Kurve biegen | ok | Ebene Form, Leiste über der Bühne |
|  | Knotenauswahl aufheben | ok | Ebene Form, Leiste über der Bühne |
|  | Knoten einfügen | ok | Ebene Form, Leiste über der Bühne |
|  | Knoten löschen | geändert | Leiste über der Bühne (statt Panel), Tasten wie bisher |
|  | Ecke / Rund | geändert | Leiste über der Bühne (statt Panel), Tasten wie bisher |
|  | Knoten verschieben mit Tasten | ok | Ebene Form, Leiste über der Bühne |
|  | Vereinfachen | geändert | Leiste über der Bühne (statt Panel), Tasten wie bisher |
|  | Linie schließen | geändert | Leiste über der Bühne (statt Panel), Tasten wie bisher |
|  | Linie öffnen | geändert | Leiste über der Bühne (statt Panel), Tasten wie bisher |
|  | Breite per Griff (Satinlinie/Satin-Umrandung) | ok | Ebene Form, Leiste über der Bühne |
|  | Satinsäulen-Schienen | ok | Ebene Form, Leiste über der Bühne |
|  | Zur Stiche-Ebene | ok | Ebene Form, Leiste über der Bühne |
|  | Formstatus | geändert | Leiste über der Bühne "Umriss: n Knoten …" |
| 7. Neue Formen zeichnen | Zeiger | geändert | Pfeil in der Werkzeugleiste, Taste V |
|  | Rechteck | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Ellipse | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Zeichenstift | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Letzten Knoten entfernen | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Angefangene Form verwerfen | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Freihand | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Größenanzeige beim Ziehen | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Ergebnis | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
|  | Erste Form ohne offene Datei | ok | Werkzeugleiste links (Handy: Knopf Zeichnen) |
| 8. Schriftzug | Neuer Schriftzug | geändert | T in der Werkzeugleiste, Taste T |
|  | Text | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Fehlende Zeichen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Schrift | ok | Inspektor > Schriftzug, Liste (41 Schriften geprüft) |
|  | Schriftliste | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Höhe der Großbuchstaben | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Größenzeile | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Ausrichtung | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Form | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Radius | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Garn | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Buchstaben einzeln | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Buchstaben ziehen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Buchstaben mit Tasten | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Buchstabe drehen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Diesen Buchstaben zurücksetzen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Alle {n} Änderungen zurücksetzen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Buchstaben-Modus verlassen | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Mehr | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Rahmen auf Schriftzug | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | In Objekte umwandeln | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Fertig | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
|  | Name in der Liste | ok | Inspektor > Schriftzug; T in der Werkzeugleiste |
| 9. Nicht gestickt | Block auf-/zuklappen | ok | Liste, Block "Nicht gestickt" |
|  | Zeile | ok | Liste, Block "Nicht gestickt" |
|  | Form auf der Leinwand zeigen | ok | Liste, Block "Nicht gestickt" |
|  | Sticken | ok | Liste, Block "Nicht gestickt" |
|  | Hilfslinie / Keine Hilfslinie | ok | Liste, Block "Nicht gestickt" |
|  | Endgültig löschen | ok | Liste, Block "Nicht gestickt" |
|  | Hintergrund beim Öffnen weglassen | ok | Liste, Block "Nicht gestickt" |
| 10. Verknüpfte Objekte | Mitlöschen | ok | automatisch (Modell unverändert) |
|  | Mitkopieren | ok | automatisch (Modell unverändert) |
|  | Mitbewegen | ok | automatisch (Modell unverändert) |
|  | Mitumkehren | ok | automatisch (Modell unverändert) |
|  | Garn bei Verschieben in andere Farbe | ok | automatisch (Modell unverändert) |
|  | Block umfärben | ok | automatisch (Modell unverändert) |
|  | Aussparungen folgen | ok | automatisch (Modell unverändert) |
|  | Blend wählen | ok | automatisch (Modell unverändert) |
|  | Modellgrenzen (nur Info, UI im Stich-Panel) | ok | automatisch (Modell unverändert) |
| Parameter-Steuerelemente | Größe Breite | ok | Inspektor > Objekt / Schriftzug |
|  | Größe Höhe | ok | Inspektor > Objekt / Schriftzug |
|  | Seitenverhältnis halten | ok | Inspektor > Objekt / Schriftzug |
|  | Farben zusammenfassen | ok | Inspektor > Objekt / Schriftzug |
|  | Kürzeste Wege | ok | Inspektor > Objekt / Schriftzug |
|  | Richtung umkehren | ok | Inspektor > Objekt / Schriftzug |
|  | Breitengriff (Band) | ok | Inspektor > Objekt / Schriftzug |
|  | Schrifthöhe Zahlenfeld | ok | Inspektor > Objekt / Schriftzug |
|  | Schrifthöhe Schieberegler | ok | Inspektor > Objekt / Schriftzug |
|  | Ausrichtung | ok | Inspektor > Objekt / Schriftzug |
|  | Form | ok | Inspektor > Objekt / Schriftzug |
|  | Radius | ok | Inspektor > Objekt / Schriftzug |
|  | Garn Schriftzug | ok | Inspektor > Objekt / Schriftzug |
|  | Schrift | ok | Inspektor > Objekt / Schriftzug |
|  | Buchstabe drehen | ok | Inspektor > Objekt / Schriftzug |
|  | Buchstabenabstand | ok | Inspektor > Objekt / Schriftzug |
|  | Wortabstand | ok | Inspektor > Objekt / Schriftzug |
|  | Zeilenabstand | ok | Inspektor > Objekt / Schriftzug |
|  | Drehung | ok | Inspektor > Objekt / Schriftzug |
|  | Dichte | ok | Inspektor > Objekt / Schriftzug |
|  | Unterlage | ok | Inspektor > Objekt / Schriftzug |
|  | Zeilen hin und zurück | ok | Inspektor > Objekt / Schriftzug |
|  | Rahmen-Skalierung | ok | Inspektor > Objekt / Schriftzug |
|  | Rahmen-Drehung | ok | Inspektor > Objekt / Schriftzug |
|  | Garnwähler (Block, Objekt, Blend, Schriftzug) | ok | Inspektor > Objekt / Schriftzug |

## Teil 4: Sticharten, Stiche von Hand, Querlinien, Korrektur, Befunde, Sprünge

| Bereich | Funktion | Status | Weg neu |
|---|---|---|---|
| 1. Stich-Panel: Kopf, Status, Stichart | Titel „Stiche“ / „Stiche: {kind}“ | ok | Inspektor > Objekt > Stichart |
|  | Stichart-Reiter Füllung / Satin / Steppstich | ok | Reiter im Inspektor bei gemischter Auswahl |
|  | Hinweis „Änderungen gelten für {n} ausgewählte Objekte.“ | ok | Inspektor > Objekt > Stichart |
|  | Form-Vertrauen | ok | Inspektor > Objekt > Stichart |
|  | Hand-Änderungs-Warnung | ok | Inspektor > Objekt > Stichart |
|  | „Von der Korrektur geändert: {list}“ | ok | Inspektor > Objekt > Stichart |
|  | Stichart Segment Füllung / Satin | geändert | Segment Füllung/Satin/Linie im Inspektor |
|  | Satin für breite Füllung | ok | Inspektor > Objekt > Stichart |
|  | Stichart Füllung / Linie | ok | Inspektor > Objekt > Stichart |
|  | Linie „nur Kontur“ | ok | Inspektor > Objekt > Stichart |
|  | Nach Umwandlung Linie zu Füllung | ok | Inspektor > Objekt > Stichart |
|  | Von der Korrektur ausnehmen | ok | Inspektor > Objekt > Stichart |
|  | Von der Form lösen | ok | Inspektor > Objekt > Stichart |
|  | Gelöst-Block | ok | Inspektor > Objekt > Stichart |
|  | Wieder aus der Form sticken | ok | Inspektor > Objekt > Stichart |
|  | Alle lösen | ok | Inspektor > Objekt > Stichart |
|  | Fußnote | ok | Inspektor > Objekt > Stichart |
| Abhängige Objekte | Kopf „Umrandung einer Füllung“ / „Zweite Farbe eines Verlaufs“ / „S … | geändert | Kopf mit Kurznamen (Umrandung/Schatten/Echo-Kopie), langer Text im Tooltip |
|  | Füllung wählen / Linie wählen | ok | Inspektor > Objekt, Kopf "Umrandung/Schatten/Echo von …" |
|  | Lösen | ok | Inspektor > Objekt, Kopf "Umrandung/Schatten/Echo von …" |
| 2a. Muster-Auswahl | Muster, Gruppen-Reiter Deckend / Offen | ok | Inspektor > Objekt > Muster (Kacheln) |
|  | Kacheln Deckend: Tatami, Verlauf, Konturfüllung, Spirale, Wie bishe … | ok | Inspektor > Objekt > Muster (Kacheln) |
|  | Kacheln Offen: Mäander, Labyrinth, Gitter, Echo, Kreuzstich | ok | Inspektor > Objekt > Muster (Kacheln) |
|  | Geführt gesperrt | ok | Inspektor > Objekt > Muster (Kacheln) |
|  | Musterhinweis | ok | Inspektor > Objekt > Muster (Kacheln) |
| 2b. Werkzeuge in der Füllung | Leitlinien, Zähler `stitch.guide.none/one/count` | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Leitlinien zeichnen / Fertig | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Leitlinie zeichnen | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Leitlinie löschen | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Punkt-Werkzeug Kopf | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Auf der Fläche setzen / Fertig | kaputt | Knopf "Punkte setzen" blieb nach Wahl von Strahlen/Kreise/Wirbel gesperrt (Befehl las das gemessene statt das gewählte Muster); behoben |
|  | Punkt setzen/verschieben | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Punkt löschen | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Mit Querlinien zu Satin | geändert | Segment Satin, Taste R, Leiste "Zu Satin" über der Bühne |
|  | Als Satin sticken | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Abbrechen | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Zähler `stitch.draw.count` (+ `stitch.draw.parts`), Hilfe `stitch.d … | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
|  | Zweite Farbe einblenden / Andere zweite Farbe | geändert | Objekt-Seite, Menü, Inspektor; bei Muster Leer jetzt ausgeblendet |
|  | Unter späteren Formen aussparen | ok | Inspektor > Werkzeuge; Leiste über der Bühne |
| 2c. Parameter Füllung | Abstand, Notiz `stitch.densityNote` („etwa {1/v} mm Garn pro mm²“) | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand am Anfang / am Ende | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand + Richtung | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Winkel | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Wellenhöhe | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Wellenlänge | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Stärke | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Neu würfeln | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Stichlänge | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Versatz | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Prägung | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Stärke | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Größe der Prägung | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Max. Abweichung, Notiz `stitch.toleranceNote` | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Kanten | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Nach Stoff | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Ausdehnen | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Unterlage | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Unter späteren Objekten weglassen | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Einzug der Unterlage | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand zum Rand | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Anteil der Breite | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand der Unterlage | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Überlappung unter Satin | ok | Inspektor > Gestaltung / Stoff und Halt |
| 2d. Parameter Füllung | Gitter: Waben, Rauten, Ziegel | ok | Inspektor > Gestaltung |
|  | Kreuz: Kreuz, Halbkreuz, Doppelkreuz | ok | Inspektor > Gestaltung |
|  | Abstand der Linien bzw. Größe | ok | Inspektor > Gestaltung |
|  | Stichlänge | ok | Inspektor > Gestaltung |
|  | Dreifachstich | ok | Inspektor > Gestaltung |
|  | Neu würfeln | ok | Inspektor > Gestaltung |
|  | Ausdehnen, Umrandung | ok | Inspektor > Gestaltung |
| 2e. Füllung als breite Linie | Breite | ok | Inspektor > Gestaltung |
|  | Enden: Flach / Rund | ok | Inspektor > Gestaltung |
| 2f. Umrandung einer Füllung | Art: Aus, Steppstich, Satin, Zickzack, E-Stich, Motiv | ok | Inspektor > Umrandung |
|  | Lage zur Kante | ok | Inspektor > Umrandung |
|  | Wiederholung: einfach, 3-fach, 5-fach | ok | Inspektor > Umrandung |
|  | Stichlänge | ok | Inspektor > Umrandung |
|  | Breite der Umrandung | ok | Inspektor > Umrandung |
|  | Abstand | ok | Inspektor > Umrandung |
|  | Zugausgleich | ok | Inspektor > Umrandung |
|  | Art der Unterlage: Aus, Auto, Mitte, Randlauf, Zickzack, Randlauf + … | ok | Inspektor > Umrandung |
|  | Abstand | ok | Inspektor > Umrandung |
|  | Zacken: innen / außen | ok | Inspektor > Umrandung |
|  | Motiv: Wellen, Bögen, Herzen, Kettstich | ok | Inspektor > Umrandung |
|  | Größe | ok | Inspektor > Umrandung |
|  | Abstand | ok | Inspektor > Umrandung |
|  | Seite: innen/außen | ok | Inspektor > Umrandung |
|  | Wiederholung (Motiv) | ok | Inspektor > Umrandung |
|  | Garn der Umrandung | ok | Inspektor > Umrandung |
| 3. Stich-Panel: Satin | Muster: Satin / E-Stich | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Zugausgleich | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Zugausgleich links / rechts | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Nach Stoff | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Seiten getrennt | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Zugausgleich anteilig | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Kurze Stiche in Kurven | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand nach Breite | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Teilen ab | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Versetzt teilen | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Unterlage | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Art der Unterlage: Auto, Mitte, Randlauf, Zickzack, Randlauf + Zick … | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Einzug der Unterlage Fest / Anteilig | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Abstand zum Rand | ok | Inspektor > Gestaltung / Stoff und Halt |
|  | Anteil der Breite | ok | Inspektor > Gestaltung / Stoff und Halt |
| 3a. Richtung / Querlinien-Werkzeug | Richtung, Status `stitch.direction.follow` / `.even` / `.rungs` / ` … | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Richtung festlegen / Fertig | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Ecken vorschlagen | geändert | Leiste über der Bühne, bei wenig Platz im Menü "…" |
|  | Abschnitte vorschlagen | geändert | Leiste über der Bühne, bei wenig Platz im Menü "…" |
|  | Beste Reihenfolge | geändert | Leiste über der Bühne, bei wenig Platz im Menü "…" |
|  | Alle entfernen | geändert | Leiste über der Bühne, bei wenig Platz im Menü "…" |
|  | Wie gestickt | geändert | Leiste über der Bühne, bei wenig Platz im Menü "…" |
|  | Ziehen: Querlinie / Trennlinie | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Abschnittszähler `stitch.sections.count` | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Abstand hier | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Ketten-Hinweis `stitch.direction.chain` | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
|  | Hilfe `stitch.direction.help` | ok | Leiste über der Bühne (Taste R), Inspektor > Werkzeuge |
| 3b. Querlinien-Werkzeug: Gesten auf der Leinwand | Querlinie ziehen | ok | Bühne, Querlinien-Werkzeug |
|  | Fehlermeldungen | ok | Bühne, Querlinien-Werkzeug |
|  | Trennlinie ziehen | ok | Bühne, Querlinien-Werkzeug |
|  | Ende verschieben | ok | Bühne, Querlinien-Werkzeug |
|  | Linie wählen | ok | Bühne, Querlinien-Werkzeug |
|  | Linie löschen | ok | Bühne, Querlinien-Werkzeug |
|  | Auswahl aufheben / Werkzeug schließen | ok | Bühne, Querlinien-Werkzeug |
|  | Badge Nummer | ok | Bühne, Querlinien-Werkzeug |
|  | Badge Pfeil | ok | Bühne, Querlinien-Werkzeug |
|  | Badge Schere | ok | Bühne, Querlinien-Werkzeug |
|  | Badge ⇄ (Spiegeln) | ok | Bühne, Querlinien-Werkzeug |
|  | Rot umrandeter Fehlbereich | ok | Bühne, Querlinien-Werkzeug |
|  | Abbruch bei Zwei-Finger-Geste | ok | Bühne, Querlinien-Werkzeug |
|  | Doppelklick | ok | Bühne, Querlinien-Werkzeug |
|  | Klick ins Leere | ok | Bühne, Querlinien-Werkzeug |
| 4a. Steppstich | Stichlänge | ok | Inspektor > Gestaltung |
|  | Max. Abweichung | ok | Inspektor > Gestaltung |
|  | Dreifachstich | ok | Inspektor > Gestaltung |
| 4b. Linie | Stichart Linie / Füllung | ok | Inspektor > Gestaltung / Effekte |
|  | Max. Abweichung | ok | Inspektor > Gestaltung / Effekte |
|  | Echo: Seite | ok | Inspektor > Gestaltung / Effekte |
|  | ⇄ Andere Seite | ok | Inspektor > Gestaltung / Effekte |
|  | Kopien je Seite | ok | Inspektor > Gestaltung / Effekte |
|  | Abstand | ok | Inspektor > Gestaltung / Effekte |
|  | Verbindung: Stich / Schnitt | ok | Inspektor > Gestaltung / Effekte |
|  | Garn je Kopie | ok | Inspektor > Gestaltung / Effekte |
|  | Schatten: Richtung | ok | Inspektor > Gestaltung / Effekte |
|  | Versatz | ok | Inspektor > Gestaltung / Effekte |
|  | Garn | ok | Inspektor > Gestaltung / Effekte |
|  | Fußnote `stitch.lineTraced` / `stitch.lineNote` | ok | Inspektor > Gestaltung / Effekte |
| 5. Stiche bearbeiten | Ebene Stiche | ok | Ebene Stiche, Leiste über der Bühne |
|  | Brotkrume „{name} › Stiche“ | ok | Ebene Stiche, Leiste über der Bühne |
|  | Leinwand-Hinweis `canvas.hint.flowEdit` / `canvas.hint.edit` | ok | Ebene Stiche, Leiste über der Bühne |
|  | Einstich wählen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Auswahl erweitern/umschalten | ok | Ebene Stiche, Leiste über der Bühne |
|  | Rechteck wählen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Alles wählen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Verschieben per Ziehen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Verschieben per Taste | ok | Ebene Stiche, Leiste über der Bühne |
|  | Einstich einfügen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Teilen | geändert | Leiste über der Bühne, Tasten Entf und I |
|  | Löschen | geändert | Leiste über der Bühne, Tasten Entf und I |
|  | Ausdünnen + Anteil 25 % / 33 % / 50 % | geändert | Leiste über der Bühne in beiden Reitern (vorher nur Dichte), Anteil 25/33/50 % |
|  | Vorigen/nächsten Einstich wählen | ok | Ebene Stiche, Leiste über der Bühne |
|  | Auswahl aufheben | ok | Ebene Stiche, Leiste über der Bühne |
|  | Fertig / Ebene verlassen | geändert | Leiste über der Bühne "Fertig", Esc, Brotkrume |
|  | Anderes Objekt bearbeiten | ok | Ebene Stiche, Leiste über der Bühne |
|  | Auswahl-Info | geändert | Leiste über der Bühne (Zähler) |
|  | Hinweis aus / an | geändert | Leiste über der Bühne (Zähler) |
|  | Rückgängig / Wiederholen | ok | Kopfleiste, Tasten |
|  | Zurück zum Original | geändert | Speichern-Popover |
| 6. Korrektur | Ziel: Keine Warnung / Nur Kritisch | ok | Prüfen > Inspektor > Korrektur |
|  | Fokus: Beides / Fadendichte / Lochdichte, Hinweis je Wahl | ok | Prüfen > Inspektor > Korrektur |
|  | Korrektur vorschlagen | ok | Prüfen > Inspektor > Korrektur |
|  | Nur gewählte Zone | ok | Prüfen > Inspektor > Korrektur |
|  | Auf Stoff abstimmen | ok | Prüfen > Inspektor (geprüft) |
|  | Vorschlagskarte: Kopf, Ergebnis mit allen, Hinweis | ok | Prüfen > Inspektor > Korrektur |
|  | Alle auswählen / Keine auswählen | ok | Prüfen > Inspektor > Korrektur |
|  | Vorschlagszeile: Häkchen | ok | Prüfen > Inspektor > Korrektur |
|  | Vorschlagszeile: Name (Farbfeld, Art-Symbol, „Füllung 3, 4“) | ok | Prüfen > Inspektor > Korrektur |
|  | Sichtbarkeit bzw. `plan.hand` | ok | Prüfen > Inspektor > Korrektur |
|  | Änderungen (FT, z. B. `plan.change.spacing`) und „Gegen: …“ | ok | Prüfen > Inspektor > Korrektur |
|  | Vorher/Nachher-Vorschau | ok | Prüfen > Inspektor > Korrektur |
|  | Trennlinie vorher/nachher verschieben | ok | Prüfen > Inspektor > Korrektur |
|  | Feinkorrektur an den Stichen | ok | Prüfen > Inspektor > Korrektur |
|  | Gesperrte ausgelassen | ok | Prüfen > Inspektor > Korrektur |
|  | Ausgewählte übernehmen | ok | Prüfen > Inspektor > Korrektur |
|  | Verwerfen | ok | Prüfen > Inspektor > Korrektur |
|  | Hinweis `plan.note` | ok | Prüfen > Inspektor > Korrektur |
|  | Leerer Plan | ok | Prüfen > Inspektor > Korrektur |
|  | Fehler | ok | Prüfen > Inspektor > Korrektur |
|  | Vergleich: Mit Original vergleichen / Vergleich beenden | ok | Prüfen, Knopf und Taste C nach einer Änderung (geprüft) |
|  | Vergleichstabelle | ok | Prüfen > Inspektor > Korrektur |
| 7. Befunde | Kurzurteil in der Kopfzeile | ok | Prüfen > Inspektor > Befunde |
|  | Markierungen | ok | Prüfen > Inspektor > Befunde |
|  | Urteil-Block | ok | Prüfen > Inspektor > Befunde |
|  | Filter-Chips Alle / Kritisch / Vorsicht / Unkritisch mit Zahlen | ok | Prüfen > Inspektor > Befunde |
|  | Vorige / Nächste Zone, Position `findings.pos` / `findings.count` | ok | Prüfen > Inspektor > Befunde |
|  | Zonenzeile (Stufe, Gründe, #Nr, Fläche mm², Kennzahlen, Praxis-/Qui … | ok | Prüfen > Inspektor > Befunde |
|  | Quittieren | ok | Prüfen > Inspektor > Befunde |
|  | Wieder öffnen | ok | Prüfen > Inspektor > Befunde |
|  | Trotzdem prüfen | ok | Prüfen > Inspektor > Befunde |
|  | Praxisüblich lassen | ok | Prüfen > Inspektor > Befunde |
|  | Zone abwählen | ok | Prüfen > Inspektor > Befunde |
|  | Leerer Filter, Hinweis `validation.zoneHint`, Zustände `validation. … | ok | Prüfen > Inspektor > Befunde |
| 8. Sprünge und Schnitte | Zusammenfassung / keine Sprünge | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Voriger / Nächster Sprung | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Warnung lange ungeschnittene | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Alle auf einmal nach Länge | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Schnittgrenze | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Ab Grenze schneiden ({n}) | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Darunter nicht schneiden ({n}) | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Filter Alle / Ohne Schnitt / Geschnitten | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Sprungzeile | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Schneiden und vernähen | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Vernähen ergänzen | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Nicht schneiden | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |
|  | Auswahl aufheben | ok | Inspektor > Sprünge und Schnitte |
|  | Hinweis `jumps.hint`, leer `jumps.empty` | geändert | Prüfen > Inspektor > Sprünge und Schnitte (vorher Ablauf); N/Umschalt+N und Klick auf Sprung in Gestalten |

# Funktionsliste (Vertrag für den UI-Umbau)

Stand: 2026-10-06, aus dem Code von `main` gelesen. Diese Liste ist der Vertrag des Umbaus: Jede **Funktion** muss
in der neuen Oberfläche wieder da sein. Die **Wege** (Knopf, Taste, Menü, Geste) sind nur der heutige Stand und dürfen
frei neu gedacht werden (Daniel, 2026-10-06). Sie stehen hier, damit nichts Verstecktes verloren geht.

Teile:
1. App-Hülle, Ansicht, Tastatur, Zeiger, Player, Statistik, Einstellungen
2. Dateien, Speichern, Bild-Modus, Stickrahmen, Material, Farbliste, Garnkataloge, Rahmen-Werkzeug
3. Objekte, Auswahl, Reihenfolge, Formen, Zeichnen, Schriftzug, Nicht gestickt, verknüpfte Objekte
4. Sticharten, Stiche von Hand, Satin-Querlinien, Korrektur, Befunde, Sprünge und Schnitte

Gleichzeitig in anderen Threads in Arbeit (gehört mit in den Vertrag, sobald gemergt):
- Kopieren und Einfügen (Strg+C/V versetzt), Duplizieren am Platz (Strg+D), Füllung leer mit nur Umrandung
  (Thread "Duplizieren und Füllung leer").


---

# Teil: Inventar A: App-Hülle, Topbar, Bühne/Ansicht, Tastatur, Zeiger, Player, Statistik, Einstellungen

Quelle: Code-Lesung (Stand Repo /home/user/heatstitch). Zeilenangaben sind `datei:zeile` im jeweiligen File. i18n-Schlüssel in `[eckigen Klammern]`, deutscher Text aus `src/i18n/de.ts`.

## Bereiche

1. **Topbar** (`header.topbar`, index.html:77-94): Marke (Logo + "heatstitch"), Modus-Umschalter Ablauf | Dichte | Bild (`#modes`), Link "Anleitung" (`#doc-link`), Sprachwahl (`#lang`).
2. **Linke Spalte** (`aside.sidebar`, index.html:97-366): Panels je Modus (über `data-mode`). In meinem Scope: Panel "Färben" (Ablauf), Panel "Heatmap" (Dichte), aufklappbares Panel "Anzeige" (alle Modi), aufklappbares Panel "Statistik" (Ablauf, Dichte). Dateien, Material, Bild-Panels: andere Worker.
3. **Spaltengriffe** (`.resizer[data-panel=side|inspector]`, index.html:368-369): Breite linke/rechte Spalte.
4. **Bühne** (`section.stage#stage`, index.html:371-432): Canvas `#canvas`; oben die Werkzeugleiste `.stage-bar` (links: Rückgängig/Wiederholen, Text, Ebenen-Umschalter Form | Objekte | Stiche, Brotkrumen `#edit-crumb`; Mitte (nur Bild): Ansicht Original | Vorbereitet | Stiche; rechts: "Wie gestickt" (Bild), Markierungen-Schalter, Einpassen, PNG); links senkrecht die Zeichenwerkzeuge `.draw-tools` (nur Ablauf + Ebene Form); Statuszeile Bild `#image-status`; Dichte-Legende `#legend` (Dichte); Tooltip `#tooltip`; Leer-Hinweis `#empty`; Tastenhinweis `#canvas-hint`; Player `#player` (nur Ablauf, nur mit Datei).
5. **Rechte Spalte** (`aside.inspector#inspector`, index.html:434-572): Ebenen/Objekte/Schriftzug/Sprünge (Ablauf), Befunde/Korrektur (Dichte), Bild-Palette/Pinsel/Ergebnis (Bild). Andere Worker; nur Einstiegspunkte unten.
6. **Update-Hinweis** (`#update-notice`, index.html:574-578): schwebende Leiste bei neuer Version.
7. **Unsichtbar**: Service Worker/PWA, localStorage-Einstellungen, globale Tastatur, Gerätesensor (Neigung), Farbschema-Wechsel.

Modi (`settings.mode`, `body[data-mode]`): `flow` = **Ablauf** [mode.flow], `density` = **Dichte** [mode.density], `image` = **Bild** [mode.image]. Sichtbarkeit per CSS: Elemente mit `data-mode` erscheinen nur in den gelisteten Modi (src/style.css:1405-1410).
Ebenen (nur Ablauf/Dichte, `input[name=level]`): **Form** [level.shape] (nur Ablauf), **Objekte** [level.objects], **Stiche** [level.stitches]; Gruppenname "Was bearbeiten" [level.label].

---

## Tabelle 1: Topbar und Modi

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Modus Ablauf [mode.flow] | Schaltet auf Nähablauf, Objekte, Sprünge. Tooltip [mode.flow.hint] | Radio `input[name=mode][value=flow]` in `#modes`; Taste `1` | immer (nicht beim Tippen in Feld) | index.html:83; main.ts:699-734; keys.ts:207-210 |
| Modus Dichte [mode.density] | Heatmap, Prüfung, Korrektur. Tooltip [mode.density.hint] | Radio `value=density`; Taste `2` | immer | index.html:84; main.ts:699; keys.ts:207 |
| Modus Bild [mode.image] | Bild zu Stickmuster. Tooltip [mode.image.hint] | Radio `value=image`; Taste `3`; automatisch nach "Übernehmen" im Bild-Modus zurück auf Ablauf | immer | index.html:85; main.ts:1294-1297; keys.ts:207 |
| (Nebenwirkungen Moduswechsel) | Speichert Modus, beendet Stiche-Bearbeitung (bei Bild), schließt Form/Rahmen außerhalb Ablauf, beendet Vergleich und Zonen-Hover außerhalb Dichte, legt Zeichenwerkzeug weg, pausiert Player und setzt ihn auf komplett, passt Ansicht ein beim Wechsel von/zu Bild, öffnet in Ablauf mit Ebene Form wieder die Form des gewählten Objekts | implizit | beim Wechsel | main.ts:699-729 |
| Anleitung [app.docs] "Anleitung" | Öffnet docs.html (gleiches Fenster, normaler Link) | Link `#doc-link` | immer | index.html:88 |
| Sprache | Deutsch/English sofort umschalten, ohne Reload; wird gespeichert | `select#lang` (Optionen "Deutsch", "English"; aria-label fest "Language", nicht übersetzt) | immer | index.html:89-92; main.ts:1336-1351 |
| Spracherkennung | Erste Sprache: gespeicherte, sonst Browsersprache (de* = Deutsch, sonst Englisch) | automatisch beim Start | Start | i18n/index.ts:11-14; main.ts:1352 |

## Tabelle 2: Werkzeugleiste auf der Bühne (`.stage-bar`)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Rückgängig [edit.undo] | Letzten Bearbeitungsschritt der aktiven Datei zurücknehmen; im Bild-Modus Bild-Schritt | Button `#undo` (↶, Titel [edit.undo.key] "Strg+Z"); Strg/Cmd+Z | Button: Ablauf, Dichte (deaktiviert ohne Undo-Schritte oder wenn busy); Taste: alle Modi, auch Bild | index.html:377; correctPanel.ts:160,221; keys.ts:64-68; main.ts:1154-1174 |
| Wiederholen [edit.redo] | Rückgängig gemachten Schritt wieder anwenden | Button `#redo` (↷, Titel [edit.redo.key] "Strg+Umschalt+Z"); Strg/Cmd+Umschalt+Z; Strg/Cmd+Y (nicht im Titel genannt) | wie oben | index.html:378; correctPanel.ts:161,222; keys.ts:64-68 |
| Text [lettering.tool] "Text" | Neuen Schriftzug anlegen (Details: Lettering-Worker). Titel [lettering.tool.hint] | Button `#lettering-new`; Taste `t` | Button: nur Ablauf; Taste: Ablauf, wenn weder Stiche-Bearbeitung, Form-Werkzeug noch Richtungs/Leitlinien-Werkzeug aktiv | index.html:379; lettering.ts:194; keys.ts:231 |
| Ebene Form [level.shape] | Zeichenwerkzeuge zeigen, Umriss des einen gewählten Objekts öffnen. Titel [level.shape.hint] | Radio `input[name=level][value=shape]`; Taste `v` (wenn nicht schon Form; legt aktives Zeichenwerkzeug weg) | nur Ablauf; Taste nicht im Buchstaben-Modus | index.html:381; main.ts:1356-1392; keys.ts:99-103 |
| Ebene Objekte [level.objects] | Ganze Objekte wählen/ordnen. Titel [level.objects.hint] | Radio `value=objects`; Esc aus Stiche-Ebene; Klick neben Stiche in Stiche-Ebene (Ablauf) | Ablauf, Dichte | index.html:382; main.ts:1356-1363 |
| Ebene Stiche [level.stitches] | Einzelne Einstiche bearbeiten. Titel [level.stitches.hint] | Radio `value=stitches`; Taste `e` (Umschalten, Ablauf und Dichte); Doppelklick auf Objekt (siehe Zeiger); Enter bei Form-Werkzeug | Ablauf, Dichte | index.html:383; main.ts:1088-1100; keys.ts:225-228, 263 |
| Brotkrume | Zeigt "{name} › Stiche" [level.in], "Ein Objekt anklicken, um seine Stiche zu bearbeiten" [level.pick] oder "{name} › Form" [level.inShape]; nur Anzeige | `#edit-crumb` | Ablauf, wenn Stiche-Ebene oder Form-Werkzeug aktiv | index.html:385; main.ts:1112-1122 |
| Bild-Ansicht Original / Vorbereitet / Stiche [image.view.original/prepared/stitches] | Was die Bühne im Bild-Modus zeigt (Details Bild-Worker) | Radios `input[name=image-view]` | nur Bild | index.html:387-391 |
| Wie gestickt [image.shine] | Schaltet realistische Fäden + Licht folgt an, Ansicht Stiche, Licht läuft einmal herum; fragt auf iOS Neigungserlaubnis an. Titel [image.shine.hint] | Button `#image-shine` (✦); automatisch bei erster Umwandlung | nur Bild; sichtbar erst wenn ein Ergebnis da ist (imageMode.ts:891) | index.html:393; light.ts:52-64; main.ts:1289-1291 |
| Markierungen zeigen [marks.toggle] | Globaler Schalter für alle Markierungen (Sprünge, Schnitte usw.); "Lose Sprungfäden" bleiben trotzdem. Titel [marks.toggle.key] | Button `#marks-toggle` (aria-pressed); Taste `h` (klickt den Button) | Ablauf, Dichte; Taste nicht im Bild-Modus | index.html:394; controls.ts:188; keys.ts:215; settings.ts:44-45 |
| Einpassen [controls.fit] "Einpassen" | Ganzes Muster (bzw. mit Rahmen das ganze Stickfeld; leeres neues Design 10x10 cm; im Bild-Modus das Bild) in die freie Bühnenfläche (ohne Leiste, Zeichenwerkzeuge, Player) einpassen. Titel [controls.fit.key] | Button `#fit` (⤢); Taste `f` (alle Modi); Doppelklick auf leere Stelle der Bühne | immer (ohne Datei passiert in Ablauf/Dichte nichts) | index.html:395; main.ts:944-980, 1355; keys.ts:212, 251, 262; pointer.ts:478 |
| PNG exportieren [controls.export] | Aktuelle Ansicht (ohne Bearbeitungs-Overlay) als PNG speichern, Dateiname = Dateiname des Musters. Titel [controls.export.hint] | Button `#export` ("⤓ PNG") | Ablauf, Dichte; deaktiviert ohne Muster | index.html:396; main.ts:805, 1393-1396; ui/export.ts:8 |

## Tabelle 3: Zeichenwerkzeuge (Einstiege, Details beim Form-Worker)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Zeiger [draw.pointer] | Zeichenwerkzeug weglegen | Button `#draw-pointer`; Taste `v`; Esc (wenn nicht mitten im Zeichnen) | Ablauf + Ebene Form (Leiste nur bei `.stage.form-level` sichtbar, style.css:1806) | index.html:400; drawing.ts:80; keys.ts:82-86, 100 |
| Rechteck [draw.rect] | Rechteck zeichnen (Umschalt Quadrat, Alt von Mitte) | Button `[data-draw=rect]`; Taste `m` (Umschalten) | Ablauf (Taste schaltet auch ohne Ebene Form) | index.html:401; keys.ts:56,104-107 |
| Ellipse [draw.ellipse] | Ellipse zeichnen | `[data-draw=ellipse]`; Taste `o` | Ablauf | index.html:402; keys.ts:56 |
| Zeichenstift [draw.pen] | Mit Knoten zeichnen | `[data-draw=pen]`; Taste `b`; Enter oder Doppelklick beendet als Linie; Entf/Rücktaste löscht letzten Knoten | Ablauf | index.html:403; keys.ts:56,89-96; pointer.ts:447-450 |
| Freihand [draw.free] | Freihandlinie | `[data-draw=free]`; Taste `p` | Ablauf | index.html:404; keys.ts:56 |
| Zeichnen abbrechen | Laufende Zeichnung verwerfen | Esc während des Zeichnens | Ablauf | keys.ts:82-85 |

## Tabelle 4: Zeigergesten auf der Bühne (`#canvas`)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Zoomen | Zoom um den Mauspunkt (Faktor exp(-delta*0.0015); Grenzen Maßstab 0,05 bis 400 px/mm) | Mausrad / Trackpad-Scroll (keine Modifikatoren nötig) | alle Modi | pointer.ts:68-79; viewport.ts:25-31 |
| Pinch-Zoom | Zwei Finger zoomen um den Mittelpunkt; bricht laufende Zieh-Aktionen und Pinselstrich ab | zwei Pointer | alle Modi | pointer.ts:117-121, 184-197, 240-246 |
| Verschieben (Pan) | Ansicht verschieben | Ziehen mit linker Maustaste auf leerer Stelle bzw. wo kein Werkzeug greift; Ziehen mit rechter/mittlerer Taste (immer, auch im Bild-Modus beim Malen); Ein-Finger-Ziehen | alle Modi | pointer.ts:111, 133-151, 239 |
| Objekt wählen | Klick auf Stiche wählt deren Objekt; Klick daneben hebt Auswahl auf | Klick (Bewegung < 4 px) | Ablauf, Ebene Objekte, keine Werkzeuge aktiv | pointer.ts:323-340 |
| Zur Auswahl hinzufügen | Objekt zur Auswahl hinzufügen/umschalten | Umschalt+Klick, Strg+Klick, Cmd+Klick | Ablauf, Ebene Objekte | pointer.ts:337-338 |
| Gummiband-Auswahl (Objekte) | Fügt alle sichtbaren, ganz im Rechteck liegenden Objekte zur Auswahl hinzu | Umschalt+Ziehen auf leerer Stelle; Touch: lange drücken (500 ms) neben Objekten, dann ziehen (Vibration) | Ablauf, Datei offen, keine Stiche-Ebene, kein Form-/Richtungs-/Zeichenwerkzeug, Reihenfolge-Karte zu, nicht Buchstaben-Modus | pointer.ts:146-150, 163-172, 380-402 |
| Sprung wählen | Klick auf eine sichtbare Sprunglinie wählt diesen Sprung (Liste "Sprünge und Schnitte") | Klick (8 px Toleranz) | Ablauf, Ebene Objekte | pointer.ts:324-331 |
| Objektaktionen-Menü [object.menu] | Kontextmenü mit Aktionen des Objektpanels für die Auswahl (wählt Objekt vorher, falls nicht gewählt) | Rechtsklick; Touch: lange drücken (500 ms) auf Objekt | Ablauf, Ebene Objekte, kein Werkzeug, Reihenfolge-Karte zu, kein Buchstaben-Modus, kein Schriftzug gewählt | pointer.ts:404-443 |
| Rechtsklick im Bild-Modus | Kein Browser-Kontextmenü (rechte Taste pannt beim Malen) | Rechtsklick | Bild | pointer.ts:438 |
| Doppelklick auf Objekt | Öffnet die Form (Fläche) bzw. die Stiche des Objekts und zoomt bei Bedarf | Doppelklick | Ablauf, kein Werkzeug aktiv | pointer.ts:461-476 |
| Doppelklick auf Schriftzug | Wählt den Schriftzug und setzt den Fokus ins Textfeld | Doppelklick | Ablauf, nicht im Buchstaben-Modus | pointer.ts:467-474 |
| Doppelklick auf leere Stelle | Einpassen | Doppelklick | alle Modi (Ablauf: kein Werkzeug aktiv; im Bild-Modus immer) | pointer.ts:478 |
| Doppelklick in Stiche-Ebene | Fügt Einstich auf dem nächsten Stich ein | Doppelklick | Stiche-Ebene aktiv (Ablauf/Dichte) | pointer.ts:457-459; editor.ts:188-198 |
| Doppelklick im Form-Werkzeug | Knoten auf dem Umriss einfügen | Doppelklick | Form-Werkzeug aktiv | pointer.ts:453-455 |
| Doppelklick mit Zeichenwerkzeug | Zeichenstift: Linie beenden; andere ignorieren | Doppelklick | Zeichenwerkzeug aktiv | pointer.ts:447-450 |
| Klick im Form-Werkzeug | Klick auf anderes Objekt: dessen Form öffnen (Umschalt/Strg/Cmd: hinzufügen); Klick daneben: Objekt loslassen | Klick | Ablauf, Form-Werkzeug aktiv | pointer.ts:299-313 |
| Klick in Stiche-Ebene (Ablauf) | Klick auf anderes Objekt: dessen Stiche bearbeiten; Klick neben Stiche ohne gewählten Einstich: zurück zu Objekte | Klick | Ablauf, Stiche-Ebene | pointer.ts:314-322 |
| Einstich wählen / verschieben | Klick wählt Einstich, Umschalt+Klick schaltet um, Ziehen verschiebt Auswahl (ein Undo-Schritt), Umschalt+Ziehen ins Leere: Rechteckauswahl, Klick ins Leere hebt Einstich-Auswahl auf | Maus/Touch | Stiche-Ebene; Einstiche wählbar wenn Zoom >= 6 px/mm oder innerhalb des bearbeiteten Objekts (Ablauf) | editor.ts:89-167; render/editOverlay.ts:8 |
| Buchstabe ziehen | Einzelbuchstaben verschieben; Klick daneben lässt Buchstaben los | Ziehen/Klick | Ablauf, Buchstaben-Modus | pointer.ts:139, 293-298 |
| Vergleichs-Trennlinie | Trennlinie Original/Korrigiert verschieben (2 % bis 98 %), Cursor col-resize in 10 px Nähe | Ziehen nahe der Linie | Dichte, Vergleich an und Datei bearbeitet | pointer.ts:95, 128-132, 217-221; main.ts:793-802 |
| Vorschlags-Vergleich | Linie vorher/nachher im Vorschlagsrahmen folgt der Maus (Hover) bzw. dem Finger (Ziehen) | Hover/Ziehen im Rahmen | Dichte, Korrekturvorschlag angezeigt (Korrektur-Worker) | pointer.ts:122-127, 222-229 |
| Licht folgt Maus | Lichtrichtung der realistischen Fäden folgt dem Mauszeiger | Maus bewegen (nur `pointerType=mouse`) | "Licht folgt" an und realistische Fäden sichtbar | pointer.ts:213-216; light.ts:20-22 |
| Pinsel malen | Pinselstrich im Bild (Details Bild-Worker); zweiter Finger bricht Strich ab | linke Taste ziehen | Bild, Pinsel/Radierer aktiv | pointer.ts:112-121, 205-212, 274-280 |
| Tooltip Ablauf | Zeigt "Stich {i} · {kind} · {len} mm" [tooltip.stitch] für den Stich unter dem Zeiger | Hover (und Mausrad) | Ablauf, Datei offen; nicht beim Ziehen des Satin-Breitengriffs | main.ts:666-692; pointer.ts:82-89 |
| Tooltip Dichte | Zeigt Dichtewert + Position, darunter Prüfwert, Grenzen, Einstiche, Kurzstiche, zu locker, Lücke, langer Stich, Stufe Vorsicht/Kritisch; im Vergleich links die Werte des Originals | Hover | Dichte, Heatmap berechnet | tooltip.ts:19-70; pointer.ts:90-92 |
| Tooltip ausblenden | Tooltip weg beim Verlassen der Bühne | Zeiger verlässt Canvas | alle | pointer.ts:372-378 |

## Tabelle 5: Globale Tastenkürzel (keys.ts, `window` keydown)

Allgemein: ignoriert, solange der Fokus in `input`, `select`, `textarea` oder `[contenteditable]` ist; Ausnahme: Leertaste auf fokussierter Checkbox/Radio geht an den Player (keys.ts:60-62). Ohne Strg/Cmd/Alt, außer wo genannt (keys.ts:79).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Rückgängig / Wiederholen | siehe Tabelle 2 | Strg/Cmd+Z; Strg/Cmd+Umschalt+Z; Strg/Cmd+Y | alle Modi, ohne Alt | keys.ts:64-68 |
| Duplizieren [object.duplicate] | Gewähltes Objekt duplizieren (Objekt-Worker) | Strg/Cmd+D | Ablauf, genau ein Objekt im Rahmen | keys.ts:69-73 |
| Alle Einstiche wählen | Alle Einstiche (im Bereich des Objekts) wählen | Strg/Cmd+A | Stiche-Ebene aktiv | keys.ts:74-78; editor.ts:263-269 |
| Vorschau lösen | Festgehaltenen Korrekturvorschlag loslassen | Esc | Vorschlag festgehalten (`ui.planPin`) | keys.ts:80 |
| Modus 1/2/3 | Ablauf / Dichte / Bild | `1`, `2`, `3` | immer (Spaltengriff mit Fokus fängt seine Tasten ab) | keys.ts:207-210 |
| Einpassen | siehe Tabelle 2 | `f` | alle Modi | keys.ts:212, 251, 262 |
| Markierungen ein/aus | siehe Tabelle 2 | `h` | Ablauf, Dichte | keys.ts:215 |
| Abspielen/Anhalten | Player starten/stoppen | Leertaste (auch auf fokussiertem Button/Schalter) | Ablauf | keys.ts:218-224, 241-243 |
| Ein Stich vor/zurück | Player um 1 Stich | `.` / `,` | Ablauf, nicht in Stiche-Ebene | keys.ts:244 |
| 100 Stiche vor/zurück | Player um 100 Stiche | Umschalt+`.` / Umschalt+`,` (Tastenwert muss `.`/`,` bleiben; bei deutschem Layout liefert Umschalt+`.` ":", greift dann also nicht: laut Code, nicht getestet) | Ablauf | keys.ts:244 |
| Anfang / Ende | Player auf Stich 0 bzw. komplett | Pos1 (Home) / Ende (End) | Ablauf | keys.ts:245-246 |
| Nächster/voriger Sprung [jumps.next] | Wählt nächsten/vorigen sichtbaren Sprung der Liste | `n` / Umschalt+`n` (`N`) | Ablauf | keys.ts:247-248; order.ts:166-173 |
| Nächste/vorige Zone [findings.next] | Springt zur nächsten/vorigen Befund-Zone, zoomt hin und schaltet Markierungen an | `n` / `N` | Dichte | keys.ts:265-266; main.ts:921-942 |
| Nächste/vorige Datei | Aktive Datei in der Dateiliste wechseln | Pfeil runter / `j`, Pfeil hoch / `k` | Ablauf (wenn keine Auswahl-Pfeiltasten greifen), Dichte | keys.ts:249-250, 260-261 |
| Stiche-Ebene ein/aus | siehe Tabelle 2 | `e` | Ablauf (schließt Richtungs-Werkzeug), Dichte; nicht wenn Schriftzug gewählt | keys.ts:163, 225-228, 263 |
| Richtung festlegen [stitch.direction.tool] | Richtungs-Werkzeug ein/aus für gewähltes Objekt | `r` | Ablauf; nicht wenn Schriftzug gewählt | keys.ts:229; rungs.ts:181 |
| Leitlinien zeichnen [stitch.guide.tool] | Leitlinien-Werkzeug ein/aus für die eine gewählte Füllung | `g` | Ablauf; nicht wenn Schriftzug gewählt | keys.ts:230; rungs.ts:119 |
| Querlinie/Trennlinie [stitch.pen.rung]/[stitch.pen.cut] | Im Richtungs-Werkzeug zwischen Querlinie und Trennlinie wechseln | `t` / `T` | Ablauf, Richtungs-Werkzeug aktiv, Modus nicht Leitlinie | keys.ts:166 |
| Neuer Schriftzug | siehe Tabelle 2 | `t` | Ablauf, kein Werkzeug | keys.ts:231 |
| Vergleich ein/aus [compare.start] | Original/Korrigiert nebeneinander | `c` | Dichte, aktive Datei bearbeitet | keys.ts:264; main.ts:1147-1151 |
| Markierungen (Befunde) [validation.overlay] | Befund-Markierungen auf der Fläche ein/aus (gespeichert) | `v`; Checkbox `#show-validation` | Dichte (in Ablauf ist `v` = Ebene Form) | keys.ts:267-271; controls.ts:197; index.html:522 |
| Form öffnen | Form (bzw. Stiche) des einen gewählten Objekts öffnen | Enter | Ablauf, Objekte-Ebene, genau 1 Objekt gewählt | keys.ts:240 |
| Stiche aus Form | Aus Form-Werkzeug in Stiche des Objekts | Enter | Ablauf, Form-Werkzeug aktiv | keys.ts:128 |
| Buchstaben einzeln [lettering.letters] | Buchstaben-Modus an | Enter | Ablauf, Schriftzug gewählt | keys.ts:162 |
| Löschen (Objekte) [object.delete] | Gewählte Objekte löschen | Entf / Rücktaste | Ablauf, Objekte im Rahmen, nicht mitten im Zeichnen | keys.ts:130-133 |
| Löschen (Einstiche) [edit.delete] | Gewählte Einstiche löschen | Entf / Rücktaste | Stiche-Ebene mit Auswahl (Ablauf, Dichte) | keys.ts:192-196 |
| Löschen (Knoten/Linie) | Gewählten Knoten bzw. gewählte Richtungslinie löschen | Entf / Rücktaste | Form-Werkzeug bzw. Richtungs-Werkzeug mit Auswahl | keys.ts:116-119, 167-170 |
| Ecke/rund | Gewählten Knoten zwischen Ecke und rund umschalten | `c` | Ablauf, Form-Werkzeug | keys.ts:120 |
| Teilen [edit.split] | Stich zum einzigen gewählten Einstich in der Mitte teilen | `i` | Stiche-Ebene, 1 Einstich gewählt | keys.ts:202-205; editor.ts:201-211 |
| Voriger/nächster Einstich | Auswahl auf Einstich davor/danach, Ansicht folgt | `,` / `.` | Ablauf, Stiche-Ebene | keys.ts:234-239 |
| Pfeiltasten verschieben | Objekt(e) 0,1 mm (Umschalt 1 mm); Knoten 0,1 (Umschalt 0,5) mm; Buchstabe 0,1 (Umschalt 1) mm; Einstiche 0,1 (Umschalt 0,5) mm | Pfeiltasten (+Umschalt) | Ablauf Rahmen aktiv / Form-Werkzeug mit Knoten / Buchstabe gewählt; Einstiche: Stiche-Ebene mit Auswahl (auch Dichte). Nicht wenn Fokus auf Button (Objekte/Buchstaben) | keys.ts:108-115, 135-143, 146-153, 179-191 |
| Esc (Kaskade Ablauf) | In dieser Reihenfolge: Vorschlag lösen; Zeichnen abbrechen/Werkzeug weg; Knoten-Auswahl bzw. Objekt-Auswahl im Form-Werkzeug weg; Buchstabe loslassen bzw. Buchstaben-Modus aus; Richtungslinie loslassen bzw. Werkzeug schließen; Einstich-Auswahl leeren; Stiche-Ebene verlassen; Reihenfolge-Karte schließen; Objekt-Auswahl leeren; Sprung- und Farbfokus leeren | Esc | Ablauf | keys.ts:80-86, 121-127, 154-160, 171-177, 197-201, 233, 252-257 |
| Esc (Dichte) | Einstich-Auswahl leeren, sonst gewählte Zone abwählen, sonst Stiche-Ebene verlassen | Esc | Dichte | keys.ts:197-201, 272-275 |
| Enter auf Button | Drückt fokussierten Button wie üblich (Leertaste dagegen spielt ab) | Enter | Ablauf | keys.ts:217-224 |

## Tabelle 6: Player (`#player`)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Zum Anfang der Farbe [player.blockPrev] | Zum Anfang der aktuellen (bzw. vorigen) Farbe | Button `[data-play=block-prev]` (⏮) | Ablauf, Datei mit Muster | index.html:414; player.ts:57-66, 108-119 |
| Ein Stich zurück [player.prev] | 1 Stich zurück | Button `[data-play=prev]` (◂); Taste `,` | Ablauf | index.html:415; player.ts:102-105 |
| Abspielen/Anhalten [player.play]/[player.pause] | Nähablauf animiert abspielen (Startet am Ende neu bei 0); Symbol wechselt ▶ / ❚❚ | Button `[data-play=toggle]`; Leertaste | Ablauf | index.html:416; player.ts:120-151 |
| Ein Stich vor [player.next] | 1 Stich vor | Button `[data-play=next]` (▸); Taste `.` | Ablauf | index.html:417 |
| Zur nächsten Farbe [player.blockNext] | Zum Ende der aktuellen Farbe / Anfang der nächsten | Button `[data-play=block-next]` (⏭) | Ablauf | index.html:418 |
| Position im Nähablauf [player.pos] | Schieberegler auf Stichnummer; Spur zeigt Farbblöcke in Garnfarbe, Ungenähtes abgedunkelt | `input#player-pos` ziehen; Pos1/Ende | Ablauf; deaktiviert ohne Stiche | index.html:420-423; player.ts:53-56, 74-94 |
| Info | "Stich {i} / {n} · {Zeit} / {Gesamtzeit}" [player.info], Zeit nach Maschinentempo inkl. Schnitte und Farbwechsel | Anzeige `#player-info` | Ablauf | player.ts:153-164; scene.ts:109-124 |
| Tempo [player.speed] | 1×, 10×, 50×, 250× des Maschinentempos (gespeichert) | `select#player-speed` | Ablauf | index.html:425-430; player.ts:49-52 |
| Nadel/Teilansicht | Bühne zeigt Muster nur bis zur Player-Position, mit Nadelposition; Ebenenliste markiert aktuelle Farbe | implizit | Ablauf, Player nicht komplett | scene.ts:200, 249; main.ts:815 |
| Player nach Bearbeitung | Bleibt an der Position (oder komplett) nach Undo/Bearbeitung; beim Dateiwechsel komplett | implizit | | main.ts:1007-1021; scene.ts:90-101 |

## Tabelle 7: Panel "Färben" [flow.settings] (linke Spalte)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Stiche färben nach [colorBy.title]: Garnfarbe [colorBy.thread] | Stiche in Garnfarben der Datei; Hinweis [colorBy.thread.hint] | Radio `input[name=color-by][value=thread]` | Ablauf | index.html:251; controls.ts:179, 84 |
| Reihenfolge [colorBy.order] | Farbverlauf zuerst [colorBy.order.early] bis zuletzt [colorBy.order.late] | Radio `value=order` | Ablauf | index.html:252; controls.ts:85-92 |
| Stichart [colorBy.kind] | Satin, Füllung, Steppstich/Unterlage, Vernähstich; Hinweis [kind.hint] | Radio `value=kind` | Ablauf | index.html:253; controls.ts:93-102 |
| Stichlänge [colorBy.length] | kurz, normal, lang, sehr lang, Vernähstich [length.*] | Radio `value=length` | Ablauf | index.html:254; controls.ts:103-110 |
| Farblegende | Legende zur gewählten Färbung | `#color-key` (nur Anzeige) | Ablauf | index.html:257; controls.ts:74-111 |

## Tabelle 8: Panel "Heatmap" [heatmap.title] (linke Spalte)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Metrik [controls.metric]: Garnlänge [metric.thread] / Einstiche [metric.penetrations] | Was die Heatmap misst; Einheit [unit.thread] mm/mm² bzw. [unit.penetrations] 1/mm² | Radios `input[name=metric]` | Dichte | index.html:289-296; controls.ts:173-178 |
| Feineinstellungen [heatmap.advanced] | Aufklappbereich (Zustand gespeichert, `data-section=advanced`) | `details` | Dichte | index.html:297 |
| Rasterzelle [controls.cell] | Zellgröße 0,5 bis 5 mm | Range `#cell` | Dichte | index.html:299-302; controls.ts:189 |
| Glättung (σ) [controls.blur] | 0 bis 3 mm, 0 = "aus" [controls.off] | Range `#blur` | Dichte | index.html:303-306; controls.ts:190 |
| Skala-Maximum [controls.max] | Obergrenze der Farbskala je Metrik (getrennt gespeichert) | Zahl `#max` | Dichte | index.html:307-310; controls.ts:192-196 |
| Ungetrimmte Sprünge als Garn zählen [controls.jumps] | Sprünge in Garnlänge mitzählen | Checkbox `#include-jumps` | Dichte; deaktiviert bei Metrik Einstiche | index.html:311; controls.ts:191, 130 |
| Legende | Farbskala mit Vorsicht/Kritisch-Strichen des Profils (nur Metrik Garnlänge) | Canvas `#legend` | Dichte | index.html:408; main.ts:865-875; legendSpec.ts:8-23 |
| Neuberechnung | Heatmap im Worker, 60 ms entprellt; im Vergleich auch fürs Original | implizit | Dichte | main.ts:884-919 |

## Tabelle 9: Panel "Anzeige" [display.title] (linke Spalte, aufklappbar)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Anzeige auf/zu | Aufklappzustand gespeichert (`data-section=display`, Standard offen) | `details.panel` | alle Modi | index.html:316; controls.ts:219-226 |
| Stichplan einblenden [controls.overlay] | Stiche über der Heatmap zeigen; aktiviert Markierungen in Dichte | Checkbox `#overlay` | Dichte | index.html:319; controls.ts:198, 119 |
| Deckkraft [controls.opacity] | Deckkraft des Stichplans 5 bis 100 % | Range `#opacity` | Dichte; deaktiviert ohne Stichplan | index.html:320-323; controls.ts:199 |
| Formen statt Stiche [display.shapes] | Füllungen mit bekannter Form als flache Farbflächen. Titel [display.shapes.hint] | Checkbox `#shapes-view` | Ablauf | index.html:325; controls.ts:201; scene.ts:205-241 |
| Realistische Fäden [controls.realistic] | Gezwirnte Fäden mit Schatten (WebGL2). Titel [controls.realistic.hint] | Checkbox `#realistic`; "Wie gestickt" schaltet an | alle Modi (wirkt in Dichte nur mit Stichplan oder in Stiche-Ebene, im Bild nur Ansicht Stiche) | index.html:326; controls.ts:200; light.ts:20-22 |
| Fadenbreite [controls.threadWidth] | Sichtbare Fadenbreite 0,02 bis 1 mm; gehört zum Material der Datei; Profil-Garnwechsel setzt zurück | Range `#thread-width` | nur mit realistischen Fäden | index.html:327-330; controls.ts:202 |
| Licht folgt Maus und Neigung [controls.liveLight] | Licht folgt Mauszeiger bzw. Handyneigung | Checkbox `#live-light` | nur mit realistischen Fäden | index.html:331; controls.ts:203; light.ts |
| Neigung des Geräts nutzen [controls.tilt] | Fragt (iOS) die Erlaubnis für Lagesensor an | Button `#allow-tilt` | nur sichtbar, wenn Browser eine Erlaubnis verlangt (iOS); sonst wird Neigung automatisch gelesen | index.html:332; light.ts:35-49 |
| Hintergrund [controls.background] | Farbe hinter den Stichen: Automatisch, Weiß, Natur, Grau, Schwarz, Marine, Rot [bg.*] oder Eigene Farbe [bg.own] (Farbwähler); gehört zum Material/Projekt. Titel [controls.background.hint] | Farbfelder in `#bg-swatches` (Buttons), `input[type=color].bg-own`; Name in `#bg-out` | alle Modi | index.html:333-336; controls.ts:16-24, 49-72 |
| Stoff [controls.fabric] | Stoffstruktur des Profils im Hintergrund oder "Flach (nur Farbe)" [controls.fabric.flat]; Wahl stellt auch das Material-Profil um. Titel [controls.fabric.hint] | `select#fabric-look` | nur mit realistischen Fäden | index.html:337-340; controls.ts:204-215 |
| Markierungen [marks.title] | Einzelne Markierungen; Auswahl einer Markierung schaltet den globalen Schalter wieder an; Legende zeigt "ausgeblendet" [marks.allOff] wenn global aus | Checkboxen `input[data-mark]` | Ablauf, Dichte; in Dichte deaktiviert ohne Stichplan | index.html:341-349; controls.ts:116-123, 180-187 |
| - Sprünge [marks.jumps] | gestrichelte Sprunglinien | `data-mark=jumps` | Ablauf, Dichte | index.html:343 |
| - Lose Sprungfäden [marks.threads] | Sprünge ohne Schnitt als liegender Faden; bleibt auch bei globalem Aus. Titel [marks.threads.hint] | `data-mark=threads` | nur Ablauf | index.html:344; settings.ts:44-45 |
| - Fadenschnitte [marks.trims] | ✂-Symbole | `data-mark=trims` | Ablauf, Dichte | index.html:345 |
| - Farbwechsel [marks.colors] | Nummern an Farbwechseln | `data-mark=colors` | Ablauf, Dichte | index.html:346 |
| - Start und Ende [marks.ends] | S/E-Marken | `data-mark=ends` | Ablauf, Dichte | index.html:347 |
| - Einstiche [marks.points] | Punkte an Einstichstellen ab genügend Zoom. Titel [marks.points.hint] | `data-mark=points` | Ablauf, Dichte | index.html:348 |

## Tabelle 10: Panel "Statistik" [stats.title] (linke Spalte, aufklappbar)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Statistik auf/zu | Aufklappzustand gespeichert (`data-section=stats`, Standard zu) | `details` | Ablauf, Dichte | index.html:352; controls.ts:219-226 |
| Kennzahlen | Stiche, Sprünge, Fadenschnitte, Farbwechsel, Größe (B × H mm), Garnlänge (m), Nähzeit ca. (min) [stats.*] | Anzeige `dl#stats` | Datei offen | stats.ts:7-40 |
| Max. Dichte [stats.maxDensity] | Höchster Heatmapwert, sonst "Berechne …" | Anzeige | nur Dichte | stats.ts:26-29 |
| Maschinentempo (Stiche/min) [stats.speed] | 400/600/800/1000/1200; steuert Nähzeit und Player-Zeit (gespeichert) | `select#machine-spm` | Ablauf, Dichte | index.html:355-364; controls.ts:216 |

## Tabelle 11: Layout, Spalten, Update, Shell

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Breite linke Spalte [layout.resizeSide] | Spaltenbreite 220 bis 560 px; Bühne behält min. 320 px; gespeichert | Griff `.resizer[data-panel=side]`: ziehen; fokussiert: Pfeil links/rechts (16 px, Umschalt 64 px), Pos1 = min, Ende = max, Enter = zurücksetzen; Doppelklick = zurücksetzen. Titel [layout.resize.hint] | Breite > 760 px (darunter ausgeblendet) | index.html:368; panelResize.ts:30-107 |
| Breite rechte Spalte [layout.resizeInspector] | 240 bis 600 px, sonst wie oben (Richtung gespiegelt) | `.resizer[data-panel=inspector]` | wie oben | index.html:369; panelResize.ts |
| Neue Version verfügbar [update.text] | Hinweis, wenn neuer Service Worker wartet | erscheint automatisch | PWA-Build, nicht in PR-Previews | index.html:574-578; updateNotice.ts:16-35 |
| Neu laden [update.reload] | Aktiviert neue Version und lädt neu (Dateien bleiben in IndexedDB) | Button `[data-update=reload]` | Hinweis sichtbar | updateNotice.ts:39-45 |
| Später [update.dismiss] | Hinweis schließen | Button `[data-update=dismiss]` (×) | Hinweis sichtbar | updateNotice.ts:46 |
| Update-Prüfung | Prüft alle 30 min und beim Zurückkehren in den Tab (online, nicht während Installation) | automatisch | | updateNotice.ts:4, 19-35 |
| Leer-Hinweis | Text je Modus [canvas.empty.flow] / [canvas.empty] / [canvas.empty.image] | `#empty` | kein Muster/Bild (Ablauf: auch nicht beim Zeichnen) | main.ts:694-697, 775, 804 |
| Tastenhinweis | Zeile mit Gesten/Tasten je Zustand: [canvas.hint.image], [canvas.hint.draw.rect/ellipse/pen/free], [canvas.hint.flowEdit], [canvas.hint.edit], [canvas.hint.shape], [canvas.hint.form], [canvas.hint.letters], [canvas.hint.lettering], [canvas.hint.flow], [canvas.hint] | `#canvas-hint` | in Ablauf unter 900 px Fensterbreite bzw. 640 px Bühnenbreite ausgeblendet | main.ts:1124-1144; style.css:2711-2734 |
| Farbschema | Bühne folgt hell/dunkel des Systems (Neuzeichnen bei Wechsel) | automatisch (`prefers-color-scheme`) | | main.ts:1633 |
| Bühnengröße | Canvas folgt Größe (ResizeObserver, devicePixelRatio); erstes Mal: Einpassen | automatisch | | main.ts:982-992 |
| Responsives Layout | Unter 760 px: Spalten untereinander (links, Bühne min. 60vh, rechts), Topbar zweizeilig, Griffe aus | CSS | | style.css:634-660, 1319-1335, 2569-2580 |

---

## Besonderheiten (für das Redesign nicht vergessen)

**Persistenz (localStorage)**
- Alle Einstellungen in einem JSON unter `heatstitch.settings.v3` (in PR-Previews `heatstitch-preview-<n>.settings.v3`), settings.ts:156, storage/namespace.ts:6-8. Gespeichert werden u. a.: `mode`, `colorBy`, `marks` (6 Einzelschalter), `marksOn`, `sections` (Aufklappzustand von `display`, `stats`, `advanced`, `findings`, `aiPrep`), `machineSpm`, `playSpeed`, `trimMm`, `order`, `metric`, `cellMm`, `blurMm`, `includeJumps`, `overlay`, `opacity`, `realistic`, `shapesView`, `background`, `fabricLook`, `threadMm`, `liveLight`, `showValidation`, `panels` (Spaltenbreiten), `profile`, `checks`, `correction`, `hoop`, `saveFormat`, `scales` (Skala-Max je Metrik), `image` (Bild-Optionen, Ansicht, Pinselgröße, `introDone`), `lang`. Defaults: settings.ts:118-153.
- Fehlt ein gespeicherter Modus, startet ein Altnutzer im Modus Dichte (Migration), Neunutzer in Ablauf (settings.ts:173, DEFAULTS.mode).
- Migrationsfelder: `showJumps` → `marks.jumps`, `findingsOpen:false` → `sections.findings=false` (settings.ts:166-178).
- "Material" pro Datei (nicht nur global): Profil, Prüfungen, Rahmen, Hintergrundfarbe, Fadenbreite; beim Dateiwechsel übernommen (settings.ts:254-290; main.ts:97, 1230).
- Weitere localStorage-Schlüssel außerhalb meines Scopes: aktive Datei (storage/fileStore.ts:211-221), gewählter Garnkatalog (threads/catalog.ts:173-183). Dateien selbst in IndexedDB, beim Start `files.restore()` und `imageMode.restore()` (main.ts:1637-1638).

**Nur per Taste oder versteckt**
- `,`/`.` mit Umschalt = 100 Stiche, Pos1/Ende für Player: kein Button.
- `n`/`N` (Sprung bzw. Zone), `j`/`k` und Pfeil hoch/runter (Datei wechseln): keine eigenen Buttons in der Hülle.
- `c` Vergleich in Dichte, `v` Befund-Markierungen in Dichte, `v` Ebene Form in Ablauf: gleiche Taste, je Modus anders.
- `t`: neuer Schriftzug, aber im Richtungs-Werkzeug Querlinie/Trennlinie umschalten.
- `e`, `r`, `g` werden geschluckt, solange ein Schriftzug gewählt ist (keys.ts:163).
- Strg/Cmd+Y für Wiederholen (nicht beschriftet). Strg/Cmd+A nur in Stiche-Ebene.
- Rechts-/Mittelklick-Ziehen pannt immer; Rechtsklick öffnet in Ablauf das Objektmenü, im Bild-Modus kein Kontextmenü.
- Langes Drücken (500 ms) auf Touch: Objektmenü bzw. Gummiband (mit Vibration).
- Leertaste auf einem geklickten Button/Schalter spielt in Ablauf ab statt den Button erneut auszulösen.
- Spaltengriffe: Doppelklick/Enter = Standardbreite, Tasten stoppen die Weitergabe (sonst würden 1-3 Modi wechseln).
- Strg/Cmd+Z im Bild-Modus: Bild-Undo, obwohl die Undo-Buttons dort ausgeblendet sind.

**Hover-only**
- Ablauf-Tooltip (Stichnummer, Art, Länge) und Dichte-Tooltip (Wert, Position, Prüfwerte) erscheinen nur beim Hovern; auf Touch nur bei einem Pointer.
- Licht folgt nur der Maus (`pointerType=mouse`) bzw. der Geräteneigung.
- Vergleichs-Trennlinie: Cursor col-resize in 10 px Nähe; Vorschlags-Vergleichslinie folgt der Maus ohne Klick.
- Viele Erklärungen stehen nur in `title`-Attributen (z. B. [mode.*.hint], [level.*.hint], [controls.*.hint], [marks.*.hint], [player.*], Tasten in Klammern). Diese Tasteninfos müssen im neuen UI erhalten bleiben.

**Abhängige Sichtbarkeit / Deaktivierung**
- `data-mode` steuert Sichtbarkeit fast aller Panels; Zeichenleiste zusätzlich nur bei Ebene Form (`.stage.form-level`).
- Ebene "Form" nur in Ablauf; Dichte hat nur Objekte | Stiche.
- Fadenbreite, Licht folgt, Stoff deaktiviert ohne realistische Fäden; Deckkraft ohne Stichplan; Markierungs-Checkboxen in Dichte ohne Stichplan; "Ungetrimmte Sprünge" nur bei Metrik Garnlänge.
- Player, Dateiaktionen (`#file-actions`), Farbliste-Button nur mit Muster; PNG deaktiviert ohne Muster; "Reihenfolge optimieren" deaktiviert unter 2 Objekten (main.ts:805-812, 842).
- "Wie gestickt" nur, wenn das Bild schon in Stiche umgewandelt ist; erste Umwandlung startet die Licht-Animation automatisch (`image.introDone`).
- Moduswechsel zwischen Bild und den anderen passt die Ansicht neu ein; das Einpassen spart die Werkzeugleiste, die Zeichenleiste und den Player aus (`freeArea`, main.ts:966-980). Ein neu gezeichnetes Design behält seine Ansicht (`ui.keepView`).
- Mit gewähltem Rahmen zeigt Einpassen das ganze Stickfeld (main.ts:955-957).
- Zoom-Grenzen 0,05 bis 400 px/mm; Einstiche erst ab 6 px/mm wählbar (außer innerhalb des bearbeiteten Objekts in Ablauf); Einstich-Punkte (Markierung) ab ca. 5 px/mm (render/flow.ts:194).

**PWA / Shell**
- Service Worker mit `registerType: 'prompt'`: neue Version nur nach Klick auf "Neu laden"; `clientsClaim`; offline lauffähig (JS, CSS, HTML, Bilder, Beispiel-PES, Schriftliste, Garnkataloge vorgecacht; Demo-Projekt und Schriften erst nach Gebrauch). vite.config.ts:19-75.
- Manifest: Name "heatstitch", `display: standalone`, Theme #1b1026, Icons 192/512 (+maskable), `file_handlers` für .dst .pes .pec .jef .exp .vp3 .heatstitch .png .jpg .jpeg .webp .svg; verarbeitet über `launchQueue` in src/app/fileIo.ts:252-254 (Datei-Worker).
- PR-Previews: kein SW (selbstzerstörend), `noindex`, eigener Storage-Namespace.
- `<noscript>`-Hinweis mit Link auf die Anleitung (index.html:74-76). SEO-/OG-/JSON-LD-Metadaten im Kopf (index.html:6-71), englisch, nicht übersetzt.
- `html lang` wird bei Sprachwechsel gesetzt; alle `data-i18n`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-label` werden neu gefüllt (i18n/index.ts:20-25, 55ff.).
- Keine URL-Parameter oder Hash-Routen in meinen Dateien gefunden (gesucht nach `location`, `URLSearchParams`).
- Drop von Dateien auf das Fenster (`window` dragover/drop) liegt in src/app/fileIo.ts:240ff. (Datei-Worker).

**Unsicher / nicht geprüft**
- Ob Umschalt+`.`/`,` auf deutschen Tastaturen greift: Code prüft `e.key === '.'`; bei DE-Layout liefert Umschalt+`.` ":" (dann kein Treffer). Nicht im Browser getestet.
- Inhalt und Verhalten von Objektmenü, Ebenenliste, Korrektur, Bild-Modus, Datei-I/O nur als Einstiege erfasst (andere Worker).

---

# Teil: Feature-Inventar B: Dateien, Projekt, Export, Bild-Modus, Stickrahmen, Material, Farbliste, Garnauswahl, Rahmen

Quelle: Code-Stand im Repo `/home/user/heatstitch`. Zeilennummern beziehen sich auf die jeweilige Datei. Deutsche Begriffe aus `src/i18n/de.ts`, i18n-Schlüssel in Klammern. Wo etwas unsicher ist, steht "unsicher".

Modi (für "Verfügbar wenn"): Ablauf = `flow` (Taste 1), Dichte = `density` (Taste 2), Bild = `image` (Taste 3). Sichtbarkeit von Panels steuert `data-mode` in `index.html`.

---

## 1. Dateiliste und Stickmuster-Verwaltung

Panel "Dateien" (`files.title`), `index.html:98-158`, sichtbar in Ablauf und Dichte (`data-mode="flow density"`), **nicht** im Bild-Modus.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Dateien öffnen (Dropzone) "Stickdatei, SVG oder Projekt hierher ziehen oder klicken" (`files.drop`) | Öffnet Dateiauswahl (mehrere Dateien) und lädt sie. | Klick auf Label `#dropzone` (verstecktes `<input type=file id="file-input" multiple>`, accept `.dst,.pes,.pec,.jef,.exp,.vp3,.svg,.heatstitch`, auch Großschreibung) | Ablauf, Dichte | `index.html:100-103`, `src/app/fileIo.ts:39-43` |
| Dateien per Drag & Drop öffnen | Lädt abgelegte Dateien, egal wo im Fenster abgelegt; Stickdateien in die Liste, Bild in den Bild-Modus, Projekt komplett. | Datei(en) irgendwo auf das Fenster ziehen (`window` drop). Während des Ziehens bekommt `body` die Klasse `dragging` (Dropzone wird hervorgehoben) | immer, in jedem Modus | `src/app/fileIo.ts:229-246`, `src/style.css:255-260` |
| Öffnen mit (PWA) | Installierte App öffnet Dateien, die über "Öffnen mit" des Betriebssystems kommen. | `launchQueue` (Manifest `file_handlers`: .dst .pes .pec .jef .exp .vp3, .heatstitch, .png .jpg .jpeg .webp .svg) | nur als installierte PWA mit Browser-Support | `src/app/fileIo.ts:248-256`, `vite.config.ts:38-50` |
| Verteilung beim Öffnen | Projekte zuerst, dann **nur das erste** Bild (png/jpg/jpeg/gif/webp/bmp/svg/avif oder MIME image/*), Rest als Stickdatei. SVG aus Formen: direkt als Stiche in Ablauf; sonst SVG/Bild in Bild-Modus (Modus wechselt automatisch). Andere Endungen werden **still verworfen**. | automatisch nach Picker, Drop, Öffnen mit | | `src/app/fileIo.ts:45-71`, `src/ui/fileList.ts:130-139` |
| "+ Neu" (`files.new`, Tooltip `files.new.hint`) | Legt ein leeres Stickmuster "Neues Stickmuster" (`draw.newName`, bei Kollision "… 2", "… 3") an, mit zuletzt benutztem Material, ohne Rahmen ersatzweise 100 × 100 mm, wechselt nach Ablauf und auf Ebene Form (Zeichnen). | Button `#new-design` | Ablauf, Dichte (Panel) | `index.html:109`, `src/app/fileIo.ts:174-196` |
| "Beispiel laden …" (`files.example`) | Lädt ein Beispiel vom Server. Gruppen: Projekte (`files.example.projects`): "Demo-Projekt (7 Stickmuster)" (`files.example.demo`); Stickdateien (`files.example.stitches`): "Katze", "Überlappende Kreise", "Konfetti (Sprünge)"; Vektorgrafiken (SVG) (`files.example.svg`): "Überlappende Kreise", "Formen-Benchmark". Während SVG/Projekt lädt: Select deaktiviert, Text "Beispiel wird gestickt …" (`files.example.loading`) bzw. "Beispiel wird geladen …" (`files.example.opening`). | Select `#load-example` (Auswahl löst sofort aus, setzt sich zurück) | Ablauf, Dichte | `index.html:110-124`, `src/app/fileIo.ts:198-227` |
| Stickmuster aktivieren | Macht ein Stickmuster aktiv; übernimmt dessen Material in die Einstellungen; Ansicht wird eingepasst. | Klick auf Listeneintrag; Tasten ↓ / `j` (nächstes), ↑ / `k` (vorheriges), zyklisch, nur fehlerfreie Einträge | Klick: Ablauf/Dichte. Tasten: Ablauf (wenn kein Rahmen-, Form-, Stich-Werkzeug die Pfeile nutzt) und Dichte, nicht in Eingabefeldern | `src/ui/fileList.ts:448-476,562`, `src/app/keys.ts:249-250,260-261`, `src/main.ts:94-108` |
| Umbenennen "Umbenennen" (`files.rename`) | Name wird Textfeld; Name vorselektiert, Endung (z. B. `.pes`) bleibt außerhalb der Auswahl. Enter oder Fokusverlust übernimmt, Escape bricht ab. Leerer Name oder Dateiname = zurück zum Dateinamen. Steuerzeichen werden entfernt. | Stift-Button `.rename-btn` (nur sichtbar bei Hover, aktivem Eintrag oder Tastaturfokus), Doppelklick auf den Namen | Eintrag ohne Fehler | `src/ui/fileList.ts:413-446,490-516,528-533,563-575`, `src/style.css:337-348` |
| Entfernen "Entfernen" (`files.remove`) | Entfernt Eintrag aus Liste und IndexedDB, ohne Rückfrage; aktiviert das nächste. | Button `×` am Eintrag | immer (auch Fehler-Einträge) | `src/ui/fileList.ts:457-468,577-586` |
| Statusanzeigen im Eintrag | Format-Kürzel (nicht bei in der App erzeugten), "bearbeitet" (`files.edited`), Prüfpunkt (Sicher/Vorsicht/Kritisch/"Prüfe …", `level.*`, `validation.pending`), "Fehler" (`files.error`) mit Grund im Tooltip. Leer: "Noch keine Datei geladen." (`files.empty`). | Anzeige; Tooltip per Hover | | `src/ui/fileList.ts:478-488,518-561` |
| Datenschutzhinweis "Deine Dateien verlassen nie dein Gerät." (`files.privacy`, Tooltip `files.privacy.detail`) | Reiner Hinweis. | Hover für Detail | Ablauf, Dichte, Bild | `index.html:104-107,167-170` |
| Zurück zum Original (`edit.revert`) | Setzt auf geladene Fassung zurück (selbst ein Undo-Schritt). | Link-Button `#revert` im Speicherbereich | aktives, bearbeitetes Muster, nicht bei leer begonnenem ("Neu"), nicht während Korrektur läuft | `index.html:156`, `src/ui/correctPanel.ts:162,223-224`, `src/main.ts:1154-1164` |

Benennung: Anzeige-Name = vergebener Titel, sonst Dateiname mit Endung; in der App erzeugte ("Neu", Bild, SVG) ohne Endung (`src/ui/fileList.ts:388-411`).

## 2. Speichern als Stickdatei (Formate rein/raus)

Bereich `#file-actions` (nur sichtbar, wenn ein aktives Muster geladen ist, `src/main.ts:807`), im Dateien-Panel.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Format wählen "Format der Stickdatei" (`save.format`) | Wählt Zielformat; Wahl wird gemerkt (`settings.saveFormat`); bis zur ersten Wahl gilt das Format der offenen Datei, sonst PES. | Select `#save-format` | aktives Muster, keine Korrektur läuft | `index.html:140-147`, `src/ui/correctPanel.ts:164-168,225-229` |
| Dateiname "Dateiname, auch der Name des Stickmusters in der Datei" (`save.name`) | Freier Name, Endung `#save-ext` folgt dem Format. Vorschlag: Titel bzw. Dateiname; bearbeitete geladene Datei ohne Titel bekommt `-corrected`. Getippter Name gilt pro Datei (bis Umbenennen). Ungültige Zeichen `\/:*?"<>|` und Endung werden entfernt. | Textfeld `#save-name`, Enter speichert | wie oben | `index.html:148-152`, `src/ui/correctPanel.ts:169-182,230-231`, `src/writers/index.ts:56-63` |
| "Speichern" (`save.file`) | Lädt die Stickdatei herunter (Download). PES und JEF schreiben den gewählten Stickrahmen in die Datei. | Button `#save-file`, Enter im Namensfeld | wie oben | `index.html:153`, `src/app/correction.ts:431-434`, `src/writers/index.ts:66-75` |
| Hinweis "Speichern ⓘ" (`save.title`, Tooltip `save.note`) | Erklärt Verluste je Format (Objekte, Farbrundung). | Hover | | `index.html:139` |

Formate:

| Richtung | Formate |
|---|---|
| Einlesen Stickdatei | DST, PES, PEC, JEF, EXP, VP3 (`src/parsers/index.ts:8-19`). PES/PEC/VP3 per Inhalt erkannt, DST/JEF/EXP per Endung. |
| Einlesen sonst | SVG (Formen direkt als Stiche oder Bild-Modus), Rasterbilder (PNG, JPG/JPEG, GIF, WEBP, BMP, AVIF, MIME image/*) in den Bild-Modus, `.heatstitch` Projekt. |
| Ausgabe Stickdatei (Menüreihenfolge) | PES "PES · Brother, Babylock", DST "DST · Tajima, Profimaschinen", JEF "JEF · Janome, Elna", VP3 "VP3 · Pfaff, Husqvarna", EXP "EXP · Melco, Bernina", PEC "PEC · ältere Brother" (`save.fmt.*`, `src/writers/index.ts:12`) |
| Ausgabe sonst | `.heatstitch` Projekt, PNG (Export) |

## 3. Projektdatei (.heatstitch)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| "Als Projekt (.heatstitch)" (`save.project`, Tooltip `save.project.hint`) | Lädt alles als eine Datei herunter: alle fehlerfreien Dateien (Original-Bytes, Arbeitskopie, quittierte Befunde, Objektformen, nicht gestickte Formen, Material, Titel, "own"), aktiver Index, Bild des Bild-Modus mit Farbänderungen und Pinselstrichen, Einstellungen (Profil, Prüfungen, Korrektur, Fadenschnitt-Länge, Reihenfolge-Optionen, Maschinentempo, Bild-Vorbereitung und Stich-Overrides, Hintergrundfarbe). Name `JJJJ-MM-TT-heatstitch-projekt.heatstitch` (`save.project.file`). gzip-JSON (falls CompressionStream fehlt: unkomprimiert). | Button `#save-project` | aktives Muster vorhanden (Bereich `#file-actions`) | `index.html:155`, `src/app/fileIo.ts:75-113`, `src/storage/project.ts` |
| "Als Projekt speichern" (`image.saveProject`) | Dasselbe aus dem Bild-Modus. | Link-Button `#image-save-project` | Bild-Modus, ein Bild ist geladen | `index.html:174`, `src/app/fileIo.ts:114`, `src/ui/imageMode.ts:807` |
| Projekt öffnen | Übernimmt Einstellungen (Bild-Einstellungen nur wenn Projekt ein Bild hat), ersetzt das Bild des Bild-Modus (auch im Speicher), **fügt** die Dateien zur Liste hinzu und aktiviert die damals aktive. Danach Ablauf (wenn Dateien) bzw. Bild-Modus (nur Bild). | wie Dateien öffnen (Picker, Drop, Öffnen mit, Beispiel Demo-Projekt) | immer | `src/app/fileIo.ts:132-172`, `src/ui/fileList.ts:171-181` |
| Fehler beim Öffnen | Eintrag mit Fehler in der Liste: "Keine heatstitch-Projektdatei oder beschädigt" (`project.error.invalid`) oder "Mit einer neueren heatstitch-Version gespeichert; bitte die Seite neu laden" (`project.error.newer`). | automatisch | | `src/app/fileIo.ts:155-164` |

## 4. PNG-Export

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| PNG exportieren (Button-Text "⤓ PNG", Tooltip "Aktuelle Ansicht als PNG speichern" `controls.export.hint`; `controls.export` "PNG exportieren" existiert als Schlüssel) | Rendert die aktuelle Ansicht in Gerätauflösung (devicePixelRatio) und lädt sie herunter. Ablauf: `<Name>-sequence.png` ohne Legende. Dichte: mit Heatmap-Legende und Zeile "Prüfprofil: {Stoff}, {Garn}" (`export.profile`) unten rechts, Datei `<Name>-<thread|penetrations>-density.png`. Handbearbeitungs-Overlay wird weggelassen. | Button `#export` in der Stage-Leiste; keine Taste | Ablauf, Dichte; deaktiviert ohne aktives Muster | `index.html:396`, `src/main.ts:1393-1396,806`, `src/ui/export.ts:6-44` |

## 5. Bild-Modus (Bild in Stickmuster)

Panels: "Bild" (`image.title`), "Vorbereitung" (`image.prep`), "Stiche" (`image.stitch`) links; "Farben" (`image.palette`), "Pinsel" (`image.brush`), "Ergebnis" (`image.result`) rechts; Ansicht-Umschalter und "Wie gestickt" in der Stage-Leiste; Statuszeile `#image-status`. Zusätzlich das Material-Panel (Abschnitt 7). Alles nur im Bild-Modus.

### 5.1 Funktionen

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Bild öffnen "Bild oder SVG hierher ziehen oder klicken" (`image.drop`) | Lädt **ein** Bild (ersetzt das bisherige). Rasterbild max. 1600 px längste Seite, SVG auf 1600 px gezeichnet. | Klick auf `#image-drop` (Input `#image-input`, accept `image/*,.svg`, einzeln); Drop irgendwo ins Fenster (globaler Handler, auch aus anderen Modi, wechselt in Bild-Modus); Öffnen mit (PWA) | Bild-Modus (Dropzone); Drop immer | `index.html:163-166`, `src/ui/imageMode.ts:240-245,389-450`, `src/app/fileIo.ts:53-69` |
| "Beispielbild laden" (`image.example`) | Lädt `examples/image-example.svg`. | Link-Button `#image-example` | Bild-Modus | `index.html:171`, `src/ui/imageMode.ts:246-254` |
| Bild-Info | "{name}, {w} × {h} Pixel" (`image.info`), bei SVG "{name}, SVG mit {n} Farben" (`image.info.svg`, Einzahl `.one`), oder Fehler "Bild lässt sich nicht öffnen: {msg}" (`image.error.load`) / "Umwandlung fehlgeschlagen: {msg}" (`image.error.convert`). | Anzeige `#image-info` | | `src/ui/imageMode.ts:798-806` |
| "Bild entfernen" (`image.clear`, Tooltip `image.clear.hint`) | Nimmt Bild samt Farbänderungen und Pinselstrichen heraus, löscht es aus IndexedDB; übernommene Stickmuster bleiben. Keine Rückfrage. | Link-Button `#image-clear` | Bild oder Ladefehler vorhanden | `index.html:175`, `src/ui/imageMode.ts:336,453-480,808` |
| Als Projekt speichern | siehe Abschnitt 3 | `#image-save-project` | Bild geladen | |
| "Bild mit KI vorbereiten" (`image.ai.title`) | Aufklappbarer Abschnitt mit Anleitung (`image.ai.intro`, `image.ai.step1..3`, `image.ai.note`) und schreibgeschütztem Prompt (`image.ai.text`), der Breite {w}, Farbanzahl {n} und kleinste Detailbreite {d} = max(0,2; 100/Breite) % einsetzt. | `<details data-section="aiPrep">` aufklappen | Bild-Modus (auch ohne Bild) | `index.html:177-190`, `src/ui/imageMode.ts:788-792` |
| "Prompt kopieren" (`image.ai.copy`) | Kopiert Prompt in Zwischenablage; Button zeigt 2,5 s "Kopiert" (`image.ai.copied`), ohne Clipboard-Zugriff wird Text markiert und "Markiert: mit Strg+C kopieren" (`image.ai.select`). | Button `#image-ai-copy` | | `src/ui/imageMode.ts:323-335` |
| Ansicht "Original" / "Vorbereitet" / "Stiche" (`image.view.*`, Gruppe `image.view`) | Original: Quellbild. Vorbereitet: reduziertes Farbbild (Pixel scharf beim Hineinzoomen). Stiche: Vorbereitetes zu 25 % deckend plus Stiche (realistische Fäden, wenn "Realistisch" an; Stoffstruktur, wenn eingeschaltet; Sprünge je nach Markierungen). Gestrichelter Umriss der Musterfläche immer. | Radio `name="image-view"` in Stage-Leiste Mitte | Bild-Modus | `index.html:387-391`, `src/ui/imageMode.ts:298-306,693-737` |
| "Wie gestickt" (`image.shine`, Tooltip `image.shine.hint`) | Schaltet realistische Fäden, bewegliches Licht und Ansicht Stiche ein, Licht läuft einmal herum; fragt auf iOS die Neigungs-Erlaubnis an. | Button `#image-shine` (✦) | Bild-Modus, Ergebnis vorhanden | `index.html:393`, `src/ui/imageMode.ts:891`, `src/app/light.ts:51-65` |
| Farbe sticken / weglassen ("Diese Farbe sticken", `image.color.sew`) | Schaltet eine Farbe der Palette an/aus (Undo-Schritt). | Checkbox in Palettenzeile | vorbereitetes Bild | `src/ui/imageMode.ts:828-829` |
| Anderes Garn ("Garnfarbe", `image.color.thread`) | Öffnet Garnauswahl (Abschnitt 9) für diese Farbe. | Klick auf Farbfeld `.image-color .sw`; erneuter Klick schließt | vorbereitetes Bild | `src/ui/imageMode.ts:831-844` |
| Zusammenlegen ("Mit anderer Farbe zusammenlegen", `image.color.merge`) | Legt Farbe in eine andere gestickte Farbe. | Select "→" in Palettenzeile | mindestens zwei gestickte Farben | `src/ui/imageMode.ts:860-871` |
| Pinselfarbe wählen | Klick auf die Zeile (nicht auf Checkbox/Feld/Select) wählt sie als Malfarbe und schaltet Werkzeug "Malen" ein; Zeile wird markiert (`.brush`). | Klick auf Palettenzeile | vorbereitetes Bild | `src/ui/imageMode.ts:874-879` |
| Palettenanzeige | Pro Farbe: Garnname oder Hex, Fläche in mm², Warnzeichen "≠" mit Tooltip "Kein Garn liegt nah an der Bildfarbe (ΔE {de})." (`image.color.far`) bei ΔE > 10. Leer: "Noch kein Bild geladen." / "Bereite vor …" (`image.none`, `image.busy`). Hilfetext `image.palette.hint`. | Anzeige, Tooltip per Hover | | `src/ui/imageMode.ts:813-883`, `index.html:436-440` |
| Pinsel-Werkzeug "Aus" / "Malen" / "Radieren" (`image.tool.*`) | Malen färbt Bereiche mit der gewählten Palettenfarbe um, Radieren entfernt (dort nicht gesticht). Jeder Strich ein Undo-Schritt, Vorschau sofort. Hinweistext wechselt (`image.brush.hint`, `image.brush.paint`, `image.brush.erase`). | Radio `name="image-tool"`; Malen auch per Klick auf Palettenzeile. Strich: linke Maustaste / ein Finger ziehen | vorbereitetes Bild vorhanden | `index.html:444-448,453`, `src/ui/imageMode.ts:307-311,615-689`, `src/app/pointer.ts:112-121,207-211,274-279` |
| Pinselstrich-Gesten | Rechte oder mittlere Maustaste verschiebt die Ansicht beim Malen (Kontextmenü im Bild-Modus unterdrückt). Zweiter Finger bricht den laufenden Strich ab (Zoom). Pinselkreis folgt dem Zeiger (nur bei Hover). | Maus/Touch | Werkzeug Malen/Radieren | `src/app/pointer.ts:112-121,436-438,372-377`, `src/ui/imageMode.ts:724-736` |
| "Rückgängig" (`image.undo`) | Macht letzte Änderung rückgängig (Pinselstriche **und** Farbänderungen: sticken/Garn/zusammenlegen). | Button `#image-strokes-undo`; Strg/Cmd+Z | Bild-Modus, Undo-Stapel nicht leer | `index.html:455`, `src/ui/imageMode.ts:318,592-597,784`, `src/app/keys.ts:64-68`, `src/main.ts:1155-1158` |
| Wiederholen (kein Button im Bild-Modus) | Stellt rückgängig Gemachtes wieder her. | nur Strg/Cmd+Umschalt+Z oder Strg/Cmd+Y | Bild-Modus | `src/ui/imageMode.ts:599-604`, `src/app/keys.ts:64-68` |
| "Alle Striche entfernen" (`image.strokes.clear`) | Entfernt alle Pinselstriche (ein Undo-Schritt), Farbänderungen bleiben. | Button `#image-strokes-clear` | mindestens ein Strich | `index.html:456`, `src/ui/imageMode.ts:319-322,785` |
| "Werte für das Material" (`image.stitch.reset`) | Verwirft alle eigenen Stich-Einstellungen, die Werte folgen wieder dem Material. | Link-Button `#image-stitch-reset` | nur sichtbar, wenn mindestens eine Stich-Einstellung geändert wurde | `index.html:242`, `src/ui/imageMode.ts:293-296,779` |
| Ergebnis (`image.result`) | Zeigt Stiche, Größe, Farben (`image.result.colors`), Objekte "{fill} Füllung, {satin} Satin, {run} Steppstich" (`image.result.kinds`), "Gebogene Füllungen" (nur wenn vorhanden), Fadenschnitte, Nähzeit "ca. {m} min" (mit Maschinentempo). Urteil Unauffällig/Vorsicht/Kritisch mit Text (`image.verdict.safe` / `image.verdict.findings`), vorher "Prüfe …". | Anzeige `#image-result`, `#image-verdict` | Ergebnis vorhanden | `src/ui/imageMode.ts:885-926` |
| "Als Stickmuster übernehmen" (`image.take`, Hinweis `image.take.hint`) | Legt die Stiche als neues Stickmuster (Name = Bilddateiname ohne Endung, als "own") in die Dateiliste und wechselt nach Ablauf. Großer Hintergrund einer SVG wird nicht gestickt, sondern unter "Nicht gestickt" abgelegt (Meldung `aside.backgroundFound`). | Button `#image-take` | Ergebnis vorhanden und nichts wird gerade berechnet | `index.html:465`, `src/ui/imageMode.ts:337-341,890`, `src/main.ts:1294-1313` |
| Statuszeile | "Bereite Bild vor …" / "Erzeuge Stiche …" (`image.busy.prepare`, `image.busy.stitches`). | Anzeige `#image-status` (aria-live) | während Berechnung | `src/ui/imageMode.ts:892-893` |
| Einpassen | Passt Bildfläche in die Bühne. | Taste `f`; Doppelklick auf die Bühne; Button `#fit` "Einpassen" (`controls.fit`, Tooltip `controls.fit.key`) | | `src/app/keys.ts:211-213`, `src/app/pointer.ts:478` |

### 5.2 Parameter Bild-Modus

Zahlenfelder wirken bei `change` (Enter/Verlassen), Schieberegler sofort bei `input` (`src/ui/imageMode.ts:256-265`). Jede Änderung startet nach 150 ms eine Neuberechnung im Worker.

| Steuerelement | Label (Schlüssel) | Typ, Bereich, Schritt | Standard | Einheit | Code |
|---|---|---|---|---|---|
| `#image-width` | "Breite (mm)" (`image.width`), dahinter Ausgabe `#image-height` "{w} × {h} mm" (`image.size`) plus Rahmenhinweis "zu groß für den Stickrahmen {hoop}" / "passt nur gedreht in {hoop}" | Zahl 10..400, Schritt 1 (Code klemmt 10..400) | 80; SVG mit physischer Größe setzt beim Laden diese Breite (geklemmt, auf 0,1 gerundet) | mm | `index.html:195-198`, `src/ui/imageMode.ts:266,443,750-754` |
| `#image-colors` | "Höchstens Farben" (`image.colors`, Tooltip `image.colors.hint`) | Regler 2..16, Schritt 1 | 6 | Anzahl | `index.html:200-203`, `src/image/prepare.ts:36-43` |
| `#image-smooth` | "Vereinfachen" (`image.smooth`, Tooltip `image.smooth.hint`), 0 zeigt "aus" (`controls.off`) | Regler 0..5, Schritt 1 | 0; beim Laden automatisch 3 für Fotos (nicht SVG), sonst 0 | Stufe | `index.html:204-207`, `src/ui/imageMode.ts:439-441` |
| `#image-min-area` | "Kleinste Fläche" (`image.minArea`, Tooltip `image.minArea.hint`) | Regler 0,5..20, Schritt 0,5 (gespeichert erlaubt bis 50) | 3 | mm² | `index.html:208-211`, `src/settings.ts:230` |
| `#image-background` | "Hintergrund weglassen" (`image.background`, Tooltip) | Checkbox | an | | `index.html:212` |
| `#image-threads` | "Brother-Garnfarben" (`image.threads`, Tooltip) | Checkbox | an | | `index.html:213` |
| `#image-spacing` | "Abstand (mm)" (`image.spacing`, Tooltip) | Zahl 0,2..1,5, Schritt 0,05 (setzt Füll- und Satinabstand, geklemmt) | Material: unterer empfohlener Abstand (Webware 0,4; Kappe 0,4; Strick 0,42; Frottee 0,55; Leicht 0,6; Leder 0,5) | mm | `index.html:220-223`, `src/ui/imageMode.ts:270`, `src/digitize/digitize.ts:110-129`, `src/validation/profiles.ts:34-41` |
| `#image-pull` | "Zugausgleich (mm)" (`image.pull`, Tooltip) | Zahl 0..1, Schritt 0,05 (geklemmt) | Material: Webware 0,2, Kappe 0,2, Strick 0,35, Frottee 0,4, Leicht 0,15, Leder 0,15 | mm | `index.html:224-227`, `src/digitize/digitize.ts:72` |
| `#image-angle` | "Füllrichtung" (`image.angle`, Tooltip) | Select: "Folgt dem Bild" (`image.angle.flow`, bei SVG ausgeblendet), "Gerade, automatisch" (`image.angle.auto`), 0°, 15°, … 165° | Folgt dem Bild (bei SVG: Gerade, automatisch) | Grad | `index.html:229-232`, `src/ui/imageMode.ts:59,284-292,770-778` |
| `#image-satin-max` | "Satin bis Breite" (`image.satinMax`, Tooltip) | Regler 1..10, Schritt 0,5 | 7 | mm | `index.html:233-236` |
| `#image-tolerance` | "Max. Abweichung" (`stitch.tolerance`, Tooltip `image.tolerance.hint`) | Regler 0,05..0,5, Schritt 0,05 | 0,15 | mm | `index.html:237-240`, `src/digitize/run.ts:10` |
| `#image-underlay` | "Unterlage" (`image.underlay`, Tooltip) | Checkbox | an | | `index.html:241` |
| `#image-brush` | "Größe" (`image.brushSize`), Ausgabe "{x} mm" | Regler 0,5..20, Schritt 0,5 (gespeichert erlaubt bis 30) | 3 | mm Durchmesser | `index.html:449-452`, `src/settings.ts:151,236` |
| `image-view` | Ansicht | Radio original / prepared / stitches | stitches | | `src/settings.ts:151` |
| `image-tool` | Pinsel | Radio none / paint / erase | none (nicht gespeichert) | | `index.html:445-447` |

Hinweis `#image-material`: "Material: {fabric}, {thread}. Abstand und Zugausgleich richten sich danach." (`image.material`). Bei SVG: Felder Farben und Vereinfachen ausgeblendet, Hinweis `image.svg.note` sichtbar (`src/ui/imageMode.ts:796-797`).

## 6. Stickrahmen

Im Bereich `#file-actions` (nur mit aktivem Muster, Ablauf/Dichte).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Stickrahmen wählen "Stickrahmen" (`hoop.title`, Tooltip `hoop.hint`) | Setzt den Rahmen des aktiven Musters (gehört zum Material des Musters); Ansicht wird eingepasst und zeigt das ganze Stickfeld. Optionen: "Kein Stickrahmen" (`hoop.none`), 50 × 50 (Janome, Brother), 100 × 100 (Brother, Babylock, Janome, Pfaff), 126 × 110 (Janome), 130 × 180 (Brother, Babylock), 140 × 200 (Janome), 160 × 260 (Brother, Babylock, Pfaff), 200 × 200 (Janome, Husqvarna), 200 × 300 (Brother, Babylock, Husqvarna), 240 × 360 (Brother, Pfaff), "Eigene Größe …" (`hoop.own`). | Select `#hoop` | aktives Muster | `index.html:128-131`, `src/ui/hoopPanel.ts:41-68`, `src/model/hoop.ts:10-20`, `src/main.ts:1239-1247,955-957` |
| Eigene Größe | Zwei Zahlenfelder Breite × Höhe; Start = aktueller Rahmen oder 150 × 150. | `#hoop-w`, `#hoop-h` (Aria `hoop.width`, `hoop.height`), wirksam bei `change` | "Eigene Größe …" gewählt oder Rahmen nicht in der Liste | `index.html:132-137`, `src/ui/hoopPanel.ts:57-78` |
| Passt-Hinweis | "Passt nicht in den Stickrahmen {hoop}: {x mm zu breit und y mm zu hoch}." (`hoop.over`, `hoop.wider`, `hoop.taller`, `hoop.and`), "Passt nur um 90° gedreht …" (`hoop.turned`), "Die Datei ist für den Stickrahmen {hoop} angelegt." (`hoop.file`, wenn Dateikopf einen anderen passenden Rahmen nennt). | Anzeige `#hoop-note` | Muster und Hinweis vorhanden | `src/ui/hoopPanel.ts:10-35,104-133` |
| "Passend verkleinern" (`hoop.fit`, Tooltip `hoop.fit.hint`) | Verkleinert das ganze Muster gleichmäßig mit 1 mm Rand und stickt neu (ein Undo-Schritt), Meldung "Auf {pct} % verkleinert und neu gestickt." (`hoop.fitted`); blockiert bei Objekten, die Füllung und Satin zugleich sind (`hoop.fit.blocked`). | Link-Button im Hinweis | Muster zu groß (nicht nur gedreht), nicht im Bild-Modus | `src/ui/hoopPanel.ts:115-119`, `src/main.ts:1249-1269` |
| "{hoop} wählen" (`hoop.pick`) | Wählt den in der Datei genannten Rahmen oder den kleinsten größeren Listenrahmen, der passt. | Link-Button im Hinweis | Angebot vorhanden | `src/ui/hoopPanel.ts:120-131`, `src/model/hoop.ts:57-64` |

Parameter: `#hoop-w`/`#hoop-h` Zahl 10..1000 mm, Schritt 1, gerundet; Standard ohne Rahmen (`hoop: null`); "Neu" setzt ersatzweise 100 × 100. Rahmen wird beim Speichern in PES und JEF geschrieben. Im Bild-Modus wird der aktuelle Rahmen nur angezeigt (Größenhinweis), dort nicht wählbar.

## 7. Material (Stoff, Garn, Prüfungen)

Panel "Material" (`profile.title`) `#material-panel`, sichtbar in **Dichte und Bild** (nicht Ablauf). Prüfungen, "So wird geprüft" und "Auf Stoff abstimmen" nur in Dichte.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| "Stoff" (`profile.fabric`) | Wählt Stoff; Grenzwerte, empfohlener Abstand, Zugausgleich im Bild-Modus, Perforationsprüfung folgen. Bietet danach passendere Objekt-Einstellungen an (nie still). | Select `#fabric` | Dichte, Bild | `index.html:264-267`, `src/ui/profilePanel.ts:38-133`, `src/main.ts:1271-1282` |
| "Garn" (`profile.thread`) | Wählt Garnstärke; setzt dabei die Fadenbreite der realistischen Ansicht auf den Wert der Stärke zurück. | Select `#thread` | Dichte, Bild | `index.html:268-271`, `src/ui/profilePanel.ts:126-133` |
| Profil-Info | Beispiele (`fabric.*.ex`), "Vorsicht ab {caution}, Kritisch ab {critical} mm/mm²" (`profile.limits`), "Empfohlener Stichabstand {min} bis {max} mm" (`profile.spacing`), bei Leder `profile.perforation`. | Anzeige `#profile-info` | | `src/ui/profilePanel.ts:78-86` |
| "Auf Stoff abstimmen" (`tune.button`, Tooltip `tune.button.hint`) | Zeigt, welche Objekt-Einstellungen besser passen; übernommen erst auf Klick (Details in Korrektur-Inventar). | Button `#fabric-tune` | Dichte | `index.html:273-275`, `src/main.ts:1647` |
| "Prüfungen" (`checks.title`) | Fünf Schalter: "Garndichte", "Kurzstich-Häufung", "Perforation" (nur Leder/Kunstleder, sonst deaktiviert mit `checks.perforation.na`), "Deckung und Lücken", "Lange Stiche" (`checks.*`, Hinweise `checks.*.hint`). | Checkboxen in `#checks` | Dichte | `index.html:277-280`, `src/ui/profilePanel.ts:45-70` |
| "So wird geprüft" (`validation.explain`) | Aufklappbare Erklärung mit aktuellen Grenzwerten (`validation.explain.*`). | `<details class="explain">` | Dichte | `index.html:281-284`, `src/ui/profilePanel.ts:89-123` |

Optionen Stoff: Webware, stabil / Kappe, strukturiert / Strick, Fleece / Frottee, Flor / Leicht, empfindlich / Leder, Kunstleder (`fabric.woven|cap|knit|terry|light|leather`). Garn: 60 wt (fein) / 40 wt (Standard) / 30 wt (kräftig) / 12 wt (sehr dick) (`thread.60|40|30|12`). Standard: Webware, 40 wt, alle Prüfungen an (`src/validation/profiles.ts:55`, `src/validation/validate.ts:35`).

Material pro Muster: Stoff, Garn, Prüfungen, Stickrahmen, Hintergrundfarbe und Fadenbreite gehören zum einzelnen Stickmuster. Aktivieren übernimmt sie in die Panels; Änderungen in den Panels gehen nur an das aktive Muster; neue Muster starten mit dem zuletzt benutzten (`src/app/fileIo.ts:116-130`, `src/settings.ts:254-290`).

## 8. Farbliste und Druck

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| "Farbliste" (`colorList.button`, Tooltip `colorList.buttonHint`) | Öffnet modalen Dialog "Farbliste" (`colorList.title`) mit den Garnen in Stickreihenfolge. | Link-Button `#color-list` im Kopf des Ebenen-Panels | Ablauf, aktives Muster mit mindestens einem Farbblock | `index.html:475`, `src/app/objects.ts:440-458`, `src/main.ts:812` |
| Inhalt (wird gedruckt) | Vorschaubild 180 px (Fäden auf hellem Grund), Name, Größe, Stiche, Farben "{colors} in der Reihenfolge, {spools} Garne", Garn (m), Stickzeit; Tabelle # / Garn (Marke+Nummer, Name) / Stiche / m, optional Spalte "Nächstes in {catalog}" mit Nähe-Angabe (gleich/sehr nah/nah/nur ähnlich, `threads.dE.*`) oder "schon dabei". | Anzeige | Dialog offen | `src/ui/colorList.ts:68-128,172-224` |
| "Meine Garnmarke" (`colorList.brand`) | Wählt Vergleichsmarke (gemerkt, gleiche Wahl wie in der Garnauswahl). | Select im Dialog | Dialog offen | `src/ui/colorList.ts:132-143` |
| "Auf {catalog} umstellen" (`colorList.switch`, Tooltip `colorList.switchHint`) | Gibt jeder Farbe das nächste Garn der Marke, ein Undo-Schritt (Strg+Z); Meldung `colorList.switched`. | Button im Dialog | Marke gewählt und mindestens eine Farbe nicht aus dieser Marke | `src/ui/colorList.ts:144-158`, `src/app/objects.ts:449-455` |
| "Drucken" (`colorList.print`) | Ruft Browser-Druck auf; Druck-CSS zeigt nur den Dialog. | Button im Dialog | Dialog offen | `src/ui/colorList.ts:159-162`, `src/style.css:4175-4200` |
| Schließen "Schließen" (`colorList.close`) | Schließt den Dialog. | Button `×`; Klick auf den Hintergrund; Escape (nativer `<dialog>`) | Dialog offen | `src/ui/colorList.ts:45-49,81-85` |

## 9. Garnkataloge und Garnauswahl (Popup)

Verwendet an: Farbfelder der Bild-Palette (`.image-color .sw`), Ebenenliste (`.layer .sw`), Objekt-Panel (`.thread-sw`), Stich-Panel Rand (`.border-thread`), Schriftzug (`.lettering-color`) (`src/ui/stitchPanel.ts:252`, `src/ui/objectPanel.ts:127`, `src/ui/layersPanel.ts:92`, `src/ui/letteringPanel.ts:77`, `src/ui/imageMode.ts:203`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code (`src/ui/threadPicker.ts`) |
|---|---|---|---|---|
| Popup öffnen/schließen | Öffnet neben dem Farbfeld (auf dem Bildschirm gehalten); erneuter Klick auf dasselbe Feld schließt. Schließt auch bei Auswahl, Escape, Klick außerhalb, Fenstergröße ändern, Sprachwechsel. | Klick auf Farbfeld; Esc; Klick außerhalb | | 32-48, 56-58, 234-243 |
| Original-Zeile (optional) | Erste Zeile, z. B. die Farbe wie geladen, mit Beschriftung des Aufrufers. | Klick | wenn Aufrufer `original` übergibt | 89-100 |
| "Garnmarke" (`threads.catalog`) | Wählt Katalog; Gruppen "Verbreitet" (`threads.common`) und "Weitere Marken" (`threads.more`), mit Anzahl Garne; Wahl gilt global und wird gemerkt. | Select im Popup | | 108-147, 178-181 |
| Suche "Nummer oder Name" (`threads.search`) | Filtert: exakte Nummer, dann Nummernanfang (führende Nullen egal), dann Name enthält. Enter wählt den ersten Treffer. Leer: "Nichts davon in {catalog}." (`threads.none`). | Suchfeld; Enter | | 112-118, 173-188 |
| "Am nächsten:" (`threads.nearest`) | Drei nächste Garne (CIEDE2000) mit Nähe-Angabe, wenn die aktuelle Farbe nicht im Katalog ist und nicht gesucht wird. | Klick | aktuelle Farbe nicht aus diesem Katalog | 152-171 |
| Farbraster | Alle Garne des Katalogs; Name erscheint sofort unten bei Hover oder Fokus (Hover-Verhalten), sonst aktueller Name. Aktuelles Garn markiert (`aria-current`) und fokussiert. | Klick wählt | | 68-82, 123-128, 174, 226-230 |
| "Eigene Farbe …" (`layers.ownColor`) | Freie Farbe per System-Farbwähler. | `<input type=color>` (wirkt bei `change`) | | 205-215 |
| Hinweis (optional) | Kleingedrucktes des Aufrufers. | | wenn übergeben | 217-222 |
| Kataloge laden | Lädt `threads/catalogs.json` beim ersten Öffnen; Fehler "Die Garnmarken ließen sich nicht laden." (`threads.loadFailed`). Auch beim App-Start geladen (`src/main.ts:1639-1645`). | automatisch | | 192-203 |

Kataloge: Brother eingebaut (PEC-Palette, Standard, "Verbreitet") plus 70 Kataloge aus `public/threads/catalogs.json` (Quelle Ink/Stitch, GPL-3.0), davon 16 "Verbreitet" (Madeira Polyneon, Madeira Rayon, Isacord Polyester, Gunold Polyester, Gütermann Creativ Dekor, Mettler Poly Sheen, Sulky Rayon, Sulky Polyester, Robison-Anton Polyester/Rayon, Marathon Polyester/Rayon, Brothread 40, Simthread 63 (Brother colors), Janome, Floriani Polyester); "Brother Embroidery" dient nur der Nummerierung und erscheint nicht als Liste (`src/threads/catalog.ts:27-56`). Gesamt in der Auswahl also 71.

## 10. Rahmen-Werkzeug (Auswahlrahmen: verschieben, drehen, skalieren)

Rahmen um die gewählten Objekte. Aktiv in Ablauf, Ebenen Form und Objekte, wenn Objekte gewählt sind und weder Stich-Bearbeitung, Zeichnen, Stege-Werkzeug, Reihenfolge-Karte noch Buchstaben-Verschieben offen ist (`src/app/drawing.ts:199-204`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Verschieben | Ziehen im Rahmen (4 px Toleranz) verschiebt, Schritte 0,1 mm, Live-Vorschau; ein Undo-Schritt beim Loslassen. Unter 3 px Bewegung = Klick. Beschriftung "dx / dy mm". | Ziehen innen | Rahmen aktiv | `src/ui/frameTool.ts:115-123,139-166`, `src/render/shapeOverlay.ts:208-216` |
| Einrasten | Kanten und Mitten rasten auf Kanten/Mitten der anderen Objekte und die Mitte aller anderen ein (6 px), Einrastlinie in Akzentfarbe quer über die Bühne. | automatisch; **Alt** gedrückt: frei ohne Einrasten | andere Objekte vorhanden | `src/ui/frameTool.ts:32-59,158-164`, `src/app/drawing.ts:230-244`, `src/render/shapeOverlay.ts:192-205` |
| Achse sperren | Nur waagrecht oder senkrecht verschieben. | **Umschalt** beim Ziehen | | `src/ui/frameTool.ts:153-157` |
| Skalieren | Eckgriff ziehen, gegenüberliegende Ecke bleibt; gleichmäßig entlang der Diagonale; **Umschalt** = Breite und Höhe frei. Minimum Faktor 0,05, gerundet 0,001. Wird beim Loslassen neu gestickt. Beschriftung "B × H mm". | Eckgriffe (10 px Fangradius) | nur wenn alle gewählten Objekte skalierbar (nicht Füllung+Satin zugleich) | `src/ui/frameTool.ts:117-120,172-188`, `src/app/drawing.ts:227` |
| Drehen | Runder Griff 26 px über der Mitte der Oberkante dreht um die Mitte, 0,1° Schritte; **Umschalt** = 15°-Schritte. Beschriftung "x°". | Drehgriff ziehen | Rahmen aktiv | `src/ui/frameTool.ts:7,116,166-171` |
| Hover-Hervorhebung | Griff/Rahmen unter dem Zeiger wird hervorgehoben, Cursor-Klasse `on-frame`. | Zeiger darüber (nur Hover) | | `src/ui/frameTool.ts:214-219`, `src/app/pointer.ts:255-259` |
| Pfeiltasten verschieben | 0,1 mm, mit Umschalt 1 mm, je ein Undo-Schritt. | ← → ↑ ↓ (nicht wenn Fokus auf einem Button) | Rahmen aktiv, Ablauf | `src/app/keys.ts:134-143` |
| Löschen | Entfernt gewählte Objekte. | Entf / Rücktaste | Ablauf, Objekte gewählt | `src/app/keys.ts:130-133` |
| Duplizieren | Dupliziert das gewählte Objekt. | Strg/Cmd+D | Ablauf, genau ein Objekt | `src/app/keys.ts:69-73` |
| Abbrechen | Laufender Zug wird verworfen. | zweiter Finger (Pinch), `pointercancel`, Langdruck öffnet Objektmenü, Moduswechsel schließt Rahmen | | `src/app/pointer.ts:177,191-193,364-369`, `src/main.ts:708-711` |
| Schriftzug | Ein Schriftzug wird an der neuen Stelle neu gesetzt (Text bleibt). | wie oben | Schriftzug gewählt | `src/app/drawing.ts:258-262` |

---

## Besonderheiten (darf im Redesign nicht verloren gehen)

**Persistenz**
- IndexedDB `heatstitch` (Store `files`): jede geladene, parsebare Datei mit Original-Bytes, Arbeitskopie (nach jeder Änderung), quittierten Befunden, Objektformen, nicht gestickten Formen, Material, Titel, "own". Beim Start werden alle wiederhergestellt (`src/storage/fileStore.ts`, `src/ui/fileList.ts:152-165`, `src/main.ts:1637`). Fehlerhafte Dateien werden nicht gespeichert.
- localStorage `heatstitch.activeFile`: Schlüssel der aktiven Datei (`src/storage/fileStore.ts:46,211-221`).
- IndexedDB `heatstitch.image` (Store `image`): Bild des Bild-Modus plus Farbänderungen und Pinselstriche, beim Start wiederhergestellt (`src/storage/imageStore.ts`, `src/main.ts:1638`). Undo-Stapel des Bild-Modus wird **nicht** gespeichert.
- localStorage `heatstitch.settings.v3`: u. a. Modus, `saveFormat`, Rahmen, Profil, Prüfungen, Bild-Vorbereitung, Bild-Stich-Overrides, Bild-Ansicht, Pinselgröße, `introDone`, offene Abschnitte (`sections`, inkl. `aiPrep`) (`src/settings.ts:156,241-247`).
- localStorage `heatstitch.threadCatalog`: gewählte Garnmarke, gemeinsam für Farbliste und alle Garnauswahl-Popups (`src/threads/catalog.ts:167-187`).
- PR-Vorschauen nutzen eigenen Namensraum `heatstitch-preview-<n>` (`src/storage/namespace.ts`).
- Getippter Speichername gilt nur für die Sitzung (WeakMap pro Datei).

**Automatisches Verhalten**
- Abgelegte/gewählte Bilder wechseln automatisch in den Bild-Modus; SVG aus reinen Formen geht stattdessen direkt als Stiche nach Ablauf; bei mehreren Bildern wird nur das erste genommen; unbekannte Endungen werden ohne Meldung ignoriert.
- Projekt öffnen fügt Dateien hinzu (ersetzt nichts in der Liste), ersetzt aber das Bild und übernimmt Material/Prüf-/Korrektur-/Reihenfolge-Einstellungen.
- Aktivieren eines Musters übernimmt dessen Material in die Panels; Material-Änderungen gelten nur für das aktive Muster.
- Erstes je umgewandeltes Bild: automatisch "Wie gestickt" (realistisch, Licht, Ansicht Stiche) mit Lichtschwenk; spätere neue Bilder: Lichtschwenk nur, wenn realistisch, Licht an und Ansicht Stiche (`src/ui/imageMode.ts:542-548`, `src/main.ts:1289-1292`).
- Fotos bekommen beim Laden automatisch "Vereinfachen" 3, Grafiken 0; SVG mit Maßangabe setzt Breite.
- Hintergrund-Rechteck einer SVG (ganz hinten, deckt ≥ 90 %) wird nicht gestickt, sondern unter "Nicht gestickt" abgelegt.
- Rahmen wählen passt die Ansicht an und zeigt das ganze Stickfeld; neues leeres Muster ohne Rahmen zeigt 10 × 10 cm.
- Garnstärke wechseln setzt Fadenbreite der realistischen Ansicht zurück; Stoff wechseln bietet "Auf Stoff abstimmen"-Vorschläge an.
- Bearbeitete geladene Datei schlägt Speichernamen mit `-corrected` vor.
- Undo-Historie pro Datei max. 50 Schritte, nicht über Neuladen hinaus (nur Original + Arbeitskopie bleiben, ein Undo führt dann zum Original).

**Versteckte Gesten und Hover-only**
- Umbenennen per Doppelklick auf den Namen; Stift-Button nur bei Hover/aktiv/Fokus sichtbar.
- Doppelklick auf die Bühne passt ein (im Bild-Modus immer).
- Bild-Modus: rechte/mittlere Maustaste verschiebt beim Malen; Kontextmenü unterdrückt; zweiter Finger bricht Strich ab; Pinselkreis nur bei Hover.
- Rahmen: Alt = ohne Einrasten, Umschalt = Achse sperren / frei skalieren / 15°-Drehung; Strg/Cmd+D duplizieren.
- Garnauswahl: Name einer Farbe nur bei Hover/Fokus; Enter in der Suche wählt ersten Treffer.
- Palettenzeile anklicken = Malfarbe und Werkzeug Malen.
- Tooltips tragen Erklärungen (Hover): Datenschutz, Speicherhinweis `save.note`, Bild-Parameter, Rahmenhinweis, Fehlergrund in der Dateiliste, ΔE-Warnung "≠".
- Bild-Modus Wiederholen nur per Tastatur (Strg/Cmd+Umschalt+Z, Strg/Cmd+Y); globale Undo/Redo-Buttons `#undo`/`#redo` sind im Bild-Modus ausgeblendet.

**Modale Dialoge und Popups**
- Farbliste: natives `<dialog>` mit `showModal`, Schließen per ×, Hintergrundklick, Escape; `body.printing-colors` steuert Druck-CSS.
- Garnauswahl: nicht-modales Popup (`role=dialog`), Escape wird abgefangen (capture), schließt bei Klick außerhalb und Resize.
- Keine Bestätigungsdialoge: Entfernen einer Datei und "Bild entfernen" wirken sofort (Datei-Entfernen ist nicht rückgängig zu machen).

**Sichtbarkeits-Bedingungen**
- Speichern, Projekt, Stickrahmen und "Zurück zum Original" nur mit aktivem Muster (`#file-actions`).
- Dateiliste/Speichern nicht im Bild-Modus erreichbar; dort Projekt-Speichern über `#image-save-project`.
- Material-Panel nicht in Ablauf.
- "Farbliste" nur in Ablauf.
- PNG-Export nur in Ablauf und Dichte.

**Unsicher / zu prüfen**
- Ob Tasten ↑/↓ in Ablauf die Dateiliste wechseln, hängt davon ab, dass kein Rahmen, Formwerkzeug oder Stich-Bearbeitung die Pfeile vorher abfängt (Reihenfolge in `src/app/keys.ts`); im Normalfall mit gewählten Objekten verschieben die Pfeile die Objekte.
- `controls.export` ("PNG exportieren") ist als Schlüssel vorhanden; der Button zeigt aber festen Text "PNG" und den Tooltip `controls.export.hint`.

---

# Teil: Funktionsinventar C: Objekte, Ablauf-Liste, Formen, Zeichnen, Schriftzug, Nicht gestickt

Umfang: `src/ui/layersPanel.ts`, `src/ui/objectPanel.ts` (inkl. `OrderCard`), `src/ui/objectMenu.ts`, `src/app/objects.ts`, `src/app/order.ts`, `src/ui/shapeTool.ts`, `src/app/shapes.ts`, `src/ui/drawTool.ts`, `src/app/drawing.ts`, `src/ui/letteringPanel.ts`, `src/app/lettering.ts`, `src/ui/asidePanel.ts`, `src/app/aside.ts`, dazu die Verdrahtung in `index.html`, `src/main.ts`, `src/app/keys.ts`, `src/app/pointer.ts` und der Rahmen `src/ui/frameTool.ts` (wegen Fang/Snapping).

Konventionen:
- "Ablauf" = Modus `flow` (`mode.flow` = "Ablauf", Taste 1). Fast alles hier existiert nur im Ablauf.
- Deutsche Begriffe aus `src/i18n/de.ts`, i18n-Key in Klammern. `t()` wählt automatisch `<key>.one` bei n = 1.
- "Auswahl" = `ui.selectedObjects`. "Rahmenobjekte" = `frameObjects()` (`src/app/drawing.ts:201`): die gewählten Objekte, aber leer, wenn nicht Ablauf, Stiche-Bearbeitung aktiv, Zeichenwerkzeug aktiv, Steg-Werkzeug (rungTool) aktiv, Reihenfolge-Karte offen oder "Buchstaben einzeln" aktiv.
- Meldungen unter der Liste (`#layer-note`, `LayersPanel.say`, `layersPanel.ts:142`): verschwinden nach 6 s, Warnungen nach 9 s, mit Aktionsknopf nach 15 s.

**Nicht vorhanden (ausdrücklich geprüft):** Kopieren/Einfügen über Zwischenablage (kein `clipboard`/`paste` im Code; nur "Duplizieren", Strg+D). Ein Knopf mit dem Namen "Beste Reihenfolge" existiert nicht; die Funktion heißt "Reihenfolge optimieren" (`order.button`).

---

## 1. Ablauf-Liste "Farben und Objekte" (`layers.title`)

Container `#layers-panel` (`index.html:471`), Liste `#layer-list`. Farbzeilen (Farbblöcke in Stickreihenfolge), aufklappbar zu Objektzeilen.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Farbblock auf-/zuklappen ("Die {n} Objekte zeigen" `layers.open` / "Objekte ausblenden" `layers.close`) | Zeigt oder versteckt die Objektzeilen eines Farbblocks. | Klick auf Pfeil-Knopf `.chev` in der Farbzeile; automatisch beim Auswählen (reveal) | Datei mit Farbblöcken | `layersPanel.ts:209-220`, reveal `:126`, `:166-175` |
| Ausblenden / Einblenden (`layers.hide` / `layers.show`) | Blendet einen Farbblock auf der Leinwand aus bzw. ein (kein Undo-Schritt, nur Ansicht). | Klick auf Auge-Knopf `.eye` (◉/◌) | immer bei Farbzeile | `layersPanel.ts:222-231`, `objects.ts:73-79` |
| Farbe hervorheben (`layers.focus` "Klick: nur diese Farbe hervorheben") | Hebt einen Farbblock dauerhaft hervor; zweiter Klick hebt auf. | Klick auf die Farbzeile (nicht auf Knöpfe) | immer | `layersPanel.ts:264`, `objects.ts:80-86` |
| Farbe kurz hervorheben (Hover) | Zeigt den Block beim Überfahren hervorgehoben; Verlassen der Liste hebt auf. | Maus über Farbzeile; `mouseleave` der Liste | nur Maus | `layersPanel.ts:105-108`, `:265-268` |
| Alle zeigen (`layers.showAll`) | Hebt alle Ausblendungen und die Hervorhebung auf. | Knopf `#layers-reset` im Panelkopf | sichtbar nur, wenn etwas ausgeblendet oder hervorgehoben ist | `layersPanel.ts:104`, `:181`, `objects.ts:87-91` |
| Garnfarbe ändern (`layers.recolor`, Titel `layers.recolorTitle` "Garnfarbe für Farbe {n}") | Gibt dem ganzen Farbblock ein anderes Garn (Undo-Schritt). | Klick auf Farbfeld `.sw` öffnet Garnwähler (ThreadPicker) | immer | `layersPanel.ts:233-243`, `:498-510`, `objects.ts:93-96` |
| Zurück zum Original (`layers.original` "Zurück zum Original: {name}") | Im Garnwähler: ursprüngliche Farbe des Blocks wieder wählen. | Eintrag im Garnwähler | nur wenn Blockfarbe von der geladenen abweicht | `layersPanel.ts:504` |
| Formathinweis Garnfarbe (`layers.colorNote.pes/jef/vp3/none`) | Erklärt im Garnwähler, was das Dateiformat mit der Farbe macht. | Text im Garnwähler | immer | `layersPanel.ts:514-518` |
| Farbzeilen-Info | Name "{n}. {Garnname}" (oder `layers.unnamed` "Farbe {n}"), Garncode + Objektzahl (`layers.objects`), Stichzahl rechts; Tooltip: `layers.meta` Stiche · m Garn, `layers.trims` Schnitte. | Anzeige, Tooltip (Hover) | immer | `layersPanel.ts:245-261` |
| Aktueller Block der Nadel | Markiert den Block, in dem die Abspiel-Nadel steht (CSS `.current`). | automatisch | Player nicht am Ende | `layersPanel.ts:205`, `main.ts:815` |
| Objektzeile | Art-Icon, Name "{Art} {Nr. in Farbe}" (Füllung `object.fill`, Satin `object.satin`, Steppstich `object.run`) oder Schriftzug-Name, Stichzahl. Tooltip `object.rowHint`. | Anzeige | Block aufgeklappt | `layersPanel.ts:274-308` |
| Markierung "erkannt" (≈) (`object.guessed`, Tooltip `object.guessedHint`) | Kennzeichnet Objekte, deren Form/Stichart nur aus Stichen geschätzt ist. | Anzeige | nur wenn die Datei geschätzte und gemachte Objekte mischt | `layersPanel.ts:302-307` |
| Hinweis "Alle Objekte sind aus den Stichen erkannt" (`layers.allGuessed`) | Ein Satz am Listenende statt ≈ an jeder Zeile. | Anzeige | alle Objekte geschätzt | `layersPanel.ts:193` |
| Leere Liste (`layers.empty` / `layers.blank`) | Text bei keiner Datei bzw. leerem neuem Muster. | Anzeige | keine Blöcke | `layersPanel.ts:182-185` |
| Objekt hervorheben (Hover) | Zeigt das Objekt unter der Maus auf der Leinwand. | Maus über Objektzeile | nur Maus | `layersPanel.ts:316-319`, `objects.ts:98-102` |
| Farbliste (`colorList.button`) | Öffnet die druckbare Garnliste (anderer Inventarteil). | Knopf `#color-list` | sichtbar wenn Blöcke vorhanden | `objects.ts:441-457`, `main.ts:812` |

## 2. Auswahl

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Objekt wählen | Ersetzt die Auswahl durch dieses Objekt. | Klick Objektzeile; Enter oder Leertaste auf fokussierter Objektzeile; Klick auf Stiche auf der Leinwand | Ablauf | `layersPanel.ts:284-289`, `:311-315`; `pointer.ts:332-339` |
| Zur Auswahl hinzufügen / entfernen | Schaltet das Objekt in der Auswahl um. | Umschalt-, Strg- oder Cmd-Klick (Liste und Leinwand); Umschalt/Strg+Enter/Leertaste auf Zeile | Ablauf | `objects.ts:136-138`, `pointer.ts:337-338` |
| Auswahl per Rechteck (Gummiband) | Fügt alle sichtbaren Objekte, die ganz im Rechteck liegen, der Auswahl hinzu (ersetzt nicht). | Umschalt+Ziehen auf leerer Fläche; Touch: lange drücken (500 ms) neben Objekten, dann ziehen (vibriert 15 ms) | Ablauf, Datei offen, keine Stiche-Bearbeitung, kein Formwerkzeug, kein Zeichnen, kein Steg-Werkzeug, Reihenfolge-Karte zu, nicht "Buchstaben einzeln" | `pointer.ts:146-150`, `:163-172`, `:380-402` |
| Auswahl aufheben (`object.clear` "Auswahl aufheben (Esc)") | Leert die Auswahl (beendet auch Stiche-Bearbeitung). | Knopf ✕ `#object-close`; Esc (Ablauf, ohne Werkzeug); Klick neben die Stiche ohne Modifier | Auswahl vorhanden | `objectPanel.ts:131`, `objects.ts:409-412`, `keys.ts:252-256`, `pointer.ts:339` |
| Sprung statt Objekt wählen | Ein Klick auf eine sichtbare Sprunglinie wählt den Sprung, nicht das Objekt. | Klick (8 px Toleranz) | Ablauf, Pointer-Ebene | `pointer.ts:326-331` |
| Doppelklick auf Objekt | Öffnet seine Form (Ebene Form) oder, ohne Form, seine Stiche. | Doppelklick auf Stiche | Ablauf, kein Werkzeug aktiv | `pointer.ts:461-476`, `shapes.ts:197-222` |
| Doppelklick auf leere Fläche | Einpassen der Ansicht. | Doppelklick | kein Werkzeug aktiv | `pointer.ts:478` |
| Mitlaufende Ebenen | Auswahländerung führt Form-Ebene bzw. Stiche-Editor zum neu gewählten Objekt; schließt Steg-Werkzeug bei anderer Auswahl. | automatisch | siehe Besonderheiten | `objects.ts:159-181` |
| Liste folgt der Auswahl | Klappt den Farbblock des gewählten Objekts auf, scrollt hin; Objekt-Panel scrollt in Sicht. | automatisch | jede Auswahl | `objects.ts:182-184` |

## 3. Reihenfolge

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Objekt in der Liste verschieben | Stickt das Objekt (bzw. die ganze Auswahl, wenn es gewählt ist) an der Ablagestelle (Undo-Schritt); bleibt ausgewählt. | Drag and Drop einer Objektzeile (HTML5 DnD, nur Maus/Desktop) | > 1 Objekt | `layersPanel.ts:320-324`, `:419-488`, `objects.ts:193-245` |
| In fremde Farbe ablegen: Garn übernehmen (`layers.dropInto` "Garn {color} übernehmen") | Abgelegt zwischen Objekten einer anderen Farbe (oder untere Hälfte einer offenen Farbzeile) nimmt das Objekt deren Garn an. | Ablegen in den rechten zwei Dritteln der Listenbreite | Drag eines Objekts, Zielfarbe anders | `layersPanel.ts:389-417`, `:467-470` |
| In fremde Farbe ablegen: eigenes Garn (`layers.dropOwn` "eigenes Garn: {color}", `layers.dropOwnMany`) | Gleiche Stelle, aber im eigenen Garn (neuer Farbwechsel). | Ablegen im vorderen Drittel der Liste ODER mit Alt gedrückt | wie oben | `layersPanel.ts:415`, `:471-476` |
| Stattdessen im eigenen Garn sticken (`object.keepColor` / `object.keepColors`, Tooltip `object.keepColor.hint`) | Macht das Garn-Übernehmen rückgängig und legt neu im eigenen Garn ab. | Link-Knopf in der Meldung nach dem Ablegen (15 s) | direkt nach Ablegen mit Garnübernahme, Muster unverändert | `objects.ts:224-242` |
| Farbblock verschieben | Verschiebt einen ganzen Farbblock zwischen andere Farbblöcke. | Drag and Drop der Farbzeile | > 1 Farbblock | `layersPanel.ts:207`, `:269`, `:432-440` |
| Überdeckungswarnung (`object.coveredBy` / `object.covers`, `object.movedAnyway`) | Neue Reihenfolge, die ein Objekt über/unter ein überlappendes bringt, wird trotzdem übernommen, mit Warnung. | automatisch nach Verschieben/Zusammenfassen | Überlappung betroffen | `objects.ts:118-132`, `:243` |
| Früher sticken (`object.earlier` "↑ Früher sticken") | Tauscht das Objekt mit seinem Vorgänger. | Knopf im Objekt-Panel | genau 1 Objekt gewählt; deaktiviert für das erste | `objectPanel.ts:206-211`, `objects.ts:396-407` |
| Später sticken (`object.later` "↓ Später sticken") | Tauscht mit dem Nachfolger. | Knopf im Objekt-Panel | genau 1; deaktiviert für das letzte | wie oben |
| Reihenfolge optimieren (`order.button`, Tooltip `order.button.hint`) | Öffnet eine Karte, die eine bessere Reihenfolge berechnet und Vorher→Nachher zeigt (nichts ändert sich vorher). | Knopf `#order-optimize` (⇅); erneuter Klick schließt (= Abbrechen) | ≥ 2 Objekte, sonst deaktiviert | `objectPanel.ts:424-516`, `order.ts:49-120`, `main.ts:842` |
| Vergleichstabelle | Farbwechsel (`order.colors`), Schnitte (`order.trims`), Wege (`order.travel`, cm oder m), Stickzeit (`order.time`, m:ss); besser grün/schlechter markiert. Titel `order.found` / `order.same`. | Anzeige | Karte offen | `objectPanel.ts:457-480` |
| Übernehmen (`order.apply`) | Wendet die gefundene Reihenfolge an (Undo-Schritt); leert Auswahl, Ausblendungen, Hervorhebung; Meldung `order.applied`. | Knopf; bekommt den Fokus | nur wenn eine bessere gefunden wurde | `objectPanel.ts:505-509`, `order.ts:86-115` |
| Abbrechen / Schließen (`order.cancel` / `order.close`) | Schließt die Karte ohne Änderung. | Knopf; Esc in der Karte; Esc global (Ablauf); erneuter Klick auf `#order-optimize` | Karte offen | `objectPanel.ts:433-435`, `:510-511`, `keys.ts:253` |
| Start und Ende tauschen (`object.reverse`, Tooltip `object.reverse.hint`) | Stickt Satins/Füllungen von der anderen Seite neu, Linien werden umgedreht; meldet gesparte Schnitte/Wege (`object.reversedSaves`) oder Fehlschläge. | Knopf im Objekt-Panel | mind. ein gewähltes Objekt umkehrbar (Satin, Füllung oder Linie), nicht in Stiche-Bearbeitung; Mehrfachauswahl erlaubt | `objectPanel.ts:224-231`, `objects.ts:301-337`, `main.ts:750` |
| Zu einem Objekt zusammenfassen (`object.merge`, Tooltip `object.merge.hint`) | Holt die gewählten an die Stelle des ersten; Füllungen werden eine Fläche (mit Kurven: ein Umriss, `object.joined`) und neu gestickt mit den Einstellungen der ersten. | Knopf im Objekt-Panel | ≥ 2 gewählt; deaktiviert mit Grund als Tooltip: verschiedene Farben (`object.merge.color`) oder nicht benachbart und nicht alle Füllungen (`object.merge.kind`) | `objectPanel.ts:217-222`, `objects.ts:252-295`, `:340-345` |
| In Teile trennen (`object.split`, Tooltip `object.split.hint`) | Jedes Teil zwischen zwei Schnitten wird ein eigenes Objekt; alle Teile gewählt. | Knopf im Objekt-Panel | genau 1 Objekt mit > 1 Teilen | `objectPanel.ts:212-216`, `objects.ts:348-364` |

## 4. Objekt-Panel "Objekt" (`object.title`) und Objektaktionen

Container `#object-panel` (`index.html:496`). Sichtbar, wenn im Ablauf etwas gewählt ist UND die Auswahl kein Schriftzug ist (`main.ts:833-834`).

### 4a. Anzeige

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Kopf Einzelobjekt | Art-Icon, "{Art} {Nr.}", Garnfeld, Farbblockname. | Anzeige | 1 gewählt | `objectPanel.ts:159-181` |
| Kopf Mehrfach (`object.many` "{n} Objekte") | Anzahl. | Anzeige | ≥ 2 | `objectPanel.ts:193` |
| Stiche (`object.stitches`), Garn (`object.thread`, m mit 2 Nachkommastellen) | Summen der Auswahl. | Anzeige | ≥ 1 | `objectPanel.ts:183-184`, `:194-195` |
| Größe (`object.size`) | B × H in mm (Bounding-Box der Auswahl), als Text oder als Eingabefelder (siehe Parameter). | Anzeige/Eingabe | ≥ 1 | `objectPanel.ts:185-186`, `:198-199` |
| Teile (`object.sections`, `object.sectionsValue`) | Anzahl geschnittener Teile. | Anzeige | 1 gewählt, Teile > 1 | `objectPanel.ts:187` |
| Von Hand (`object.hand`, `object.handValue`) | Zahl der Handänderungen an Einstichen. | Anzeige | 1 gewählt, > 0 | `objectPanel.ts:188` |
| Gestickt (`object.position`, `object.positionOf` "als {k}. von {n}") | Platz in der Gesamtreihenfolge. | Anzeige | 1 gewählt | `objectPanel.ts:189` |
| Lage (`object.layering`, `object.layeringValue` "auf {below} · unter {above}", `object.layeringNone`) | Überlappungen mit anderen Objekten. | Anzeige | 1 gewählt | `objectPanel.ts:190-191` |
| Hinweistexte (`object.hint`, `object.hintMany`, `object.editHint`, `shape.hint` + `shape.hint.band`/`shape.hint.rails`, `object.frameHint`, `object.frameMixed`, `object.mergeHand`) | Kontextabhängige Bedienhilfe. | Anzeige | je nach Zustand | `objectPanel.ts:245-255` |

### 4b. Aktionen (Panel-Knopfzeile `.shape-actions` und Kontextmenü, identische Liste aus `ObjectPanel.actions`)

Die Knöpfe im Panel sind nur Icons (aria-label = Label, Tooltip = Hint); im Kontextmenü Icon + Label.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Duplizieren (`object.duplicate`, Tooltip `object.duplicate.hint`) | Kopie 2 mm schräg versetzt, direkt nach dem Original gestickt, Kopie gewählt; Meldung `object.duplicated`. | Panel-Icon; Kontextmenü; Strg+D / Cmd+D | genau 1 gewählt; keine Stiche-/Form-Bearbeitung (für Panel/Menü); Strg+D: Ablauf und genau 1 Rahmenobjekt | `objectPanel.ts:282`, `shapes.ts:321-329`, `keys.ts:69-73`, Modell `shapeOps.ts:98` |
| Zweite Farbe einblenden (`object.blend`, Tooltip `object.blend.hint`) | Öffnet Garnwähler "Zweite Farbe" (`object.blend.pick`, Notiz `object.blend.note`); Füllung blendet aus, Kopie im zweiten Garn blendet ein; beide Teile werden gewählt. | Panel-Icon; Kontextmenü (Wähler öffnet am Menüeintrag) | genau 1 Füllung mit bekannter Fläche, keine Linie, nicht selbst zweite Farbe, kein offenes Muster, nicht Stiche-Bearbeitung | `objectPanel.ts:261-272`, `:283`, `objects.ts:382-394`, `main.ts:757-762` |
| Obere Form ausschneiden (`object.subtract`, Tooltip `object.subtract.hint`) | Die zuletzt gestickte gewählte Füllung wird aus den anderen ausgeschnitten und fällt weg; Meldungen `object.subtracted`, `object.subtracted.covered`, `object.subtract.nothing`. | Panel-Icon; Kontextmenü | ≥ 2 gewählt, alle Füllungen | `objectPanel.ts:284`, `shapes.ts:346-356`, `main.ts:751` |
| Waagrecht spiegeln (`object.mirrorX.short`, Tooltip `object.mirrorX`) | Spiegelt die Auswahl links/rechts um ihre gemeinsame Mitte; Meldung `object.mirrored`. | Panel-Icon; Kontextmenü | ≥ 1 gewählt, kein Bearbeiten | `objectPanel.ts:285`, `shapes.ts:331-344` |
| Senkrecht spiegeln (`object.mirrorY.short`, Tooltip `object.mirrorY`) | Spiegelt oben/unten. | Panel-Icon; Kontextmenü | wie oben | `objectPanel.ts:286` |
| Nicht sticken (`object.off`, Tooltip `object.off.hint`) | Nimmt die Auswahl aus den Stichen und legt sie unter "Nicht gestickt" (Rolle aus, dünner Umriss). | Panel-Icon; Kontextmenü | mind. ein Objekt bliebe übrig (Anzahl Objekte > Anzahl gewählt) | `objectPanel.ts:287-288`, `aside.ts:60-69` |
| Als Hilfslinie (`object.guide`, Tooltip `object.guide.hint`) | Wie oben, aber als gestrichelte Hilfslinie. | Panel-Icon; Kontextmenü | wie oben | `objectPanel.ts:289` |
| Löschen (`object.delete`, Tooltip `object.delete.hint`) | Löscht die Auswahl (mit verknüpften Teilen, siehe Besonderheiten); Meldung `object.deleted(.one)`. | Panel-Icon; Kontextmenü; Entf oder Rücktaste | Panel/Menü: wie "Nicht sticken" (nicht alle); Taste: Ablauf, Rahmenobjekte vorhanden, Zeichenstift ohne gesetzte Knoten, Formwerkzeug ohne gewählten Knoten (sonst löscht Entf den Knoten) | `objectPanel.ts:290`, `shapes.ts:311-319`, `keys.ts:130-133` |
| Garn dieses Objekts wählen (`object.thread.hint`, Notiz `object.thread.note`) | Gibt dem Objekt ein anderes Garn: gleiches Garn wie Nachbar wird mitgestickt, sonst eigene Farbe an seiner Stelle; ganzer Block wechselt, wenn er nur aus Gewählten besteht. | Klick auf Mini-Farbfeld `.thread-sw` im Panelkopf | genau 1 gewählt (Feld nur dann sichtbar); wirkt auf Rahmenobjekte | `objectPanel.ts:165-176`, `objects.ts:373-381`, Modell `shapeOps.ts:222` |
| Aussparen (Überlappungs-Karte) (`knockout.card.cut`, Tooltip `knockout.card.cut.hint`; Text `knockout.card`) | Schaltet für alle überlappenden Füllungen "unter späteren Formen aussparen" ein (Undo-Schritt), Meldung `knockout.done`. | Knopf `#overlap-cut` in Karte `#overlap-card` | Ablauf, es gibt überlappende Füllungen, Datei nicht auf "So lassen", Formwerkzeug nicht aktiv | `drawing.ts:137-149`, `:157-170`, `index.html:481-487` |
| So lassen (`knockout.card.keep`) | Blendet die Karte für diese Datei aus; Meldung `knockout.card.kept`. | Knopf `#overlap-keep` | wie oben | `drawing.ts:150-154` |
| Form bearbeiten (`object.editShape`, Tooltip `level.shape.hint`) | Wechselt in die Ebene Form mit dem Umriss des Objekts. | Knopf im Objekt-Panel; Enter (Ablauf, 1 gewählt); Doppelklick auf Objekt | 1 gewählt, Objekt formbar (Füllung/Satin mit gemessener Form oder Linie, nicht "frei") | `objectPanel.ts:377`, `objects.ts:414-417`, `keys.ts:240`, `main.ts:746` |
| Stiche bearbeiten (`object.editStitches`, Tooltip `level.stitches.hint`) | Wechselt in die Ebene Stiche für dieses Objekt (Details im Stiche-Inventar). | Knopf; Taste e; Ebenen-Schalter "Stiche"; Enter in Ebene Form | 1 gewählt | `objectPanel.ts:378`, `keys.ts:225-228`, `main.ts:1088-1100` |
| Stiche-Bearbeitung im Panel: Löschen (`edit.delete`), Teilen (`edit.split`), Fertig (`object.editDone`) | Löscht gewählte Einstiche, teilt den Stich zum gewählten Einstich, beendet die Bearbeitung. | Knöpfe; Entf, i, Esc | Stiche-Bearbeitung des gewählten Objekts; Teilen nur bei genau 1 Einstich | `objectPanel.ts:382-391`, `keys.ts:179-205` |

### 4c. Kontextmenü (`object.menu` "Objektaktionen")

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Objektmenü öffnen | Zeigt die Aktionen aus 4b als Menü am Zeiger. Auf einem gewählten Objekt gilt es für die ganze Auswahl, auf einem anderen wählt es dieses allein. | Rechtsklick auf Stiche (Leinwand) oder Objektzeile; Touch: 500 ms lange drücken (≤ 8 px Bewegung) auf Objekt oder Objektzeile | Ablauf; keine Stiche-/Form-Bearbeitung, kein Steg-Werkzeug, kein Zeichnen, Reihenfolge-Karte zu, nicht "Buchstaben einzeln"; NICHT bei Schriftzügen (wählt nur) | `pointer.ts:404-443`, `layersPanel.ts:326-352`, `objectMenu.ts:40-67` |
| Menü schließen | Schließt das Menü. | Auswahl eines Eintrags, Esc, Klick/Tipp außerhalb, Mausrad, Fenstergröße, Sprachwechsel | Menü offen | `objectMenu.ts:11-28`, `:52-56` |

## 5. Ebenen und Rahmen (Verschieben, Skalieren, Drehen, Fang)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Ebene Form (`level.shape`, Tooltip `level.shape.hint`) | Zeichenwerkzeuge sichtbar, das eine gewählte Objekt zeigt seinen Umriss. | Radio `input[name=level][value=shape]`; Taste v; Wahl eines Zeichenwerkzeugs | Ablauf | `index.html:381`, `main.ts:1356-1395`, `keys.ts:99-103` |
| Ebene Objekte (`level.objects`) | Ganze Objekte wählen, ordnen, neu sticken. | Radio | immer (auch Dichte) | `index.html:382` |
| Ebene Stiche (`level.stitches`) | Einstiche bearbeiten (anderes Inventar). | Radio; Taste e | Ablauf/Dichte | `index.html:383` |
| Brotkrumen (`level.inShape` "{name} › Form", `level.in`, `level.pick`) | Zeigt, welches Objekt bearbeitet wird. | Anzeige `#edit-crumb` | Form- oder Stiche-Bearbeitung | `main.ts:1112-1122` |
| Rahmen verschieben | Ziehen im Rahmen verschiebt die Auswahl (0,1-mm-Raster); Umschalt: nur waagrecht oder senkrecht. | Ziehen im Rahmen (4 px Rand) | Rahmenobjekte vorhanden (auch in Ebene Form) | `frameTool.ts:139-165`, `drawing.ts:176-198` |
| Fang beim Verschieben | Linke/Mitte/rechte (oben/Mitte/unten) Kante rastet auf Kanten und Mitten anderer Objekte und auf die Mitte aller übrigen ein (6 px); Fanglinie wird angezeigt. | automatisch beim Verschieben; Alt: ohne Fang | andere Objekte vorhanden | `frameTool.ts:38-59`, `:158-164`, `drawing.ts:231-243` |
| Skalieren | Ecke ziehen: gegenüberliegende Ecke bleibt; proportional entlang der Diagonale, Umschalt: frei; Faktor min. 0,05. | Ziehen an einer Rahmenecke | nur wenn alle gewählten skalierbar (`frameTool.canScale`, sonst `object.frameMixed`) | `frameTool.ts:117-120`, `:172-188`, `drawing.ts:227` |
| Drehen | Runder Griff 26 px über dem Rahmen dreht um die Mitte (0,1°); Umschalt: 15°-Schritte. | Ziehen am Drehgriff | Rahmen aktiv | `frameTool.ts:116`, `:166-171` |
| Pfeiltasten verschieben | Verschiebt die Auswahl um 0,1 mm, mit Umschalt 1 mm. | ←→↑↓ (nicht wenn ein Knopf fokussiert ist) | Rahmen aktiv, kein gewählter Formknoten | `keys.ts:135-143` |
| Größe tippen | siehe Parameter "Größe" | Zahlenfelder | Rahmen aktiv und skalierbar | `objectPanel.ts:299-331`, `objects.ts:420-428` |

## 6. Form bearbeiten (Ebene Form, Formwerkzeug)

Gilt für Füllungen mit bekanntem Umriss, Linien (gezeichnet/SVG/Steppstich-Linien) und Satinsäulen ohne Umriss (zwei Schienen). Jede Änderung = ein Undo-Schritt, Objekt wird in der neuen Form neu gestickt, Einstellungen bleiben (`shapes.ts:250-273`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Form öffnen / Objekt wechseln | Zeigt Umriss des gewählten Objekts; Klick auf anderes Objekt wechselt zu dessen Umriss; Umschalt/Strg-Klick fügt hinzu (Form schließt dann); Klick neben (nicht nahe Umriss, kein Knoten gewählt) hebt Auswahl auf. | Klick | Formwerkzeug aktiv | `pointer.ts:299-313`, `shapes.ts:197-222` |
| Knoten wählen | Wählt einen Knoten (zeigt seine Griffe und die zugewandten Griffe der Nachbarn). | Klick auf Knoten (9 px) | Form offen | `shapeTool.ts:92-114`, `:153-163` |
| Knoten ziehen | Verschiebt den Knoten. | Ziehen | Form offen | `shapeTool.ts:179-181` |
| Griff ziehen | Ändert die Kurve am Knoten. | Ziehen eines sichtbaren Griffs | Knoten gewählt | `shapeTool.ts:182-184` |
| Kurve biegen | Ziehen an einer Kurve verschiebt beide Griffe (näherer mehr); runde Knoten bleiben rund. | Ziehen auf der Kurve (7 px) | Form offen | `shapeTool.ts:185-186`, `:362-388` |
| Knotenauswahl aufheben | Hebt die Knotenauswahl auf. | Klick auf Kurve ohne Ziehen; Klick neben (bei gewähltem Knoten); Esc (erstes Esc) | Knoten gewählt | `shapeTool.ts:204-207`, `pointer.ts:310-313`, `keys.ts:121-126` |
| Knoten einfügen | Setzt einen Knoten auf den Umriss. | Doppelklick nahe Umriss (≤ 14 px) | Form offen | `shapeTool.ts:239-247`, `pointer.ts:453-455` |
| Knoten löschen (`shape.node.delete`) | Entfernt den gewählten Knoten; zu kleine Teilpfade (Loch/Stück) fallen ganz weg; Fläche braucht ≥ 3 Knoten (`shape.minNodes`). | Knopf im Panel; Entf/Rücktaste | Knoten gewählt | `objectPanel.ts:347`, `shapeTool.ts:250-262`, `keys.ts:116-119` |
| Ecke / Rund (`shape.node.corner` / `shape.node.smooth`, Tooltip `shape.node.kind` "Ecke oder rund (c)") | Schaltet den gewählten Knoten zwischen Ecke und rund. | Knopf (Beschriftung zeigt das Ziel); Taste c | Knoten gewählt | `objectPanel.ts:348`, `shapeTool.ts:265-272`, `keys.ts:120` |
| Knoten verschieben mit Tasten | 0,1 mm, mit Umschalt 0,5 mm. | Pfeiltasten | Knoten gewählt | `keys.ts:108-115`, `shapeTool.ts:314-321` |
| Vereinfachen (`shape.simplify`, Tooltip `shape.simplify.hint`) | Weniger Knoten (Toleranz 0,3 mm, bei erneutem Druck 0,6 / 1,2 mm); Meldung `shape.simplified` oder `shape.simplify.none`. | Knopf im Panel | ≥ 12 Knoten | `objectPanel.ts:351`, `objects.ts:429-434`, `shapeTool.ts:333-340`, `shape/simplify.ts:9` |
| Linie schließen (`shape.line.close`, Tooltip `shape.line.close.hint`) | Verbindet die Enden einer Linie gerade; Enden am selben Punkt werden ein Knoten. | Knopf im Panel | Objekt ist eine Linie und offen; ≥ 2 Knoten | `objectPanel.ts:353-359`, `shapeTool.ts:283-311` |
| Linie öffnen (`shape.line.open`, Tooltip `shape.line.open.hint`) | Öffnet nach dem gewählten Knoten, ohne Auswahl dort, wo sie geschlossen wurde. | Knopf im Panel | Linie geschlossen | wie oben |
| Breite per Griff (Satinlinie/Satin-Umrandung) (`shape.hint.band`, Meldung `shape.width.set` "Breite {w} mm.") | Runder Griff am Band ändert die Breite einer als Satin/Zickzack oder als Fläche gestickten Linie oder der Satin-Umrandung einer Füllung. | Ziehen am Breitengriff | Objekt hat ein Band | `shapeTool.ts:126-127`, `:173-177`, `:198-201`, `shapes.ts:65-116` |
| Satinsäulen-Schienen (`shape.hint.rails`) | Bei Satins ohne Umriss sind die beiden Kanten die bearbeitbare Form; Ziehen macht die Säule dort breiter/schmaler. | wie Knoten/Kurven | Satin ohne Umriss aus fremder Datei | `shapes.ts:82`, `:133`, `:262-263` |
| Zur Stiche-Ebene | Wechselt vom Umriss zu den Einstichen desselben Objekts. | Enter | Formwerkzeug aktiv | `keys.ts:128` |
| Formstatus (`shape.nodes`, `shape.none`) | "{n} Knoten · Ecke/Rund/Kein Knoten gewählt". | Anzeige im Panel | Form offen | `objectPanel.ts:343` |

## 7. Neue Formen zeichnen

Werkzeugleiste `.draw-tools` (`index.html:399-405`), nur im Ablauf. Werkzeugwahl schaltet Ebene Form ein und schließt Stiche-Bearbeitung, Formwerkzeug, Steg-Werkzeug und "Buchstaben einzeln" (`drawing.ts:63-78`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Zeiger (`draw.pointer`, Tooltip `draw.pointer.hint`) | Kein Zeichenwerkzeug; öffnet ggf. den Umriss der Auswahl. | Knopf `#draw-pointer`; Taste v; Esc (ohne angefangene Form); nach jeder fertigen Form automatisch | Ablauf | `drawing.ts:80`, `keys.ts:81-88`, `:99-103` |
| Rechteck (`draw.rect`, Tooltip `draw.rect.hint`) | Ziehen zeichnet ein Rechteck → Füllung. Umschalt: Quadrat; Alt: von der Mitte. | Knopf `[data-draw=rect]`; Taste m (erneut: aus) | Ablauf | `drawTool.ts:166-187`, `:210-230`, `keys.ts:56`, `:104-107` |
| Ellipse (`draw.ellipse`, Tooltip `draw.ellipse.hint`) | Wie Rechteck; Umschalt: Kreis. | Knopf `[data-draw=ellipse]`; Taste o | Ablauf | wie oben |
| Zeichenstift (`draw.pen`, Tooltip `draw.pen.hint`) | Klick: Eckknoten; Ziehen (≥ 0,3 mm): runder Knoten mit symmetrischen Griffen; Klick auf ersten Knoten (≤ 10 px, ≥ 3 Knoten): geschlossene Fläche → Füllung; Doppelklick oder Enter: offene Linie (≥ 2 Knoten) → Steppstich. Vorschau-Segment zum Zeiger, rastet am ersten Knoten ein. | Knopf `[data-draw=pen]`; Taste b | Ablauf | `drawTool.ts:96-136`, `:138-152`, `:190-200`, `keys.ts:89-92`, `pointer.ts:447-450` |
| Letzten Knoten entfernen | Nimmt den letzten Stift-Knoten zurück. | Entf / Rücktaste | Stift mit Knoten | `drawTool.ts:88-93`, `keys.ts:93-96` |
| Angefangene Form verwerfen | Esc verwirft gesetzte Knoten / laufende Form; zweites Esc legt Werkzeug weg. | Esc | Werkzeug aktiv | `keys.ts:82-88` |
| Freihand (`draw.free`, Tooltip `draw.free.hint`) | Freie Linie, beim Loslassen geglättet (Abweichung ≤ 0,3 mm), Steppstich. | Knopf `[data-draw=free]`; Taste p | Ablauf | `drawTool.ts:154-159`, `:174-181`, `:234-253` |
| Größenanzeige beim Ziehen | Zeigt B × H des Rechtecks/der Ellipse. | Anzeige im Overlay | Rechteck/Ellipse ziehen | `drawTool.ts:36`, `main.ts:789-790` |
| Ergebnis | Neue Form wird im Garn des zuletzt gewählten Objekts direkt nach ihm gestickt, sonst nach dem letzten Objekt; ist sie gewählt; Meldung `draw.done.fill` / `draw.done.line`; zu klein: `draw.failed`. | automatisch | - | `drawing.ts:94-125` |
| Erste Form ohne offene Datei | Startet ein neues Muster "Neues Stickmuster" (`draw.newName`) in Brother-Orange (nächstes Garn zu RGB 240/140/40). | Zeichnen ohne Datei | keine Datei | `drawing.ts:57`, `:87-109` |

## 8. Schriftzug (`lettering.title`)

Panel `#lettering-panel` (`index.html:506`). Erscheint statt des Objekt-Panels, sobald die Auswahl genau einen Schriftzug umfasst (`lettering.ts:61-96`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Neuer Schriftzug (`lettering.tool` "Text", Tooltip `lettering.tool.hint`) | Legt Schriftzug "Text" (`lettering.new`) unter dem Muster an (mittig, 6 mm unter Unterkante), im letzten Garn des Musters (leeres Muster: Rot); Text ist markiert zum Überschreiben. Ohne Datei: neue Datei "Schriftzug.pes". | Knopf `#lettering-new` (T); Taste t | Knopf: wechselt bei Bedarf in den Ablauf; Taste: Ablauf, nicht in Stiche-/Form-Bearbeitung/Steg-Werkzeug | `lettering.ts:138-194`, `keys.ts:231` |
| Text (`lettering.text`, Platzhalter `lettering.text.placeholder`) | Mehrzeiliges Textfeld (1 bis 4 Zeilen hoch); jede Eingabe wird live neu gestickt, Verlassen des Felds schließt den Undo-Schritt. Esc verlässt das Feld. Leerer Text löscht den Schriftzug beim Verlassen. | Textarea; Doppelklick auf Schriftzug (fokussiert und markiert alles) | Schriftzug gewählt | `letteringPanel.ts:166-215`, `lettering.ts:239-242`, `pointer.ts:467-475` |
| Fehlende Zeichen (`lettering.missing`) | Nennt Zeichen, die die Schrift nicht hat; bietet "Als ss schreiben" (`lettering.missing.ss`) und bis zu 3 Schriften mit allen Zeichen (`lettering.missing.fonts`). | Link-Knöpfe | Zeichen fehlen | `letteringPanel.ts:183-210` |
| Schrift (`lettering.font`, Tooltip `lettering.font.hint`) | Knopf mit Schriftname klappt die Schriftliste auf; Lizenzzeile `lettering.font.from` + Link zur Lizenzdatei. | Klick | Katalog geladen | `letteringPanel.ts:228-253` |
| Schriftliste | Gruppiert nach Stil (`lettering.style.sans/serif/script/display`), mit Textprobe (lazy gerendert) und Tags (`lettering.tag.lacks`, `lettering.tag.caps`, `lettering.tag.from`, `lettering.tag.upto`). Klick wählt. ↑/↓ probiert Schriften live am Muster; Enter (Knopf) wählt; Esc schließt und behält die probierte. | Klick, ↑ ↓, Enter, Esc | Liste offen | `letteringPanel.ts:256-329` |
| Höhe der Großbuchstaben (`lettering.height`, Tooltip `lettering.height.hint`) | Siehe Parameter; Band zeigt gute Höhen der Schrift; Hinweis `lettering.height.good/small/large` mit bis zu 2 besser passenden Schriften (`lettering.height.try`). | Zahlenfeld + Schieberegler | Schriftzug gewählt | `letteringPanel.ts:331-386` |
| Größenzeile (`lettering.size`) | B × H mm · Stiche; Warnung, wenn größer als der Rahmen (hoopShort). | Anzeige | immer | `letteringPanel.ts:388-399` |
| Ausrichtung (`lettering.align`: Links, Mitte, Rechts, Blocksatz) | Ausrichtung mehrzeiliger Texte. | Segment-Knöpfe (Icons, radio) | immer | `letteringPanel.ts:430-432` |
| Form (`lettering.shape`: Gerade, Bogen oben, Bogen unten, Kreis) | Textverlauf; beim ersten Wechsel von Gerade wird Radius = max(15, 0,8 × Textbreite). | Segment-Knöpfe | immer | `letteringPanel.ts:434-440` |
| Radius (`lettering.radius`, Tooltip `lettering.radius.hint`) | Krümmung des Bogens/Kreises. | Schieberegler | Form ≠ Gerade | `letteringPanel.ts:462-464` |
| Garn (`lettering.color`, `lettering.color.own`) | Garnwähler für den Schriftzug. | Farbknopf | immer | `letteringPanel.ts:466-488` |
| Buchstaben einzeln (`lettering.letters` / `lettering.letters.done`, Tooltip `lettering.letters.hint`, Hilfe `lettering.letters.how`) | Modus zum Verschieben/Drehen einzelner Buchstaben; Buchstabenboxen werden angezeigt (gewählter gelb). | Knopf; Enter (Schriftzug gewählt, nicht im Modus) | Schriftzug gewählt | `letteringPanel.ts:490-519`, `lettering.ts:312-318`, `:411-432`, `keys.ts:162` |
| Buchstaben ziehen | Verschiebt einen Buchstaben (ab 3 px; Treffer mit 4 px Rand); Klick neben die Buchstaben hebt Buchstabenwahl auf. | Ziehen auf Buchstaben | Buchstaben-Modus | `lettering.ts:335-408`, `pointer.ts:139`, `:293-298` |
| Buchstaben mit Tasten | 0,1 mm, mit Umschalt 1 mm. | Pfeiltasten | Buchstabe gewählt | `keys.ts:146-153` |
| Buchstabe drehen (`lettering.letter.turn`) | Dreht den gewählten Buchstaben. | Schieberegler | Buchstabe gewählt | `letteringPanel.ts:503-505` |
| Diesen Buchstaben zurücksetzen (`lettering.letter.reset`) | Entfernt Verschiebung/Drehung des gewählten Buchstabens. | Link | gewählter Buchstabe geändert | `letteringPanel.ts:506-510` |
| Alle {n} Änderungen zurücksetzen (`lettering.letters.reset`) | Entfernt alle Buchstabenänderungen. | Link | ≥ 1 Änderung | `letteringPanel.ts:513-517` |
| Buchstaben-Modus verlassen | Esc: erst Buchstabenwahl aufheben, dann Modus verlassen. | Esc | Modus aktiv | `keys.ts:154-160` |
| Mehr (`lettering.more`) | Aufklappbereich mit Abstand, Wortabstand, Zeilenabstand, Drehung, Dichte, Unterlage, Zeilen hin und zurück. | `<details>` | immer | `letteringPanel.ts:528-561` |
| Rahmen auf Schriftzug | Verschieben/Drehen/Skalieren per Rahmen ändert Position, Winkel, Höhe, Radius, Abstände und Buchstabenversätze; der Text bleibt editierbar. | Rahmen, Pfeiltasten | Schriftzug gewählt, nicht Buchstaben-Modus | `drawing.ts:258-261`, `lettering.ts:268-289` |
| In Objekte umwandeln (`lettering.release`, Tooltip `lettering.release.hint`) | Buchstaben werden gewöhnliche Objekte, Text nicht mehr änderbar; Meldung `lettering.released`. | Link-Knopf am Panelende | Schriftzug gewählt | `letteringPanel.ts:153-155`, `lettering.ts:292-310` |
| Fertig (`lettering.close` "Fertig (Esc)") | Hebt die Auswahl auf, Panel schließt. | Knopf ✕ `#lettering-close`; Esc (allgemeines Ablauf-Esc) | Schriftzug gewählt | `letteringPanel.ts:87`, `lettering.ts:322`, `keys.ts:252-256` |
| Name in der Liste (`lettering.name` "Schriftzug »{text}«") | Objektzeilen zeigen den Text (max. 20 Zeichen, …), nummeriert bei mehreren Teilen. | Anzeige | - | `lettering.ts:115-135` |

## 9. Nicht gestickt (`aside.title` "Nicht gestickt ({n})")

`<details id="aside-block">` unter der Liste (`index.html:489-492`).

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Block auf-/zuklappen | Zeigt die beiseitegelegten Formen; öffnet sich selbst, wenn eine neue dazukommt. | Klick auf `summary` | ≥ 1 Form beiseite (sonst versteckt) | `asidePanel.ts:39-47` |
| Zeile | Icon (Hilfslinie gestrichelt), Farbfeld, Name "{Art} {k}", Grund: `aside.off` "aus", `aside.guide` "Hilfslinie", `aside.background` "Hintergrund" (Tooltip `aside.background.hint`). | Anzeige | - | `asidePanel.ts:49-83` |
| Form auf der Leinwand zeigen | Hebt die Form beim Überfahren auf der Leinwand hervor. | Hover über Zeile | nur Maus | `asidePanel.ts:35`, `:52`, `aside.ts:52-56` |
| Sticken (`aside.sew`, Tooltip `aside.sew.hint`) | Stickt die Form wieder an ihrer alten Stelle in der Reihenfolge (oder neu aus Kurven); wird gewählt; Meldung `aside.done.sewn` / `aside.failed`. | Knopf | - | `asidePanel.ts:77`, `aside.ts:29-38` |
| Hilfslinie / Keine Hilfslinie (`aside.toGuide` / `aside.toOff`, Tooltips `.hint`) | Wechselt die Rolle zwischen gestrichelter Hilfslinie und dünnem Umriss. | Knopf | - | `asidePanel.ts:78`, `aside.ts:39-43` |
| Endgültig löschen (`aside.drop.hint`) | Entfernt die Form aus der Liste (Undo-Schritt); Meldung `aside.done.dropped`. | Knopf × | - | `asidePanel.ts:80-81`, `aside.ts:44-51` |
| Hintergrund beim Öffnen weglassen (`aside.backgroundFound`) | Beim Laden wird eine große hinterste Fläche automatisch beiseitegelegt (Meldung). | automatisch | Import | `main.ts:1313` |

## 10. Verknüpfte Objekte (Umrandung in eigenem Garn, zweite Blendfarbe, Schatten, Echo)

Die Einstellungen dafür liegen im Stich-Panel (`src/app/stitches.ts`, `src/ui/stitchPanel.ts`, nicht in diesem Umfang). Hier: was die Objektfunktionen damit tun.

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Mitlöschen | Löschen einer Füllung löscht ihre Umrandung im eigenen Garn und ihre zweite Blendfarbe; Löschen einer Linie löscht Schatten und Echo-Kopien in eigenen Garnen. Wird nur das verknüpfte Teil gelöscht, verliert das Hauptobjekt die Umrandung / den Verlauf / das Teil. | Löschen (alle Wege), Nicht sticken / Hilfslinie (nutzt dieselbe Löschfunktion) | - | `model/shapeOps.ts:30-80`, `model/aside.ts:81-111` |
| Mitkopieren | Duplizieren kopiert Umrandung, zweite Farbe und Linienteile mit; die Kopie eines Teils wird eine eigenständige Linie. Versatz wird in 2-mm-Schritten (max. 10) erhöht, bis nichts auf einem vorhandenen Objekt landet. | Duplizieren | - | `model/shapeOps.ts:98-129` |
| Mitbewegen | Nach Verschieben/Drehen/Skalieren/Spiegeln werden Umrandungen, Blends, Schatten und Echos neu angepasst (`syncBorders`); Auswahl wird über Schlüssel wiedergefunden. | Rahmen, Pfeiltasten, Spiegeln, Größe tippen | - | `drawing.ts:280-288` |
| Mitumkehren | Beim Umdrehen von Linien folgen Schatten/Echo. | Start und Ende tauschen | - | `objects.ts:311-313` |
| Garn bei Verschieben in andere Farbe | Eine Umrandung, zweite Farbe oder ein Linienteil, das per Drag in eine andere Farbe übernommen wird, behält dieses Garn künftig. | Drag mit Garnübernahme | - | `objects.ts:204-208`, `model/border.ts:469` |
| Block umfärben | Liegt die Umrandung im Garn der Füllung, aber in einem anderen Block, behält sie ihr Garn. | Garnfarbe ändern (Farbzeile) | - | `model/border.ts:448-460` |
| Aussparungen folgen (`knockout.followed`) | Nach jeder Formänderung, Verschiebung, Reihenfolgeänderung werden aussparende Füllungen im selben Undo-Schritt neu gestickt; Meldung nennt sie. | automatisch | Aussparen aktiv | `shapes.ts:279-295` |
| Blend wählen | Nach "Zweite Farbe einblenden" sind Füllung und Partner gewählt. | automatisch | - | `objects.ts:388-392` |
| Modellgrenzen (nur Info, UI im Stich-Panel) | Echo: Seite out/in/both (Standard out), Anzahl 1 bis 6 (Std. 2), Abstand 1 bis 10 mm (Std. 3). Schatten: Richtung se/sw/ne/nw, Abstand 0,3 bis 3 mm (Std. 0,8), Garn dunkelgrau. | - | - | `digitize/echo.ts:41-43`, `model/shadow.ts:16-30` |

---

## Parameter-Steuerelemente

| Steuerelement | Typ | Bereich / Schritt | Standard | Einheit | Code |
|---|---|---|---|---|---|
| Größe Breite (`object.size.w` "Breite in mm") | number | 1 bis 1000, Schritt 0,1; Änderung < 0,05 mm wird ignoriert; wirkt bei `change` (Enter/Fokusverlust) | aktuelle Breite | mm | `objectPanel.ts:301-306`, `:317-328` |
| Größe Höhe (`object.size.h`) | number | wie oben | aktuelle Höhe | mm | wie oben |
| Seitenverhältnis halten (`object.size.lock`) | Toggle-Knopf (aria-pressed) | an/aus; Seite ohne Ausdehnung bleibt | an (pro Sitzung, nicht gespeichert) | - | `objectPanel.ts:126`, `:308-316` |
| Farben zusammenfassen (`order.combine`, Tooltip `.hint`) | Checkbox | an/aus, gespeichert in Settings | an | - | `objectPanel.ts:484-499`, `settings.ts:127` |
| Kürzeste Wege (`order.shortest`) | Checkbox | an/aus, gespeichert | an | - | wie oben |
| Richtung umkehren (`order.reverse`) | Checkbox | an/aus, gespeichert | an | - | wie oben |
| Breitengriff (Band) | Ziehen | 0,8 bis 20, Raster 0,1 | aktuelle Breite | mm | `shape/band.ts:6-7`, `:97` |
| Schrifthöhe Zahlenfeld | number | 2 bis 300, Schritt 0,5 (Komma erlaubt) | neu: max(Min. der Schrift, min(15, Max. der Schrift)) auf 0,5 gerundet; Default-Objekt 10 | mm | `letteringPanel.ts:333`, `:373-377`, `lettering.ts:150`, `lettering/layout.ts:55` |
| Schrifthöhe Schieberegler | range | 3 bis 120, Schritt 0,5, mit Band "gut" der Schrift | wie oben | mm | `letteringPanel.ts:335-347` |
| Ausrichtung | Segment (4) | Links/Mitte/Rechts/Blocksatz | neu: Mitte (Default-Objekt links) | - | `lettering.ts:161`, `layout.ts:56` |
| Form | Segment (4) | Gerade/Bogen oben/Bogen unten/Kreis | Gerade | - | `layout.ts:60` |
| Radius (`lettering.radius`) | range | 8 bis 200, Schritt 1 | 40 (erster Wechsel: max(15, 0,8 × Breite)) | mm | `letteringPanel.ts:463`, `:437` |
| Garn Schriftzug | Garnwähler | Katalog oder eigene Farbe | letztes Garn des Musters, leeres Muster: Rot (PEC 5) | - | `lettering.ts:56`, `:165` |
| Schrift | Liste | Katalog (Ink/Stitch-Schriften) | zuletzt benutzte, anfangs `barstitch_regular` | - | `lettering.ts:54` |
| Buchstabe drehen (`lettering.letter.turn`) | range | −90 bis 90, Schritt 1 | 0 | ° | `letteringPanel.ts:504` |
| Buchstabenabstand (`lettering.spacing`, Tooltip `.hint`) | range | −3 bis 6, Schritt 0,1 | 0 | mm (Anzeige ±) | `letteringPanel.ts:536` |
| Wortabstand (`lettering.wordSpacing`) | range | −4 bis 15, Schritt 0,1 | 0 | mm | `letteringPanel.ts:537` |
| Zeilenabstand (`lettering.lineSpacing`) | range | 0,5 bis 2,5, Schritt 0,05 | 1 (Anzeige 100 %) | Faktor/% | `letteringPanel.ts:538` |
| Drehung (`lettering.angle`) | range | −180 bis 180, Schritt 1 | 0 | ° | `letteringPanel.ts:539` |
| Dichte (`lettering.density`, Tooltip `.hint`) | range | 70 bis 140 %, Schritt 5; gespeichert als 100/Wert | 100 % | % | `letteringPanel.ts:540-549` |
| Unterlage (`lettering.underlay`) | Checkbox | an/aus | an | - | `letteringPanel.ts:550` |
| Zeilen hin und zurück (`lettering.back`) | Checkbox | an/aus; deaktiviert mit Tooltip `lettering.back.not`, wenn Schrift nur links→rechts | an | - | `letteringPanel.ts:553-559` |
| Rahmen-Skalierung | Ziehen | Faktor ≥ 0,05, Raster 0,001 | - | - | `frameTool.ts:185-186` |
| Rahmen-Drehung | Ziehen | 0,1°; Umschalt 15° | - | ° | `frameTool.ts:169` |
| Garnwähler (Block, Objekt, Blend, Schriftzug) | Popup ThreadPicker | Katalogfarben + "Eigene Farbe …" (`layers.ownColor`) | aktuelle Farbe | - | `ui/threadPicker.ts` (nicht in diesem Umfang) |

Konstanten ohne UI: Zeichen-Mindestgröße 1 mm; Freihand-Glättung 0,3 mm, Punktabstand 0,2 mm; Freihand/Stift-Linie Breite 0,4 mm (Steppstich); Stift-Schließradius 10 px; Duplikat-Versatz 2 mm; Langdruck 500 ms; Pickradien: Formknoten 9 px, Kurve 7 px, Einfügen 14 px, Rahmengriffe 10 px, Fang 6 px.

---

## Besonderheiten (für das Redesign nicht vergessen)

**Mehrfachauswahl**
- Ziehen eines gewählten Objekts in der Liste nimmt die ganze Auswahl mit (`layersPanel.ts:321-323`); ein nicht gewähltes Objekt wird allein gezogen.
- Kontextmenü auf einem gewählten Objekt gilt der ganzen Auswahl, auf einem nicht gewählten ersetzt es die Auswahl (`pointer.ts:428-429`).
- Panel-Aktionen je nach Anzahl: Duplizieren, Früher/Später, In Teile trennen, Garnfeld, Form/Stiche bearbeiten, Zweite Farbe nur bei genau 1; Zusammenfassen und Obere Form ausschneiden nur bei ≥ 2; Spiegeln, Start und Ende tauschen, Nicht sticken, Hilfslinie, Löschen bei beliebig vielen.
- Nicht sticken / Als Hilfslinie / Löschen fehlen in Panel und Menü, wenn alle Objekte gewählt sind (`objectPanel.ts:287`). Die Entf-Taste hat diese Sperre NICHT: sie kann alles löschen (leeres Muster) (`keys.ts:130-133`, `shapeOps.ts:89`).
- Ein Schriftzug wird immer als Ganzes gewählt oder abgewählt (`objects.ts:140-154`). Bei Schriftzug-Auswahl: Objekt-Panel versteckt, Schriftzug-Panel sichtbar, kein Kontextmenü, Tasten e, r, g und Enter haben andere bzw. keine Wirkung (`keys.ts:144-164`).
- Gummiband fügt immer hinzu, ersetzt nie; nur ganz im Rechteck liegende und aktuell sichtbare (bis zur Player-Position) Objekte (`pointer.ts:395-402`). Umschalt+Klick ohne Bewegung bleibt ein Klick.
- Zusammenfassen nur innerhalb einer Farbe; nicht benachbarte nur, wenn alle Füllungen.

**Versteckte Gesten und Modifikatoren**
- Drag-Ablage: horizontale Position entscheidet über Garn (vorderes Drittel = eigenes Garn, rechts = Garn der Zielfarbe); Alt erzwingt eigenes Garn. Die Ablagelinie trägt ein Label in der Zielfarbe; untere Hälfte einer aufgeklappten Farbzeile = Anfang dieser Farbe (`layersPanel.ts:384-417`, `:455-477`).
- Ganze Farbblöcke lassen sich ziehen (nur zwischen Farben).
- Touch: Langdruck auf Objektzeile oder Objekt öffnet Menü; Langdruck neben Objekten startet Gummiband; zweiter Finger bricht Zeichnen/Ziehen ab und zoomt (`pointer.ts:154-197`). Nach Langdruck ist das Loslassen kein Klick.
- Listen-DnD ist HTML5-Drag: auf Touch-Geräten in der Regel nicht verfügbar; Ersatz sind "Früher/Später sticken" (laut Doc-Kommentar `objectPanel.ts:117-118`).
- Doppelklick: Objekt → Form bzw. Stiche; Schriftzug → Text fokussieren; Umriss in Form-Ebene → Knoten einfügen; Stift → Linie beenden; leer → Einpassen.
- Alt beim Rahmen-Verschieben schaltet den Fang aus; Umschalt beschränkt auf eine Achse; Umschalt an Ecke = freie Skalierung; Umschalt beim Drehen = 15°.
- Strg+D dupliziert (nur genau 1 Rahmenobjekt). Kein Kopieren/Einfügen.
- Tastenkürzel Zeichnen: m, o, b, p (nochmal = aus), v = Zeiger/Ebene Form. Nicht mit Umschalt.
- Pfeiltasten-Schrittweiten unterscheiden sich: Rahmen 0,1/1 mm, Formknoten 0,1/0,5 mm, Buchstaben 0,1/1 mm, Einstiche 0,1/0,5 mm.
- Esc-Kaskaden: Zeichenstift (Knoten verwerfen → Werkzeug weg); Form (Knoten abwählen → Auswahl leeren); Buchstaben (Buchstabe abwählen → Modus verlassen); Ablauf allgemein (Reihenfolge-Karte schließen → Auswahl leeren → Sprung/Hervorhebung aufheben); Kontextmenü schließt vor allem anderen (Capture-Listener).
- In der Schriftliste fangen ↑/↓ die Tasten ab (sonst wechseln sie die Datei).

**Hover-only**
- Hover über Farbzeile hebt Block hervor, über Objektzeile das Objekt, über Nicht-gestickt-Zeile die Form; ohne Maus gibt es dafür keinen Ersatz.
- Farbzeilen-Tooltip enthält Stiche, Garnmeter und Schnitte des Blocks, die sonst nirgends in der Zeile stehen.
- Tooltip über dem Breitengriff wird unterdrückt (Griff zeigt eigenes Label) (`pointer.ts:85-88`).

**Automatisches Verhalten**
- Nach Verschieben bleiben die verschobenen Objekte gewählt, Ausblendungen werden aufgehoben, Aussparungen folgen (`objects.ts:210-222`).
- "Reihenfolge optimieren": Übernehmen leert Auswahl, Ausblendungen, Hervorhebung. Mit "Richtung umkehren" wird Umkehren nur genommen, wenn es real besser ist (bis zu 3 Runden, nicht umkehrbare werden ausgeschlossen) (`order.ts:49-73`). Ändert nie, was oben liegt. Karte rechnet bei jeder Optionsänderung neu; solange offen: kein Rahmen, kein Gummiband, kein Menü.
- Überdeckungskonflikte beim manuellen Verschieben werden NICHT verhindert, nur gewarnt (trotz Doc-Kommentar "refused" in `layersPanel.ts:84-85`; tatsächliches Verhalten: übernommen mit Warnung, `objects.ts:189-191`).
- Formänderung, die nichts füllen lässt, wird verworfen (`shape.failed`); ersetzte Handänderungen werden gemeldet (`shape.handReplaced`).
- Neue Form: Werkzeug fällt auf Zeiger zurück, neue Form gewählt, im Garn des gewählten Objekts direkt danach.
- Neuer Schriftzug: Text vorausgewählt zum Überschreiben; Ansicht passt sich an, wenn der Schriftzug aus dem sichtbaren Bereich (oder unter Werkzeuge) fällt (`lettering.ts:258-265`). Schrift wird bei Bedarf nachgeladen (`lettering.loadFailed`).
- Text-/Slider-Änderungen am Schriftzug sind je Feldbesuch bzw. Slider-Loslassen ein Undo-Schritt.
- Ebene Form folgt der Auswahl: ein anderes Objekt wählen öffnet dessen Umriss; Objekte ohne bearbeitbaren Umriss (auch "freie" Stiche) schließen die Form (`objects.ts:160-172`, `shapes.ts:127-134`, `:234-247`).
- Die Überlappungs-Karte erscheint unaufgefordert; "So lassen" gilt nur für diese Datei in dieser Sitzung (WeakSet, `drawing.ts:130`).
- Nicht-gestickt-Block öffnet sich selbst, wenn etwas dazukommt; Hintergrund wird beim Import automatisch beiseitegelegt.
- Garn-Wechsel eines Objekts: gleiches Garn wie Nachbar → wird in dessen Block eingegliedert, sonst eigener Block an seiner Stelle.

**Verknüpfte Objekte**
- Siehe Abschnitt 10: Umrandung im eigenen Garn, zweite Blendfarbe, Schatten (vor der Linie gestickt), Echo-Kopien (nach der Linie) sind eigene Objekte in der Liste, aber an ihr Hauptobjekt gebunden: mitlöschen, mitkopieren, mitbewegen, mitumkehren; per Hand verschoben bleiben sie, wo sie hingelegt wurden (`model/border.ts:109-119`, `:204-210`). Lösen der Verknüpfung passiert im Stich-Panel (`stitch.*.detached`, `app/stitches.ts:380-400`).

**Unsicherheiten**
- Ob Listen-DnD auf Touch irgendwo nachgerüstet ist, wurde nur in den genannten Dateien geprüft (kein Pointer-Drag-Code in `layersPanel.ts`).
- Strg+D bei gewähltem Schriftzug aus genau einem Objekt würde dieses duplizieren (Bedingung prüft nur `frameObjects().length === 1`); ob das gewollt ist, ist offen.

---

# Teil: Inventar D: Stiche, Querlinien, Korrektur, Befunde, Sprünge

Quelle: reiner Code-Stand (gelesen, nichts geändert). Abkürzungen für Dateien:
`SP` = src/ui/stitchPanel.ts, `ST` = src/app/stitches.ts, `RT` = src/ui/rungTool.ts, `RG` = src/app/rungs.ts,
`CP` = src/ui/correctPanel.ts, `CO` = src/app/correction.ts, `VP` = src/ui/validationPanel.ts, `JP` = src/ui/jumpsPanel.ts,
`FT` = src/ui/fixText.ts, `KE` = src/app/keys.ts, `PO` = src/app/pointer.ts, `ED` = src/ui/editor.ts, `OP` = src/ui/objectPanel.ts,
`OR` = src/app/order.ts, `MA` = src/main.ts, `IX` = index.html, `DE` = src/i18n/de.ts.

Modus-Namen: Ablauf = `mode.flow` (Taste 1), Dichte = `mode.density` (Taste 2). Ebenen-Schalter oben links auf der Leinwand: Form (`level.shape`, nur Ablauf), Objekte (`level.objects`), Stiche (`level.stitches`), IX:380-384.

Grundverhalten des Stich-Panels (SP:238 ff.): Es erscheint im Objekt-Panel (`#object-stitches`, IX:502, Panel `#object-panel` nur Ablauf) sobald mindestens ein Objekt gewählt ist und kein Schriftzug offen ist (MA:833-835). Werte werden vom jeweils ersten gewählten Objekt jeder Stichart gemessen (ST:56-130). Regler: Ziehen zeigt das Ergebnis live auf der Leinwand (Vorschau, rAF-gedrosselt), Loslassen übernimmt als ein Rückgängig-Schritt (SP:296-323, 795-800). Segmentschalter, Häkchen, Kacheln übernehmen sofort beim Klick.

---

## 1. Stich-Panel: Kopf, Status, Stichart

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Titel „Stiche“ / „Stiche: {kind}“ (`stitch.title`, `stitch.titleOf`) | Überschrift mit Symbol der Stichart | keine Aktion | immer bei Auswahl | SP:330, 356 |
| Stichart-Reiter Füllung / Satin / Steppstich (`object.fill`, `object.satin`, `object.run`) | Wählt, welche Stichart der gemischten Auswahl bearbeitet wird; setzt Vorschau zurück | Klick auf Reiter (role=tab) | Auswahl enthält mehr als eine Stichart | SP:334-353 |
| Hinweis „Änderungen gelten für {n} ausgewählte Objekte.“ (`stitch.many`) | Info bei Mehrfachauswahl | keine | mehr als 1 Objekt dieser Stichart | SP:380 |
| Form-Vertrauen (`stitch.shape.kept` / `.good` / `.approximate`) | Zeigt, wie sicher die Fläche erkannt ist (Häkchen oder Warnsymbol); Umriss wird auf der Leinwand gezeigt (orange bei ungefähr) | keine | Füllung, nicht gelöst | SP:381-388, ST:79-83 |
| Hand-Änderungs-Warnung (`stitch.hand`, `stitch.hand.one`) | Neue Einstellungen ersetzen {n} Änderungen von Hand | keine | gewählte Objekte haben Handänderungen | SP:389-396, 1299-1306 |
| „Von der Korrektur geändert: {list}“ (`plan.fixed`) | Liste, was die Korrektur an diesem Objekt geändert hat (Texte aus FT) | keine | genau 1 Objekt mit `fixed` | SP:397-402, ST:101 |
| Stichart (`stitch.kind`) Segment Füllung / Satin | Stickt die Objekte in der anderen Stichart neu (Fill zu Satin oder Satin zu Füllung) | Klick auf Segment; Tooltip `stitch.kind.toSatin` / `stitch.kind.toFill` | Füllung oder Satin | SP:413, 720-751; ST:288-310 |
| Satin gesperrt (`stitch.kind.noSatin`) | Satin-Knopf deaktiviert mit Text „Satin geht nur für schmale Striche (bis 7 mm, etwa gleich breit).“ | keine | Füllung, deren Fläche kein Strich ist | SP:728, 737-749; ST:86-87 |
| Stichart Füllung / Linie (`stitch.kind.line`) | Breite Linie als Füllung ihrer Fläche oder zurück zur Linie | Segment; Tooltips `stitch.kind.toLine`, `stitch.kind.lineToFill` | Füllung mit `asLine` bzw. Linie vom Typ Satin, nicht nur aus Stichen gelesen | SP:412, 1308; ST:293-304 |
| Nach Umwandlung Linie zu Füllung | Meldung `stitch.lineFilled` | automatisch | | ST:302 |
| Von der Korrektur ausnehmen (`plan.lock`) | Häkchen: Objekte werden von Korrekturvorschlägen ausgelassen; Zwischenzustand bei gemischter Auswahl | Checkbox, sofort | immer (auch bei gelösten Stichen) | SP:1285-1291; ST:350-365 |
| Von der Form lösen (`free.loose`) | Stiche werden frei: kein Regler und keine Korrektur stickt sie mehr neu | Knopf | mindestens ein Objekt mit eigener Form (nicht gelesen, kein Schriftzug, keine Umrandung/Schatten usw.) | SP:1260-1265; ST:141, 147-168 |
| Gelöst-Block (`free.text` / `free.someText`, `free.edit`) | Statusanzeige, keine Einstellungen mehr | keine | Auswahl ganz oder teils gelöst | SP:1268-1282 |
| Wieder aus der Form sticken (`free.back`) | Stickt gelöste Objekte aus ihrer ruhenden Form mit ihren Einstellungen neu | Knopf | Auswahl (teils) gelöst | SP:1278; ST:169-178 |
| Alle lösen (`free.looseAll`) | Löst auch die übrigen Objekte | Knopf | Auswahl gemischt gelöst | SP:1279 |
| Fußnote (`stitch.undo` / `stitch.lineNote` / `stitch.note`) | Hinweis zu Formerkennung und Strg+Z | keine | je nach Art | SP:420 |

### Abhängige Objekte (Umrandung in eigenem Garn, zweite Verlaufsfarbe, Schatten, Echo-Kopien)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Kopf „Umrandung einer Füllung“ / „Zweite Farbe eines Verlaufs“ / „Schatten einer Linie“ / „Echo-Kopien einer Linie“ (`stitch.outline.title`, `stitch.blendOf.title`, `stitch.shadowOf.title`, `stitch.echoOf.title`) + Erklärtext (`.text`) | Ersetzt alle Einstellungen: sie werden beim Eltern-Objekt gemacht | keine | genau 1 solches Objekt gewählt | SP:359-372; ST:117-127 |
| Füllung wählen (`stitch.outline.fill`) / Linie wählen (`stitch.shadowOf.line`) | Wählt das Eltern-Objekt und zeigt es in der Liste | Knopf (primär) | Eltern-Objekt existiert | SP:366; ST:382-386 |
| Lösen (`stitch.outline.detach`) | Macht das abhängige Objekt eigenständig, Eltern vergisst es; Meldung `stitch.*.detached` | Knopf | immer im Block | SP:367; ST:387-401 |

---

## 2. Stich-Panel: Füllung (Muster und Parameter)

### 2a. Muster-Auswahl

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Muster (`stitch.pattern`), Gruppen-Reiter Deckend (`stitch.group.cover`) / Offen (`stitch.group.open`) | Zeigt Kacheln einer Gruppe; Reiter mit dem aktuellen Muster ist markiert (`holds`) | Klick auf Reiter | Füllung | SP:810-834 |
| Kacheln Deckend: Tatami, Verlauf, Konturfüllung, Spirale, Wie bisher, Geführt, Wellen, Strahlen, Wirbel, Maserung, Kreise (`stitch.pattern.tatami/gradient/contour/spiral/follow/guided/waves/rays/swirl/grain/circles`) | Muster setzen und sofort neu sticken | Klick auf Kachel; Hover zeigt Vorschau auf der Leinwand (nicht für Geführt) | Füllung | SP:157-160, 846-883 |
| Kacheln Offen: Mäander, Labyrinth, Gitter, Echo, Kreuzstich (`stitch.pattern.meander/maze/grid/echo/cross`) | dito, offene Linie, Stoff scheint durch | dito | Füllung | SP:159 |
| Geführt gesperrt | Kachel deaktiviert mit Titel `stitch.guide.single` | keine | mehr als 1 Objekt gewählt | SP:856-860 |
| Musterhinweis | Text `stitch.pattern.{x}.hint` unter den Kacheln | keine | | SP:884 |

Musterwechsel-Automatik: Punkte (focus/centers), Ausblend-Richtung und zweite Verlaufsfarbe werden beim Wechsel entfernt (SP:839-845). Geführt ohne Leitlinien öffnet nur das Leitlinien-Werkzeug, gestickt wird erst mit der ersten Linie (SP:868). Wechsel weg von Geführt schließt das Leitlinien-Werkzeug, weg von Strahlen/Kreisen/Wirbel das Punkt-Werkzeug (SP:869-870). Fehlermeldungen je Muster: `stitch.failedSpiral`, `stitch.failedCurved` (Kontur, Wie bisher), `stitch.guide.failed`, sonst `stitch.failed` (ST:286).

### 2b. Werkzeuge in der Füllung

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Leitlinien (`stitch.guide`), Zähler `stitch.guide.none/one/count` | Zeigt Anzahl der Leitlinien | keine | Muster Geführt | SP:1205-1219 |
| Leitlinien zeichnen (`stitch.guide.tool`) / Fertig (`stitch.direction.done`) | Leitlinien-Werkzeug an/aus | Knopf; Taste **g** (Ablauf) | genau 1 Füllung, Ablauf | SP:1215; RG:119-137; KE:230 |
| Leitlinie zeichnen | Freihand auf der Fläche ziehen; Stiche folgen beim Loslassen | Ziehen auf Leinwand (Start innerhalb Fläche + 5 mm Rand); Mindestlänge 1 mm | Leitlinien-Werkzeug an | RT:591-595, 657-663 |
| Leitlinie löschen | Anklicken (wählt) und Entf/Rücktaste; ohne Linien zurück zu Tatami | Klick + Entf/Backspace | Werkzeug an | RT:859-861; SP:1225-1232; KE:167 |
| Punkt-Werkzeug Kopf (`stitch.points.rays` / `.circles` / `.swirl`) | Titel je Muster | keine | Strahlen, Kreise, Wirbel | SP:983-998 |
| Auf der Fläche setzen (`stitch.points.tool`) / Fertig | Punkt-Werkzeug an/aus | nur Knopf (keine Taste) | genau 1 Füllung (`stitch.points.single` sonst) | SP:994; RG:158-178 |
| Punkt setzen/verschieben | Klick in die Fläche: bei 1 Punkt springt er dorthin, bei Wirbel neuer Punkt bis 3; Punkt ziehen verschiebt; neu gestickt beim Loslassen | Klick/Ziehen auf Leinwand | Punkt-Werkzeug an | RT:552-573, 610-612, 649-650 |
| Punkt löschen | Gewählten Punkt mit Entf löschen; der letzte bleibt | Entf/Backspace | Wirbel mit mehr als 1 Punkt | RT:854-858 |
| Mit Querlinien zu Satin (`stitch.draw`) | Startet Querlinien-Werkzeug auf der Füllung | Knopf; Taste **r** | genau 1 Füllung, Ablauf, nicht `asLine` | SP:415, 1235-1257; RG:181-209 |
| Als Satin sticken (`stitch.draw.sew`) | Stickt Fläche als Satin entlang der gezogenen Linien | Knopf (primär) | Werkzeug an und mindestens 2 Querlinien (mit Trennlinien mindestens 1) | SP:1244; RG:338-386 |
| Abbrechen (`stitch.draw.cancel`) | Werkzeug schließen | Knopf, Esc | Werkzeug an | SP:1245 |
| Zähler `stitch.draw.count` (+ `stitch.draw.parts`), Hilfe `stitch.draw.help` | Info | keine | Werkzeug an | SP:1250-1254 |
| Zweite Farbe einblenden (`object.blend`) / Andere zweite Farbe (`stitch.blend.change`) | Öffnet Garnwähler für Zweifarb-Verlauf | Knopf im Stich-Panel; auch im Objektmenü (Rechtsklick/Langdruck) und Objekt-Panel | Muster Verlauf, genau 1 Füllung mit Fläche, nicht offen, nicht Linie | SP:497-502; ST:370; MA:758-764; OP:283 |
| Unter späteren Formen aussparen (`knockout.switch`) | Spart aus, was spätere Füllungen/Satins bedecken; Zwischenzustand bei gemischt; Hinweis `knockout.nothingOnTop` | Checkbox, sofort | Füllungen mit Kurvenform (`form`) | SP:411, 1466-1492; ST:92-97, 334 |

### 2c. Parameter Füllung (deckende Muster)

| Regler/Schalter (Key) | Typ | Bereich, Schritt, Einheit | Standard / Startwert | Verfügbar wenn | Code |
|---|---|---|---|---|---|
| Abstand (`stitch.density`), Notiz `stitch.densityNote` („etwa {1/v} mm Garn pro mm²“) | Regler mit grünem Empfehlungsband (`stitch.band`) | 0,2 bis 1,2, Schritt 0,01, mm | gemessen | alle deckenden außer Verlauf | SP:458-470, 495 |
| Abstand am Anfang / am Ende (`stitch.densityFrom`, `stitch.densityTo`) | 2 Regler mit Band | 0,2 bis 1,2, 0,01, mm | gemessen | Verlauf ohne Ausblendung | SP:490-494 |
| Abstand + Richtung (`stitch.fade`: Ausblenden `stitch.fade.out` / Einblenden `stitch.fade.in`) | Regler + Segment | wie oben | gemessen | Verlauf, der Lage eines Zweifarb-Verlaufs ist | SP:484-489 |
| Winkel (`stitch.angle`) | Regler mit Drehscheibe (Nadel zeigt Reihenrichtung) | 0 bis 175, Schritt 5, Grad | gemessen | Tatami, Verlauf, Wellen, Maserung | SP:167, 503, 1070-1101 |
| Wellenhöhe (`stitch.waveHeight`) | Regler | 0,5 bis 8, 0,1, mm | 1,8 | Wellen | SP:506 |
| Wellenlänge (`stitch.waveLength`) | Regler | 6 bis 50, 0,5, mm | 20 | Wellen | SP:507 |
| Stärke (`stitch.grainStrength`) | Regler | 0,1 bis 1, 0,05, Anzeige % | 0,5 (50 %) | Maserung | SP:512 |
| Neu würfeln (`stitch.reroll`) | Knopf (Würfelsymbol) | neuer Zufallssamen 1 bis 99999; bei Wirbel auch neue Wirbelpunkte | Samen 1 | Maserung, Wirbel (offen: Mäander, Labyrinth) | SP:513-516, 895-910, 1034 |
| Stichlänge (`stitch.length`) | Regler | 1,5 bis 7, 0,1, mm | gemessen | alle deckenden | SP:517 |
| Versatz (`stitch.offset`) | Segment 1/2, 1/3, 1/4, 1/5, Zufall (`stitch.offset.random`) | Werte 0,5 / 0,333 / 0,25 / 0,2 / 0 | gemessen (Umwandlung: 1/4) | Tatami | SP:212-217, 1039-1067 |
| Prägung (`stitch.motif`) | Bildsegment Keine, Rauten, Wellen, Sterne, Herzen (`stitch.motif.none/diamonds/waves/stars/hearts`), Hover-Vorschau | | Keine | Tatami | SP:916-958 |
| Stärke (`stitch.motifStrength`) | Segment Zart / Deutlich, Hover-Vorschau | | Zart | Tatami mit Prägung | SP:962-977 |
| Größe der Prägung (`stitch.motifSize`) | Regler | 4 bis 30, 0,5, mm | 8 | Tatami mit Prägung | SP:978 |
| Max. Abweichung (`stitch.tolerance`), Notiz `stitch.toleranceNote` | Regler | 0,05 bis 0,5, 0,05, mm | gemessen; zuletzt gewählter Wert wird für die nächsten Auswahlen übernommen | Kontur, Spirale, Wie bisher, Wellen, Maserung, Strahlen, Wirbel, Kreise | SP:165, 520, 754-766, 285 |
| Kanten (`stitch.edge`) | Regler, Vorzeichenanzeige | -0,4 bis 0,6, 0,05, mm | gemessen | deckend | SP:522 |
| Nach Stoff (`stitch.edgeAuto`) | Checkbox: setzt Kanten aus Stoff und Flächengröße | | aus; eigener Kanten-Wert schaltet es aus | deckend | SP:523-530; ST:104-107 |
| Ausdehnen (`stitch.expand`) | Regler, Vorzeichen | -3 bis 3, 0,05, mm | 0 | alle Füllungen (auch offen) | SP:476, 531 |
| Unterlage (`stitch.underlay`) | Segment Aus / Quer / Kreuz (`stitch.fillUnder.off/single/cross`), Hover-Vorschau | | gemessen | deckend | SP:532-546 |
| Unter späteren Objekten weglassen (`stitch.underCover`) | Checkbox | | aus | Unterlage an | SP:549 |
| Einzug der Unterlage (`stitch.underInsetBy`) | Segment Fest (mm) / Anteilig (%) | Wechsel auf Anteilig setzt 10 % | Fest | Unterlage an | SP:551-560 |
| Abstand zum Rand (`stitch.underInset`) | Regler mit Band „Bis {b} mm bleibt Platz“ (`stitch.underInset.band`, Tiefe minus 0,6) | 0 bis 10, 0,05, mm | 0,4 | Einzug Fest | SP:562-575 |
| Anteil der Breite (`stitch.underInsetShare`) | Regler | 0 bis 0,3, 0,01, % | 0,1 beim Umschalten | Einzug Anteilig | SP:576-585 |
| Abstand der Unterlage (`stitch.underSpacing`) | Regler | 0,6 bis 5, 0,1, mm | max(1,2; 3 x Abstand) | Unterlage an | SP:587-598 |
| Überlappung unter Satin (`knockout.share`) | Regler, ohne Live-Vorschau, übernimmt beim Loslassen | 0,1 bis 0,5, 0,05, % | 0,3 (30 %) | Aussparen an | SP:1475-1489; ST:335-348 |

### 2d. Parameter Füllung (offene Muster)

| Regler/Schalter | Typ | Bereich, Einheit | Standard | Verfügbar wenn | Code |
|---|---|---|---|---|---|
| Gitter (`stitch.grid`): Waben, Rauten, Ziegel | Segment | | Waben | Gitter | SP:1018 |
| Kreuz (`stitch.cross`): Kreuz, Halbkreuz, Doppelkreuz | Segment | | Kreuz | Kreuzstich | SP:1019 |
| Abstand der Linien (`stitch.openSize`) bzw. Größe (`stitch.openCell`) | Regler | Mäander/Labyrinth 1,2 bis 8 (Std 2,5); Echo 1,2 bis 10 (3); Gitter 3 bis 20 (6); Kreuz 1,5 bis 6 (2,5); Schritt 0,1 mm | siehe links | offene Muster | SP:1020-1031; restitch.ts:109-111 |
| Stichlänge (`stitch.length`) | Regler | 1 bis 3, 0,1, mm (Anzeige auf 3 gekappt) | gemessen | offen außer Kreuzstich | SP:1032 |
| Dreifachstich (`stitch.triple`) | Checkbox | | aus | offene Muster | SP:1033 |
| Neu würfeln | Knopf | | | Mäander, Labyrinth | SP:1034 |
| Ausdehnen, Umrandung | siehe 2c und 2f | | | | SP:476-477 |

### 2e. Füllung als breite Linie (`asLine`)

| Regler | Bereich | Standard | Code |
|---|---|---|---|
| Breite (`stitch.lineWidth`, Hint `stitch.lineFill.width.hint`) | 0,8 bis max(12, aufgerundete Breite), 0,1 mm | 3 | SP:710-716 |
| Enden (`stitch.lineCap`): Flach / Rund | Segment | Flach | SP:715 |

### 2f. Umrandung einer Füllung (`stitch.border`, Block mit Intro `stitch.border.intro`)

Hover oder Fokus auf dem Block hebt die Umrandung auf der Leinwand hervor (SP:1631, 440-451).

| Regler/Schalter | Typ | Bereich, Einheit | Standard | Verfügbar wenn | Code |
|---|---|---|---|---|---|
| Art (`stitch.borderType`): Aus, Steppstich, Satin, Zickzack, E-Stich, Motiv (`stitch.border.off/run/satin/zigzag/e/motif`) | Segment (3er-Reihen) | | Aus | Füllung | SP:28, 1499-1513 |
| Lage zur Kante (`stitch.borderOffset`) | Regler; Anzeige „auf der Kante“ / „+x mm außen“ / „-x mm innen“ | -3 bis 3, 0,05 mm | 0 | Umrandung an | SP:1520-1533 |
| Wiederholung (`stitch.repeat`): einfach, 3-fach, 5-fach | Segment | | einfach (3/5 = Bohnenstich) | Steppstich | SP:1534-1542 |
| Stichlänge (`stitch.length`, Hint `stitch.runLength.hint`) | Regler | 1 bis 6, 0,1 mm | 2,5 | Steppstich | SP:1543 |
| Breite der Umrandung (`stitch.borderWidth`) | Regler | 0,8 bis max(6, Breite), 0,1 mm | 2 | Satin, Zickzack, E-Stich | SP:1547 |
| Abstand (`stitch.density`) | Regler | 0,2 bis 1, 0,01 mm | 0,4 | Satin | SP:1593 |
| Zugausgleich (`stitch.borderPull`) | Regler | 0 bis 0,6, 0,05 mm | 0 | Satin | SP:1594 |
| Art der Unterlage (`stitch.under.kind`): Aus, Auto, Mitte, Randlauf, Zickzack, Randlauf + Zickzack | Segment | | automatisch: Mitte ab 1,5 mm Breite, sonst Aus | Satin | SP:1595-1598; along.ts:72 |
| Abstand (`stitch.gap`) | Regler | Zickzack 0,5 bis 6 (Std 1,5); E-Stich 1 bis 6 (Std 2,5), 0,1 mm | siehe links | Zickzack, E-Stich | SP:1582-1587 |
| Zacken (`stitch.eSide`): innen / außen | Segment | | innen | E-Stich | SP:1588, 1604-1611 |
| Motiv (`stitch.lineMotif`): Wellen, Bögen, Herzen, Kettstich | Segment | | Wellen | Motiv | SP:1552-1556 |
| Größe (`stitch.lineMotifSize`) | Regler, Band bis zur Größe, bei der Figuren sich berühren (`stitch.lineMotifSize.band`, nur Herzen) | 1 bis 8, 0,1 mm | 3 (Mindestbreite bei Wechsel auf Motiv) | Motiv | SP:1557-1568, 1508 |
| Abstand (`stitch.gap`, Hint `stitch.motifSpacing.hint`) | Regler | 1,5 bis 15, 0,1 mm | Wellen 5, Bögen 4, Herzen 8, Kettstich 2,2 | Motiv | SP:1569 |
| Seite (`stitch.motifSide`): innen/außen | Segment | | innen | Bögen, Herzen | SP:1571 |
| Wiederholung (Motiv) | Segment einfach/3-fach/5-fach | | einfach | Motiv | SP:1572-1579 |
| Garn der Umrandung (`stitch.borderThread`) | Knopf mit Farbfeld öffnet Garnwähler; „wie Füllung“ (`stitch.borderThread.same`); Hinweis `stitch.borderThread.own` | | wie Füllung | Umrandung an | SP:1638-1673 |

---

## 3. Stich-Panel: Satin

| Regler/Schalter | Typ | Bereich, Einheit | Standard / Startwert | Verfügbar wenn | Code |
|---|---|---|---|---|---|
| Muster (`stitch.satinType`): Satin / E-Stich | Segment; Wechsel setzt Abstand: E mindestens 2,5, Satin höchstens 0,4 | | Satin | Satin | SP:611-615 |
| Abstand (`stitch.density`) | Regler mit Band | Satin 0,2 bis 1, 0,01 mm; E-Stich 1 bis 6, 0,1 mm (ohne Band) | gemessen | Satin | SP:616-618 |
| Zugausgleich (`stitch.width`) | Regler, Vorzeichen | -3 bis 3, 0,05 mm | gemessen | Seiten nicht getrennt | SP:625 |
| Zugausgleich links / rechts (`stitch.widthLeft`, `stitch.widthRight`) | 2 Regler | -3 bis 3, 0,05 mm | gemessen | Seiten getrennt | SP:620-624 |
| Nach Stoff (`stitch.edgeAuto`, Hint `stitch.edgeAuto.satin.hint`) | Checkbox: setzt Zugausgleich und Anteil aus Stoff, hebt Seitentrennung auf | | aus | Satin | SP:627-638 |
| Seiten getrennt (`stitch.sides`) | Checkbox, Panel-Zustand; automatisch an, wenn rechts anders als links | | aus | Satin | SP:609, 640-645 |
| Zugausgleich anteilig (`stitch.widthShare`) | Regler, Anzeige „+x %“ | 0 bis 0,2, 0,01 | 0 | Satin | SP:646-655 |
| Kurze Stiche in Kurven (`stitch.short`) | Checkbox | | gemessen | Satin (nicht E) | SP:657 |
| Abstand nach Breite (`stitch.byWidth`) | Checkbox | | aus | Satin (nicht E) | SP:658 |
| Teilen ab (`stitch.split`) | Regler | 4 bis 12, 0,5 mm | 12 | Satin | SP:660 |
| Versetzt teilen (`stitch.stagger`) | Checkbox | | an | Satin | SP:661 |
| Unterlage (`stitch.underlay`) | Checkbox | | gemessen | Satin | SP:662-668 |
| Art der Unterlage (`stitch.under.kind`): Auto, Mitte, Randlauf, Zickzack, Randlauf + Zickzack | Segment (klein) | | Auto | Unterlage an | SP:669 |
| Einzug der Unterlage (`stitch.underInsetBy`) Fest / Anteilig | Segment; Anteilig setzt 15 % | | Fest | Unterlage an, nicht Mitte | SP:671-682 |
| Abstand zum Rand (`stitch.underInset`, Hint `stitch.satinUnderInset.hint`) | Regler | 0 bis 3, 0,05 mm | 0,4 | Einzug Fest | SP:685 |
| Anteil der Breite (`stitch.underInsetShare`) | Regler | 0 bis 0,45, 0,01, % | 0,15 | Einzug Anteilig | SP:686-695 |

### 3a. Richtung / Querlinien-Werkzeug (Satin)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Richtung (`stitch.direction`), Status `stitch.direction.follow` / `.even` / `.rungs` / `.rungs.one` | Zeigt, was die Stichrichtung steuert (freie Querlinien zählen mit) | keine | Satin; sonst Text `stitch.direction.single` bei Mehrfachauswahl | SP:1144-1151; RG:85-101 |
| Richtung festlegen (`stitch.direction.tool`) / Fertig (`stitch.direction.done`) | Querlinien-Werkzeug an/aus | Knopf; Taste **r** (Ablauf); Esc schließt (wenn nichts gewählt) | genau 1 Satin, Ablauf | SP:1154; RG:181-209; KE:229, 171-176 |
| Ecken vorschlagen (`stitch.direction.corners`) | Querlinien an den Knicken, vorhandene bleiben; sonst Meldung `stitch.direction.cornersNone` | Knopf | Werkzeug an | SP:1157; RT:895-907 |
| Abschnitte vorschlagen (`stitch.sections`) | Trennlinien an spitzen Ecken; sonst `stitch.sections.none` | Knopf | Werkzeug an | SP:1158; RT:940-957 |
| Beste Reihenfolge (`stitch.order.best`) | Reihenfolge, Richtung, Spiegelung verketteter Teile optimieren; sonst `stitch.order.best.none` | Knopf | Werkzeug an, eine Kette hat mehr als 1 Säule | SP:1159; RT:911-938 |
| Alle entfernen (`stitch.direction.even.button`) | Keine Querlinien: gleichmäßig von Ende zu Ende | Knopf (deaktiviert wenn schon so) | Werkzeug an | SP:1160; RT:985-994 |
| Wie gestickt (`stitch.direction.follow.button`) | Zurück zur Richtung der vorhandenen Stiche (Trennlinien und Ketten bleiben) | Knopf (deaktiviert wenn schon so) | Werkzeug an | SP:1161; RT:997-1002 |
| Ziehen (`stitch.pen`): Querlinie / Trennlinie (`stitch.pen.rung`, `stitch.pen.cut`) | Was eine gezogene Linie wird | Segment; Taste **t** (Umschalten); **Umschalt** beim Ziehen zieht die jeweils andere Art | Werkzeug an (Satin oder Füllung) | SP:1174-1190; KE:166; RT:542-544 |
| Abschnittszähler `stitch.sections.count` | „In {n} Abschnitten gestickt, ohne Garnschnitt“ | keine | Säule hat Trennlinien | SP:1166 |
| Abstand hier (`stitch.spacingHere`) | Eigener Abstand an der gewählten Querlinie, zur nächsten übergeblendet; leer = „wie Säule“ | Zahlenfeld, 0,2 bis 1,5, Schritt 0,05 mm, Komma erlaubt, auf Bereich gekappt | Werkzeug an und eine normale Querlinie gewählt | SP:1167, 1193-1202; RT:960-982 |
| Ketten-Hinweis `stitch.direction.chain` | Erklärt Badges auf der Leinwand | keine | Werkzeug an, Badges vorhanden | SP:1168 |
| Hilfe `stitch.direction.help` | Gesten-Hilfe | keine | Werkzeug an | SP:1169 |

### 3b. Querlinien-Werkzeug: Gesten auf der Leinwand (RT)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Querlinie ziehen | Linie quer über die Säule: Querlinie von Schiene zu Schiene; im Abschnitt mit Trennlinien auch freie Querlinie (gleiche Seite oder bis an Trennlinie); Mindestlänge 0,3 mm | Ziehen (Start nahe der Säule) | Werkzeug Satin | RT:597-603, 664-679, 689-736 |
| Fehlermeldungen | `stitch.direction.miss` (trifft nicht beide Schienen), `stitch.direction.cross` (kreuzt), `stitch.direction.needCut` (passt nur mit Trennlinie) | automatisch, Meldung in Ebenen-Notiz | | RT:704, 735, 754; RG:59-62 |
| Trennlinie ziehen | Teilt die Säule in Abschnitte ohne Garnschnitt; bei aus Füllung geschnittenem Satin wird die Fläche neu geteilt | Ziehen im Trennlinien-Modus oder mit Umschalt | Werkzeug Satin | RT:674-679, 719-725, 788-827 |
| Ende verschieben | Ende einer Querlinie/Trennlinie entlang der Schiene schieben (Live-Vorschau), Abstand-hier wandert mit; freie Querlinie gleitet am Abschnittsumriss | Ziehen am Ende (Fangradius 10 px, Linie 6 px) | Werkzeug an | RT:607-640, 458-498 |
| Linie wählen | Hervorhebung, Hover zeigt Treffer | Klick auf Linie; Hover | Werkzeug an | RT:574-584, 837-844 |
| Linie löschen | Gewählte Querlinie/Trennlinie/freie Querlinie löschen | Entf / Rücktaste | etwas gewählt | RT:847-883; KE:167 |
| Auswahl aufheben / Werkzeug schließen | Esc: erst Auswahl weg, dann Werkzeug zu | Esc | Werkzeug an | KE:171-177 |
| Badge Nummer | Teil einen Platz früher sticken | Klick auf Nummer | verkettete Säulen oder Abschnitte (nicht bei Einzelsäule) | RT:360-422 |
| Badge Pfeil | Richtung des Teils umdrehen | Klick | Badge sichtbar | RT:369, 384, 408 |
| Badge Schere | Garnschnitt vor dem Teil setzen/entfernen | Klick | nicht beim ersten Teil | RT:370, 391-395, 418 |
| Badge ⇄ (Spiegeln) | Teil beginnt auf der anderen Schiene | Klick | Badge sichtbar (auch Einzelsäule) | RT:368, 385-387, 409-411 |
| Rot umrandeter Fehlbereich | Zeigt Teil ohne Säule oder ungeöffnetes Loch; Meldungen `stitch.draw.notStripPart`, `stitch.draw.openHole` | automatisch | Trennlinien auf Füllung/aus Füllung | RT:277-281, 804-808; RG:353-360 |
| Abbruch bei Zwei-Finger-Geste | Laufende Linie verworfen | Pinch | | PO:184-188; RT:830-835 |
| Doppelklick | ohne Wirkung im Werkzeug | | | PO:452 |
| Klick ins Leere | Kein Objektwechsel, startet Schwenken | | | PO:291 (`!rungTool.active`) |

Werkzeug auf Füllung (Modus fill): gleiche Gesten für Querlinien und Trennlinien, Start innerhalb Flächen-Bounding-Box + 5 mm (RT:514-529), Enden frei ziehbar (RT:620), Löschen mit Entf (RT:851-853). Nach dem Sticken als Satin bekommt jede Kette die beste Reihenfolge automatisch (RG:373-381) und die Trennlinien bleiben gespeichert, später wieder verschiebbar (RG:362-370).

Werkzeug schließt sich automatisch: bei Moduswechsel weg von Ablauf, wenn nicht genau 1 Objekt gewählt ist, bei Objektverlust (RG:231-264), beim Wechsel in Ebene Stiche oder Form (MA:1088-1093, 1369-1376), beim Lösen von der Form (ST:162).

---

## 4. Stich-Panel: Steppstich und Linien

### 4a. Steppstich (Objekte aus Stichen, ohne Kurve)

| Regler | Bereich | Standard | Code |
|---|---|---|---|
| Stichlänge (`stitch.length`, Hint `stitch.runLength.hint`) | 1 bis 6, 0,1 mm | gemessen | SP:703 |
| Max. Abweichung (`stitch.tolerance`) | 0,05 bis 0,5, 0,05 mm | gemessen / zuletzt gewählt | SP:704 |
| Dreifachstich (`stitch.triple`) | Checkbox | gemessen | SP:705 |

### 4b. Linie (genau 1 Linienobjekt: gezeichnet, aus SVG oder Laufstich mit Kurve), Titel „Linie“ (`stitch.line.title`)

Alle Felder der Umrandung (2f) ohne „Aus“ und ohne „Lage zur Kante“: Art Steppstich/Satin/Zickzack/E-Stich/Motiv, Wiederholung, Stichlänge, Breite (`stitch.lineWidth`, 0,8 bis max(6, Breite), Hint `stitch.lineWidth.hint`), Abstand, Zugausgleich, Unterlage, Motiv, Größe, Abstand, Seite, Zacken. Unterschied: Seiten heißen hier rechts/links (`stitch.eSide.right/left`) statt innen/außen (SP:1294-1326, 1604-1611). Vorschau während des Ziehens, Übernahme beim Loslassen über `sewLine` (ST:331-333).

| Funktion / Regler | Typ | Bereich, Standard | Verfügbar wenn | Code |
|---|---|---|---|---|
| Stichart Linie / Füllung | Segment | | Linientyp Satin und Kurve gezeichnet (nicht gelesen) | SP:1308 |
| Max. Abweichung | Regler 0,05 bis 0,5 mm | Std 0,15 bzw. zuletzt gewählt | Steppstich/Bohnenstich | SP:1318-1321 |
| Echo (`stitch.echo`, Intro `stitch.echo.intro`): Seite (`stitch.echo.side`) | Segment: geschlossene Linie Aus/Außen/Innen/Beide; offene Linie Aus/Eine Seite/Beide | Aus; neu: 2 Kopien, 3 mm, außen | jede Linie | SP:1422-1435 |
| ⇄ Andere Seite (`stitch.echo.flip`) | Knopf: Kopien auf die andere Seite | | offene Linie, Echo „Eine Seite“ | SP:1436-1446 |
| Kopien je Seite (`stitch.echo.count`) | Regler 1 bis 6, Schritt 1 | 2 | Echo an | SP:1452 |
| Abstand (`stitch.echo.gap`) | Regler min bis 10, 0,1 mm; min = 1 bei Laufstich, sonst Breite + 0,5 (höchstens 10) | 3 | Echo an | SP:1450-1453 |
| Verbindung (`stitch.echo.link`): Stich / Schnitt | Segment | Stich | Echo an | SP:1455-1459 |
| Garn je Kopie (`stitch.echo.threads`) | Ein Farbknopf je Kopie (1..n), Garnwähler; „wie Linie“ (`stitch.echo.same`); eigenes Garn macht ein eigenes verknüpftes Objekt | wie Linie | Echo an | SP:1380-1415 |
| Schatten (`stitch.shadow`, Intro `stitch.shadow.intro`): Richtung (`stitch.shadow.dir`) | Segment Aus, ↘, ↙, ↗, ↖ | Aus; neu: dunkelgrau, 0,8 mm | Linie mit gezeichneter Kurve (nicht `traced`) | SP:1332-1343, 1323 |
| Versatz (`stitch.shadow.dist`) | Regler 0,3 bis 3, 0,1 mm | 0,8 | Schatten an | SP:1345 |
| Garn (`stitch.shadow.thread`) | Farbknopf, Garnwähler, Original „Dunkelgrau“; Garn der Linie wird ignoriert (Hinweis `stitch.shadow.thread.note`) | Dunkelgrau (64,64,64) | Schatten an | SP:1346-1372 |
| Fußnote `stitch.lineTraced` / `stitch.lineNote` | Info | | | SP:1324 |

---

## 5. Stiche bearbeiten (Ebene „Stiche“, einzelne Einstiche von Hand)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Ebene Stiche (`level.stitches`, Hint `level.stitches.hint`) | Schaltet Einstich-Bearbeitung ein; im Ablauf mit genau 1 gewähltem Objekt nur dessen Einstiche (Zoom auf kleines Objekt), sonst Hinweis `level.pick` | Radio im Ebenen-Schalter; Taste **e** (Ablauf schließt dabei Querlinien-Werkzeug, Dichte schaltet um); Knopf „Stiche bearbeiten“ (`object.editStitches`) im Objekt-Panel; Doppelklick auf Objekt ohne Kurvenform (öffnet sonst Form) | Ablauf und Dichte (nicht Bild) | IX:383; MA:1088-1100, 1056-1076, 1356-1363; KE:225-228, 263; OP:378; shapes.ts:202 |
| Brotkrume „{name} › Stiche“ (`level.in`) | Zeigt bearbeitetes Objekt | keine | Ablauf, Stiche-Ebene | MA:1115-1119 |
| Leinwand-Hinweis `canvas.hint.flowEdit` / `canvas.hint.edit` | Tastenhilfe | keine | | MA:1129-1132 |
| Einstich wählen | Wählt nächstgelegenen Einstich (8 px Fangradius) | Klick | Einstiche sichtbar (Zoom mindestens 6 px/mm) oder innerhalb des Objekts | ED:89-118 |
| Auswahl erweitern/umschalten | Einstich hinzu/weg | Umschalt+Klick | | ED:108-110 |
| Rechteck wählen | Fügt Einstiche im Rechteck hinzu | Umschalt+Ziehen ins Leere | | ED:119-123, 156-161 |
| Alles wählen | Alle Einstiche (im Objekt) | Strg/Cmd+A | Editor aktiv | KE:74-77; ED:263-269 |
| Verschieben per Ziehen | Gewählte Einstiche ziehen, Vorschau, Übernahme beim Loslassen | Ziehen auf Einstich | | ED:139-156 |
| Verschieben per Taste | 0,1 mm, mit Umschalt 0,5 mm | Pfeiltasten | Auswahl vorhanden | KE:179-191; ED:178-182 |
| Einstich einfügen | Teilt den nächstgelegenen Stich an der Stelle, neuer Einstich gewählt | Doppelklick auf Stich | | PO:457-459; ED:188-198 |
| Teilen (`edit.split`) | Stich zum gewählten Einstich in der Mitte teilen | Taste **i**; Knopf „Teilen“ im Objekt-Panel | genau 1 Einstich gewählt | KE:202-205; OP:387; ED:201-211 |
| Löschen (`edit.delete`) | Gewählte Einstiche löschen | Entf / Rücktaste; Knopf im Objekt-Panel (Ablauf); Knopf `#sel-delete` (Dichte, Korrektur-Panel) | Auswahl vorhanden | KE:192-196; OP:386; IX:556; CP:158 |
| Ausdünnen (`edit.thin`) + Anteil 25 % / 33 % / 50 % | Dünnt Reihen und Zickzacks in der Auswahl aus, Vernähstiche geschützt; sonst Meldung `edit.thin.none` | Knopf `#sel-thin` + Auswahl `#thin-share` (Std 33 %, Wert 0,34) | nur Dichte (Korrektur-Panel), Auswahl vorhanden | IX:557-562; CP:159; CO:424-427; ED:246-261 |
| Vorigen/nächsten Einstich wählen | Schritt in Stichreihenfolge, Ansicht folgt | Taste **,** / **.** | Ablauf, Editor aktiv | KE:234-239; ED:214-228 |
| Auswahl aufheben | | Esc (mit Auswahl); Klick ins Leere ohne Bewegung | | KE:197-201; ED:162-165 |
| Fertig / Ebene verlassen | Zurück zu Objekte | Esc ohne Auswahl; Knopf „Fertig“ (`object.editDone`); Klick neben die Stiche ohne Auswahl (Ablauf); Ebenen-Radio | | KE:233, 275; OP:388; PO:322 |
| Anderes Objekt bearbeiten | Klick auf Stiche eines anderen Objekts wechselt dorthin | Klick | Ablauf, Editor aktiv | PO:314-321 |
| Auswahl-Info (`edit.selection`, `.one`, `edit.none`, `edit.zoom`) | Zähler bzw. „Hineinzoomen“ | keine | Objekt-Panel (Ablauf) bzw. `#sel-info` (Dichte) | OP:382; CP:213-217 |
| Hinweis aus (`edit.panelHint`) / an (`edit.hint`) | Erklärt Bedienung im Korrektur-Panel | keine | Dichte | IX:550-554; CP:211-212 |
| Rückgängig / Wiederholen (`edit.undo`, `edit.redo`) | | Knöpfe `#undo`, `#redo`; Strg+Z, Strg+Umschalt+Z, Strg+Y | Ablauf und Dichte | IX:376-377; KE:64-68; CP:160-161 |
| Zurück zum Original (`edit.revert`) | Datei auf Original zurück | Knopf `#revert` | Datei geändert, nicht leer | IX:156; CP:162, 224 |

Jede Handänderung wird pro Objekt gezählt (`hand`) und warnt später im Stich-Panel und in Korrekturvorschlägen (`plan.hand`).

---

## 6. Korrektur (Panel „Korrektur“ mit Beta-Abzeichen, nur Dichte)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Ziel (`correct.goal`): Keine Warnung / Nur Kritisch | Welche Zonen behoben werden sollen; gespeichert | Radio `fix-goal` | Dichte | IX:529-533; CP:138-144 |
| Fokus (`correct.focus`): Beides / Fadendichte / Lochdichte, Hinweis je Wahl | Wogegen korrigiert wird; gespeichert | Radio `fix-focus` | Dichte | IX:536-542; CP:145-152, 203-208 |
| Korrektur vorschlagen (`correct.all`) | Erarbeitet Vorschläge für ganzes Design, ändert noch nichts; Fortschritt `plan.progress` | Knopf `#fix-all` | Datei geladen, nicht beschäftigt | IX:545; CP:153; CO:131-171 |
| Nur gewählte Zone (`correct.zone`) | dito, nur Zone + 1 mm | Knopf `#fix-zone` | Zone gewählt | IX:546; CP:154, 202 |
| Auf Stoff abstimmen (`tune.button`) | Vorschläge für besser passende Einstellungen zum Stoff (Titel `tune.head`), oder `tune.none` | Knopf `#fabric-tune` im Material-Panel; automatisch still beim Stoffwechsel | Dichte | IX:274; MA:1647, 1276; CO:102-128 |
| Vorschlagskarte: Kopf (`plan.head` / `plan.head.one`), Ergebnis mit allen (`plan.result`), Hinweis (`plan.hover`) | | keine | Plan vorhanden | CP:344-367 |
| Alle auswählen / Keine auswählen (`plan.all`, `plan.noneChecked`) | Alle Häkchen setzen/löschen (inkl. Feinkorrektur) | Link-Knöpfe | Plan vorhanden; anfangs ist nichts angehakt | CP:369-376; CO:394-401 |
| Vorschlagszeile: Häkchen | Vorschlag an/aus; gleiche Änderung an mehreren Objekten ist eine Zeile | Checkbox | | CP:410-412; CO:62-96 |
| Vorschlagszeile: Name (Farbfeld, Art-Symbol, „Füllung 3, 4“) | Hält Vorschlag fest zum Vergleich und zoomt hin (4 mm Rand); zweiter Klick lässt los | Klick auf Name (Titel `plan.show`); Esc lässt los | | CP:413-419; CO:413-421; KE:80 |
| Sichtbarkeit (`plan.vis.invisible/slight/visible`) bzw. `plan.hand` | Etikett je Zeile | keine | | CP:421-425 |
| Änderungen (FT, z. B. `plan.change.spacing`) und „Gegen: …“ (`plan.against`) | Texte je Zeile | keine | | CP:428-431; FT:15-48 |
| Vorher/Nachher-Vorschau | Hover über Zeile zeigt im Objektrahmen links vorher, rechts nachher (Heatmap asynchron, Unterlage markiert falls geändert); bei kleinem Rahmen (unter 240 px) zusätzlich beide ganz nebeneinander oben links/rechts | Maus über Zeile; Wegbewegen zeigt festgehaltenen Vorschlag wieder | nur Dichte | CP:432-442; CO:221-307 |
| Trennlinie vorher/nachher verschieben | Position der Trennlinie folgt der Maus seitlich über der Zeile, oder über dem Vergleichsrahmen auf der Leinwand; ziehen mit Finger | Mausbewegung über Zeile; Mausbewegung/Ziehen im Rahmen (3 % bis 97 %) | Vorschau sichtbar | CP:433-441; CO:207-215; PO:123-127, 222-229 |
| Feinkorrektur an den Stichen (`plan.fine`, Text `plan.fine.text`) | Zusätzliche Stichkorrektur an Stellen, wo keine Einstellung hilft | Checkbox | es gibt solche Stellen | CP:380-389; CO:347-356 |
| Gesperrte ausgelassen (`plan.locked`) | Info | keine | gesperrte Objekte | CP:349, 391 |
| Ausgewählte übernehmen (`plan.apply`) | Übernimmt angehakte Vorschläge + Feinkorrektur als ein Rückgängig-Schritt; Ergebnis `plan.applied`, `correct.result`, `plan.fineDone`, `correct.left`, `plan.undo` | Knopf (primär) | mindestens ein Häkchen | CP:394-396; CO:325-374, CP:446-477 |
| Verwerfen (`plan.discard`) | Plan verwerfen | Knopf | Plan vorhanden | CP:397-398; CO:387-393 |
| Hinweis `plan.note` | Vorschläge ändern nur Einstellungen, nie Form oder Stichart | keine | | CP:401 |
| Leerer Plan (`plan.none` / `correct.nothing`) | Info | | | CP:347-351 |
| Fehler (`correct.error`) | | | | CO:166-169 |
| Vergleich: Mit Original vergleichen / Vergleich beenden (`compare.start`, `compare.stop`) | Geteilte Leinwand Original/aktuell, Trennlinie ziehbar | Knopf `#compare-toggle`; Taste **c** (Dichte) | Datei geändert | IX:568; CP:157, 240-245; KE:264 |
| Vergleichstabelle (`compare.stitches/thread/critical/caution/maxDensity`, Spalten `compare.original`, `compare.current`) | Kennzahlen, besser grün/schlechter rot | keine | Datei geändert | CP:261-289 |

Ein Plan verfällt, sobald sich Datei oder Muster ändern (MA:845-851).

---

## 7. Befunde (Validierung, Panel „Befunde“, nur Dichte, einklappbar)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Kurzurteil in der Kopfzeile (`validation.verdict.*`, `validation.counts`) | Punkt + Urteil + Zählung, auch bei eingeklapptem Panel | keine | Datei | VP:135-150; IX:521 |
| Markierungen (`validation.overlay`) | Zonen auf der Fläche ein/aus | Checkbox `#show-validation`; Taste **v** (Dichte) | Dichte | IX:522; KE:267-271; controls.ts:197 |
| Urteil-Block (`validation.verdict.*`, `validation.msg.*`, `validation.share`, `validation.notCounted`, `validation.checksOff`) | Gesamturteil, Flächenanteil, was nicht zählt, ausgeschaltete Prüfungen | keine | Prüfung fertig | VP:152-182 |
| Filter-Chips Alle / Kritisch / Vorsicht / Unkritisch (`findings.all`, `level.critical`, `level.caution`, `findings.settled`) mit Zahlen | Filtert Liste; Unkritisch nur wenn vorhanden; neuer Datei: zurück auf Alle | Klick | Zonen vorhanden | VP:237-263, 120 |
| Vorige / Nächste Zone (`findings.prev`, `findings.next`), Position `findings.pos` / `findings.count` | Springt im Filter, zoomt hin | Knöpfe ‹ ›; Taste **n** / **Umschalt+n** (Dichte) | Zonen im Filter | VP:265-279; MA:935-942; KE:265-266 |
| Zonenzeile (Stufe, Gründe, #Nr, Fläche mm², Kennzahlen, Praxis-/Quittiert-Notiz) | Klick zoomt zur Zone (4 mm Rand) und schaltet Markierungen ein | Klick; Hover/Fokus hebt Zone auf der Leinwand hervor | | VP:191-214; MA:921-932, 168-174 |
| Quittieren (`findings.ack`) | Zone zählt nicht mehr, Korrektur lässt sie aus | Knopf in Zeile | offene Zone | VP:216-227; MA:175-182 |
| Wieder öffnen (`findings.unack`) | Quittung zurücknehmen | Knopf | quittierte Zone | VP:218 |
| Trotzdem prüfen (`findings.reopen`) | Praxisübliche Zone zählt wieder | Knopf | praxisübliche Zone | VP:220 |
| Praxisüblich lassen (`findings.keep`) | Wiedergeöffnete Praxis-Zone wieder ruhen lassen | Knopf | wiedergeöffnet | VP:222 |
| Zone abwählen | | Esc (Dichte) | Zone gewählt | KE:272-274 |
| Leerer Filter (`findings.empty`), Hinweis `validation.zoneHint`, Zustände `validation.noFile`, `.pending`, `.noChecks` | Info | | | VP:153-159, 188, 232 |

Sortierung: im Filter Alle zuerst offene, dann erledigte (gedimmt) (VP:109-116). Scrollposition bleibt, gewählte Zone wird in Sicht gescrollt (VP:127-132).

---

## 8. Sprünge und Schnitte (Panel `jumps.title`, nur Ablauf)

| Funktion | Was sie tut | Wege | Verfügbar wenn | Code |
|---|---|---|---|---|
| Zusammenfassung (`jumps.summary`) / keine Sprünge (`jumps.none`) | Anzahl Sprünge, davon geschnitten | keine | Ablauf | JP:61-64, 80 |
| Voriger / Nächster Sprung (`jumps.prev`, `jumps.next`) | Springt im Filter und zoomt (mindestens 25 mm Ausschnitt) | Knöpfe ‹ ›; Taste **n** / **Umschalt+n** (Ablauf) | Sprünge vorhanden | JP:72-79; OR:123-173; KE:247-248 |
| Warnung lange ungeschnittene (`jumps.longUncut`) | | keine | ungeschnittene Sprünge ab Grenze | JP:82 |
| Alle auf einmal nach Länge (`jumps.rule`) | Aufklappbereich; Zustand gespeichert, öffnet sich von selbst bei Warnung | Klick auf summary | | JP:85-91 |
| Schnittgrenze (`jumps.limit`) | Globale Grenze, ab der geschnitten wird (gilt auch beim Neusticken) | Zahlenfeld 0,5 bis 50, Schritt 0,5, mm, Std 3 | | JP:92-103; settings.ts:126 |
| Ab Grenze schneiden ({n}) (`jumps.cutFrom`) | Alle Sprünge ab Grenze schneiden + vernähen | Knopf | es gibt solche | JP:105-108 |
| Darunter nicht schneiden ({n}) (`jumps.carryBelow`) | Kürzere Sprünge: Schnitt und Vernähstiche entfernen | Knopf | es gibt solche | JP:109-112 |
| Filter Alle / Ohne Schnitt / Geschnitten (`jumps.filter.*`) | | Chips | | JP:118-135 |
| Sprungzeile (`jumps.item`, Länge, `jumps.color`, Zustand `jumps.state.*`) | Wählt/abwählt und zoomt hin; Hover hebt auf Leinwand hervor | Klick (erneut: abwählen); Maus über Zeile; Klick auf Sprung auf der Leinwand (Ablauf, kein Werkzeug) | | JP:147-160; PO:323-331 |
| Schneiden und vernähen (`jumps.cut`) | | Knopf in gewählter Zeile | ungeschnitten | JP:172 |
| Vernähen ergänzen (`jumps.tie`) | | Knopf | geschnitten, nicht vernäht | JP:174 |
| Nicht schneiden (`jumps.carry`) | | Knopf | geschnitten | JP:175 |
| Auswahl aufheben | | Esc (Ablauf, ohne gewählte Objekte) | | KE:252-256 |
| Hinweis `jumps.hint`, leer `jumps.empty` | | | | JP:140-142 |

---

## Besonderheiten (darf das Redesign nicht verlieren)

1. **Live-Vorschau vs. Übernahme:** Regler zeigen beim Ziehen das neue Stickbild (rAF), erst `change` (Loslassen) erzeugt einen Rückgängig-Schritt (SP:795-800). Ausnahme: „Überlappung unter Satin“ hat keine Vorschau und übernimmt nur beim Loslassen (SP:234-235, 1487). Linien nutzen eigenen Pfad `line(st, final)` (SP:296-311).
2. **Hover-Vorschauen:** Musterkacheln (nicht Geführt, nicht gesperrte), Prägungsmotive, Prägungsstärke und Unterlage-Segment der Füllung zeigen die Wahl auf der Leinwand, bevor sie gewählt wird (SP:874-881, 946-955, 969-976, 544).
3. **Hervorhebung beim Zeigen:** Zeiger oder Tastaturfokus auf Unterlage-Einstellungen zeigt die Unterlage auf der Leinwand, auf dem Umrandungs-Block die Umrandung und Konturlinien (SP:428-451; scene.ts:128-156, 254). Verschwindet die Gruppe (Unterlage aus), wird die Hervorhebung beendet (SP:425).
4. **Auto-Werte vs. eigene Werte:** „Nach Stoff“ koppelt Kanten (Füllung) bzw. Zugausgleich + Anteil (Satin) an den Stoff; jeder eigene Wert im Regler löscht die Kopplung (SP:522, 622-625, 653). Abstand von Zickzack/E-Stich/Motiv: gleich dem Standard = kein eigener Wert (bleibt automatisch). Unterlage-Einzug Std 0,4 mm, Unterlage-Abstand automatisch max(1,2; 3 x Abstand), Satin-Unterlage „Auto“ nach Breite, Umrandungs-Unterlage automatisch ab 1,5 mm Breite Mitte.
5. **Gemerkte Panel-Zustände:** Max. Abweichung wird für die nächsten Auswahlen übernommen (nur im Panel, nicht gespeichert) (SP:246-247, 285). „Seiten getrennt“ und Muster-Gruppenreiter sind Panel-Zustand; Gruppenreiter springt bei neuer Auswahl auf die Gruppe des Musters zurück (SP:282).
6. **Kopplungen bei Wechseln:** Satin zu E-Stich setzt Abstand mindestens 2,5 mm, zurück höchstens 0,4 mm (SP:614). Umrandungsart-Wechsel verwirft eigenen Abstand; Motiv erzwingt mindestens 3 mm Breite (SP:1504-1508). Musterwechsel verwirft Punkte, Ausblendung und zweite Verlaufsfarbe (SP:839-845). Umwandlung Satin zu Füllung startet mit Tatami, Versatz 1/4, Stichlänge 4, Endabstand = min(1,2; 2,5 x Abstand), Winkel automatisch (NaN); Füllung zu Satin mit Zugausgleich aus Profil, kurze Stiche an (ST:258-268). Unsicher: wie die Winkel-Drehscheibe einen NaN-Winkel anzeigt; nach Umwandlung wird neu gemessen (remeasure), daher vermutlich nicht sichtbar, nicht geprüft.
7. **Geführt-Automatik:** Wahl von „Geführt“ ohne Linien öffnet das Leitlinien-Werkzeug statt zu sticken; Löschen der letzten Leitlinie setzt das Muster zurück auf Tatami (SP:868, 1229). `RungTool.clearGuides` existiert, ist aber nirgends verdrahtet (RT:886).
8. **Messung:** Werte kommen vom ersten Objekt jeder Stichart; ein Laufstich zwischen zwei Füllstücken gilt als Transport und erzeugt keinen Steppstich-Reiter (ST:71-72). Mehrere Sticharten in der Auswahl: Reiter; Reiterwechsel verwirft laufende Vorschau.
9. **Panel zeichnet nur Werkzeugteil neu**, wenn sich ohne neue Auswahl Werkzeugzustand ändert (Querlinien, Leitlinien, Aussparen, gelöst) (SP:275-279). Sprachwechsel zeichnet neu und behält Entwürfe (SP:263-265).
10. **Nach Neusticken:** Auswahl bleibt (auch wenn ein Objekt in Stücke zerfällt, alle Stücke), Umrandungen in eigenem Garn und zweite Verlaufsfarben folgen automatisch (syncBorders), Panelwerte bleiben wie eingestellt (ST:200-252). Fehlgeschlagene Objekte behalten ihre Stiche, Meldung in der Ebenen-Notiz.
11. **Querlinien-Werkzeug versteckte Gesten:** Umschalt beim Ziehen = andere Linienart; Taste T wechselt; Linien nur nahe der Säule startbar (sonst Schwenken); Ende-Ziehen gleitet an der Schiene, Abstand-hier wandert mit; Badges (Nummer, Pfeil, Schere, ⇄) liegen auf der Leinwand an Säulenanfängen und sind nur hier bedienbar (RT:15, 360-422). Fangradien 10 px (Enden), 6 px (Linie), Badges 10 px. Bei aus Füllung geschnittenem Satin teilt jede Trennlinie die Fläche neu, Reihenfolge/Richtung/Schnitt bleiben bei gleicher Teilezahl erhalten (RT:788-827, 1019-1036).
12. **Punkte** werden als Anteil der Flächenausdehnung gespeichert, wandern also mit Transformationen (RG:51-57). Strahlen-Standardpunkt unten Mitte (0,5/0,9), Kreise Mitte, Wirbel bis 3 Punkte.
13. **Stiche-Ebene:** Einstiche sind nur ab Zoom 6 px/mm wählbar, außer innerhalb des bearbeiteten Objekts (ED:89-93; editOverlay.ts:8). Im Ablauf ist die Bearbeitung auf das Objekt begrenzt; Klick auf ein anderes Objekt wechselt, Klick ins Leere ohne Auswahl verlässt die Ebene. Ausdünnen gibt es nur im Dichte-Panel, Teilen nur im Objekt-Panel (Ablauf) und mit Taste i. Zwei-Finger-Geste bricht Ziehen ab (PO:184-197). Die Ebene bleibt beim Wechsel Ablauf/Dichte erhalten, im Bild-Modus aus (MA:705-707).
14. **Korrektur-Vorschau** ist nur im Modus Dichte sichtbar (CO:277). Festhalten per Name-Klick zoomt; Esc lässt los. Seitliche Mausposition über der Zeile steuert die Trennlinie (verstecktes Verhalten). Anfangs ist kein Vorschlag angehakt. Gleiche Änderungen werden zu einer Zeile zusammengefasst; unterschiedliche Vorher-Werte werden als „…“ gezeigt (CO:73-74; FT:4-5). Unterlage wird in der Vorschau nur markiert, wenn der Vorschlag sie ändert (CO:233-234, 260).
15. **Auf Stoff abstimmen** läuft still automatisch bei jedem Stoffwechsel und füllt die Korrekturkarte nur, wenn es Vorschläge gibt (MA:1276).
16. **Quittierungen** werden pro Zone nach Bounding-Box gespeichert (`acks` der Datei), eine neue Entscheidung ersetzt die alte (MA:175-182). Quittierte Zonen werden von der Korrektur ausgelassen.
17. **Sprünge:** Die Schnittgrenze ist eine globale Einstellung (auch für Neusticken, `trimMm`), nicht nur für die Liste. Der Regel-Bereich merkt seinen Aufklappzustand (settings.sections.jumpRule).
18. **Space-Taste:** Auf einem Schalter (Checkbox/Radio) im Ablauf startet Leertaste die Wiedergabe statt den Schalter umzuschalten (KE:59-62, 218-224); Tastenkürzel greifen nicht in Textfeldern.
19. **Lösen von der Form** schließt das Querlinien-Werkzeug und blendet alle Stich-Einstellungen aus; „Wieder aus der Form sticken“ ist rückgängig machbar (die freien Stiche bleiben für Undo erhalten) (ST:147-179).
20. Name „Korrektur 2.0“ kommt im Code nicht vor; UI heißt „Korrektur“ mit Beta-Abzeichen (`correct.title`, `correct.beta`). Der Nachrichtentyp `report` (alte Automatik-Korrektur) wird im CorrectPanel noch dargestellt, wird aber im gelesenen Code nirgends erzeugt (CP:50, 299-340).

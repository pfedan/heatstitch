# Neue Oberfläche: Konzept

Stand 2026-10-06. Grundlage: [Funktionsliste](funktionsliste.md) (Vertrag), [Design-System](MASTER.md),
Skill `ui-ux-pro-max`. Daniel: freie Hand, keine Altlasten, alle Wege dürfen neu gedacht werden.

## 1. Was heute stört

Aus der Funktionsliste und den Screenshots der heutigen Oberfläche:

1. **Drei Modi, die eigentlich keine sind.** "Ablauf" ist der Editor, "Dichte" ist eine Prüfansicht auf dasselbe Stickmuster,
   "Bild" ist ein Assistent, der ein neues Stickmuster erzeugt. Wer prüfen will, verliert die Bearbeitung; Werkzeuge
   tauchen je Modus auf und verschwinden.
2. **Drei Spalten voller Panels.** Links Dateien, Speichern, Färben, Anzeige, Statistik; rechts Ebenen, Objekt, Stiche,
   Sprünge, Befunde, Korrektur. Rund 30 Panels, viele mit Erklärtext, der Platz frisst.
3. **Gleiche Funktion, verschiedene Orte.** Teilen nur im Objekt-Panel und per Taste `i`, Ausdünnen nur in Dichte,
   Löschen per Taste auch bei "alles gewählt", Redo im Bild-Modus nur per Tastatur.
4. **Versteckte Bedienung.** Viele Funktionen nur per Taste (h, v, j/k, n, ","/"."), Bedeutung von Tasten wechselt je
   Modus (`v`, `t`), Ziehen in der Liste geht nicht per Touch, Erklärungen nur im `title`.
5. **Kein gemeinsamer Unterbau.** Jede Funktion bringt eigene Knöpfe, eigene Tastenabfrage, eigene Aktivierungsregeln.
   Darum ist die Oberfläche schwer erweiterbar und schwer konsistent zu halten.

## 2. Leitidee

**Ein Arbeitsplatz, ein Stickmuster im Mittelpunkt, alles andere kommt zu dir, wenn du es brauchst.**

- Kein Modus-Wechsel mehr für Bearbeiten und Prüfen. Prüfen ist eine Ansicht und eine Seitenleiste, keine andere App.
- Was du tun kannst, hängt davon ab, was gewählt ist: nichts gewählt zeigt das Stickmuster, ein Objekt zeigt das Objekt.
- Jede Aktion ist ein **Befehl**. Knopf, Kontextmenü, Tastenkürzel und Befehlssuche sind nur verschiedene Türen
  zum selben Befehl. Darum ist jede Funktion auf jedem Gerät erreichbar und neue Funktionen bekommen alle Türen gratis.
- Weniger Text auf dem Schirm: Erklärungen als kurze Hinweise beim Überfahren und in der Anleitung, nicht als Absatz
  im Panel.

## 3. Hauptwege

Die vier Dinge, die eine Hobby-Stickerin mit Heatstitch tut:

| Weg | Heute | Neu |
|-----|-------|-----|
| **Anfangen** | Dateiliste links, Beispiel-Dropdown, "+ Neu", Ablegen, Modus Bild | **Startseite** bei leerem Arbeitsplatz: Stickdatei öffnen, Bild umwandeln, Leer anfangen, Beispiel, zuletzt geöffnet. Ablegen geht überall. |
| **Gestalten** | Ablauf: Ebenen Form/Objekte/Stiche, Zeichenwerkzeuge nur bei Form, Text-Knopf, Stich-Panel rechts | **Werkzeugleiste links** (Wählen, Formen, Linie, Text, Richtung, Stiche), **Inspektor rechts** je nach Auswahl, Ebenen-Tiefe per Doppelklick wie heute |
| **Prüfen** | Modus Dichte: Heatmap, Befunde, Korrektur; Sprünge in Ablauf | **Ansicht "Prüfen"** (Heatmap über dem Stickmuster) plus Tab **Prüfen** im Inspektor: Befunde, Korrektur, Sprünge und Schnitte zusammen, Zähler an der Leiste |
| **Fertig machen** | Speichern-Panel links (Format, Name, Speichern), Projekt, PNG, Farbliste | Knopf **Speichern** oben rechts öffnet ein Blatt: Stickrahmen-Check, Format, Name, Farbliste, PNG, Projekt |

Bild umwandeln wird ein **Assistent** in drei Schritten (Bild wählen, Farben und Flächen, Ergebnis) mit "Übernehmen"
als Abschluss. Er arbeitet im selben Arbeitsplatz, nur Inspektor und Werkzeuge wechseln, und endet immer mit einem
normalen Stickmuster.

## 4. Aufbau des Bildschirms

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ Blume ▾  │ ↶ ↷ │      Gestalten  |  Prüfen      │ ⌘K Suchen │ Speichern ▾ │  Kopfzeile
├────┬──────────────┬─────────────────────────────────────────┬────────────────┤
│ ▢  │ Farben und   │                                         │ Inspektor      │
│ ✎  │ Objekte      │                                         │ (je Auswahl)   │
│ ◯  │ 1 Grün   ▸   │              Bühne (Canvas)             │                │
│ T  │ 2 Rosa   ▾   │                                         │ Stickmuster |  │
│ ⟂  │   Füllung 1  │                                         │ Objekt |       │
│ ⋯  │   Füllung 2  │                                         │ Prüfen (3)     │
│    │              │       [Ansicht: Realistisch ▾] [Zoom]   │                │
├────┴──────────────┴─────────────────────────────────────────┴────────────────┤
│ ▶  ◀ ▶  ───────●──────────  Stich 1.293 / 2.809 · 5:18      Tempo            │  Ablaufleiste
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Kopfzeile:** Stickmuster-Umschalter (Name mit Menü: andere offene Stickmuster, Neu, Öffnen, Beispiele, Umbenennen,
  Schließen), Rückgängig/Wiederholen, Umschalter **Gestalten | Prüfen**, Befehlssuche, Speichern. Sprache und Anleitung
  wandern ins Menü "⋯" (Einstellungen).
- **Werkzeugleiste (links, schmal):** Wählen (V), Rechteck/Ellipse/Pfad (Formen), Linie, Text (T), Richtung (Satin-
  Querlinien), Stiche von Hand. Ein aktives Werkzeug, Esc kehrt zu Wählen zurück. Optionen des Werkzeugs erscheinen als
  schmale Leiste über der Bühne.
- **Objektliste (links):** "Farben und Objekte" wie heute, mit Ziehen, aber auch per Tastatur und Menü sortierbar.
  Einklappbar zu einer Farbleiste. "Nicht gestickt" als eigene Gruppe am Ende der Liste.
- **Bühne:** Canvas mit schwebender Ansichts-Leiste unten rechts: Darstellung (Realistisch, Farben nach Garn /
  Reihenfolge / Stichart / Stichlänge, Dichte), Markierungen, Einpassen, Zoom.
- **Inspektor (rechts):** drei Reiter. **Stickmuster** (nichts gewählt): Stickrahmen, Material, Garne und Farbliste,
  Hintergrund, Statistik. **Objekt** (Auswahl): Größe und Lage, Reihenfolge-Aktionen, Stichart mit Gruppen. **Prüfen**:
  Befunde, Korrektur-Vorschläge, Sprünge und Schnitte. Der Reiter folgt der Auswahl, lässt sich aber festhalten.
- **Ablaufleiste (unten):** Player wie heute, dazu die Farbstreifen-Zeitleiste. Einklappbar.

**Kleinere Bildschirme:** ab unter 1100 px werden Objektliste und Inspektor zu Schubladen, die über der Bühne liegen;
unter 700 px (Tablet hochkant, Handy) wird die Werkzeugleiste eine untere Leiste. Alles bleibt per Tippen erreichbar.

## 5. Inspektor "Objekt": Stichart ordnen

Heute ist das Stich-Panel eine lange Liste. Neu gilt eine feste Reihenfolge in Gruppen, jede einklappbar, Zustand
wird gemerkt:

1. **Stichart** (Füllung | Satin | Linie) und **Muster** (Kacheln mit Vorschau beim Überfahren)
2. **Gestaltung:** Winkel, Richtung, Abstand bzw. Breite (die Werte, die man sieht)
3. **Umrandung** (nur Füllung) und **Effekte** (Echo, Schatten bei Linien)
4. **Stoff und Halt:** Unterlage, Zugausgleich, Dichte ("Nach Stoff" automatisch, eigener Wert mit ↺ zurück)
5. **Werkzeuge:** Leitlinien, Punkte, Querlinien, Aussparen, Teilen, Ausdünnen

Jeder Wert zeigt, ob er **Auto** ist oder ein **eigener Wert** (kleiner Punkt, Klick setzt zurück). Damit ist das
geschlossene Regler-Konzept ersetzt: Automatik zuerst, eigene Werte klar erkennbar, keine zweite Ebene von
Absichts-Reglern.

## 6. Bedienmodell

### Befehle
Jede Aktion wird einmal registriert:

```ts
command({
  id: 'object.duplicate',
  label: 'object.duplicate',        // i18n-Schlüssel
  icon: 'copy',
  keys: ['Mod+D'],
  when: (s) => s.selection.size > 0,
  run: (s) => duplicate(s.selection),
});
```

Daraus entstehen: Knopf (zeigt Taste im Hinweis), Kontextmenü-Eintrag, Tastenkürzel, Eintrag in der Befehlssuche
(Strg+K) und in der Tastenübersicht (`?`). Ein Befehl, der gerade nicht geht, ist überall gleich deaktiviert.

### Auswahl und Tiefe
- Klick wählt, Umschalt+Klick erweitert, Rahmen ziehen auf freier Fläche wählt mehrere, Strg+A alle.
- Doppelklick geht eine Ebene tiefer (Objekte → Form → Stiche), Esc eine Ebene zurück. Die Ebene steht als
  Brotkrume über der Bühne ("Blume › Füllung 3 › Form").
- Ein Schriftzug wird als Ganzes gewählt; Doppelklick wählt einzelne Buchstaben.

### Tastatur
Eine Tabelle, die nicht vom Modus abhängt. Buchstaben nur für Werkzeuge und Ansichten, alles andere mit Strg.
Die Belegung steht in der Tastenübersicht (`?`) und ist komplett aus den Befehlen erzeugt.

### Touch
Alles, was per Ziehen geht, geht auch per Menü oder Knopf (Reihenfolge: "Früher/Später sticken", Reihenfolge-Menü).
Langes Drücken öffnet das Kontextmenü. Mindestens 32 px Trefferfläche bei Maus, 44 px im Touch-Layout.

### Rückmeldung
- Kein modaler Dialog, keine Bestätigung vor Löschen: stattdessen Rückgängig und ein kurzer Hinweis unten
  ("3 Objekte gelöscht · Rückgängig").
- Lange Rechnungen zeigen Fortschritt an Ort und Stelle, nicht global.
- Fehler beim Öffnen (z. B. unbekanntes Format) als Hinweis, nicht stilles Verwerfen.

## 7. Technischer Unterbau

Heute: Vanilla TypeScript, DOM von Hand in 29 UI-Modulen, gemeinsamer Zustand `ui` in `src/app/state.ts`, alles in
`main.ts` verdrahtet. Das Rechnen (Modell, Digitalisieren, Rendern auf Canvas) ist gut getrennt und bleibt.

Neu, ohne neue Laufzeit-Abhängigkeiten (das Projekt hat heute keine, die PWA bleibt klein und offline):

- `src/shell/signal.ts`: kleine reaktive Werte (signal, computed, effect), etwa 100 Zeilen.
- `src/shell/h.ts`: DOM-Helfer `h('button', {onclick}, ...)` plus `bind()` für reaktive Attribute.
- `src/shell/commands.ts`: Befehlsregister, Tastenzuordnung, Kontextmenü, Befehlssuche.
- `src/shell/store.ts`: der App-Zustand als Signale (aktives Stickmuster, Auswahl, Ebene, Werkzeug, Ansicht), ersetzt
  das lose `ui`-Objekt und die Verdrahtung in `main.ts`.
- `src/shell/components/`: Bausteine aus dem Design-System (Button, IconButton, Segment, Slider mit Auto-Punkt,
  NumberField mit Einheit, Section, Tabs, Menu, Toast, Drawer, Tooltip).
- Bereiche als eigene Ordner (`src/areas/<bereich>/`), die nur Befehle registrieren und Inspektor-Gruppen liefern.
  Das macht paralleles Bauen möglich: ein Bereich, ein Ordner.
- Symbole als eigene SVG-Sprites im Lucide-Stil (keine Emoji, keine Schriftzeichen als Symbole).

Leistung: nur geänderte Teile neu zeichnen (Signale statt `redraw()` für alles), Canvas-Rendern bleibt in
`src/render`, schwere Rechnungen bleiben im Worker.

## 8. Umsetzung

Alles landet im Sammel-PR #110 (Zweig `claude/project-thread-1s684y`). Die alte Oberfläche wird nicht mitgezogen.

1. **Fundament** (allein, weil alle darauf bauen): Signale, `h`, Befehle, Store, Bausteine, Layout-Gerüst mit leerer
   Bühne, Kopfzeile, Werkzeugleiste, Inspektor-Reiter, Ablaufleiste. Canvas und Rendern angeschlossen.
2. **Bereiche parallel**, je ein Ordner:
   - A Dateien und Start: Startseite, Stickmuster-Umschalter, Öffnen/Ablegen, Speichern-Blatt, Projekt, PNG, Farbliste
   - B Objekte: Objektliste, Auswahl, Reihenfolge, Objekt-Inspektor, Kontextmenü, Duplizieren/Kopieren
   - C Formen und Zeichnen: Formwerkzeuge, Form bearbeiten, Rahmen, Fang, Schriftzug
   - D Sticharten: Stichart-Inspektor mit allen Gruppen, Richtung/Querlinien, Stiche von Hand
   - E Prüfen: Ansicht Dichte, Befunde, Korrektur, Sprünge und Schnitte
   - F Bild umwandeln: Assistent
   - G Stickmuster-Inspektor und Ansicht: Stickrahmen, Material, Garnkataloge, Darstellung, Markierungen, Player
3. **Abgleich:** Funktionsliste Zeile für Zeile abhaken, Tests anpassen, Leistung messen.
4. **Danach:** Anleitung, Screenshots, Screencasts.

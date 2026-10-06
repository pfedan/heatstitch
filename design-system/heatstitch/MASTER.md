# Heatstitch Design-System (Master)

Gilt für die ganze App. Wenn es `pages/<seite>.md` gibt, gehen deren Regeln für diese Seite vor.

Erzeugt mit dem Skill `ui-ux-pro-max` (Stil "Minimalism & Swiss Style", Dichte 8/10, Bewegung 2/10)
und dann an das echte Heatstitch angepasst. Farben, Schrift und Maße unten sind die, die in
`src/style.css` wirklich stehen. Die vom Generator vorgeschlagene Landingpage, Palette (Teal/Orange),
Google-Fonts und GSAP-Animationen passen nicht zu einem Editor und wurden bewusst nicht übernommen.

## Produkt und Haltung

- Browser-Stickeditor für Hobby-Sticker:innen, keine Shops. Desktop zuerst, Tablet soll benutzbar bleiben.
- **UX ist König:** einfach und klar vor vollständig. Sinnvolle Automatik statt Optionen, Hinweise statt
  Fehler, Live-Vorschau statt Bestätigen, keine modalen Dialoge.
- Das Stickbild steht im Mittelpunkt. Die Oberfläche ist ruhig, dicht und neutral, damit Garnfarben
  auf der dunklen Bühne wirken. Nur ein Akzent (Magenta), keine bunten Bedienelemente.
- Sprache: Deutsch zuerst, Englisch auch. Begriffe nach `plans/begriffe.md` (Projektdateien)
  (Projekt > Stickmuster > Farbe > Objekt > Form + Stichart > Stiche, "Stickrahmen").

## Farben (Tokens)

Nur über die CSS-Variablen färben, nie rohe Hex-Werte in Komponenten. Dunkelmodus folgt dem System
(`prefers-color-scheme`).

| Token | Hell | Dunkel | Zweck |
|-------|------|--------|-------|
| `--bg` | `#f4f2f7` | `#141118` | Seitenhintergrund, Knopf-Grund |
| `--panel` | `#ffffff` | `#1e1a24` | Seitenspalten, Panels |
| `--ink` | `#1d1a22` | `#ece8f1` | Text |
| `--muted` | `#6b6475` | `#a49cb0` | Nebentext, Icon-Knöpfe im Ruhezustand |
| `--line` | `#e2dde9` | `#2f2938` | Trennlinien, Rahmen |
| `--accent` | `#b5317a` | `#e0559e` | Hauptaktion, Auswahl, aktiver Zustand |
| `--accent-ink` | `#ffffff` | `#14060d` | Text auf Akzent |
| `--stage` | `#2a2530` | `#0d0b10` | Bühne hinter dem Stickbild |

Geprüfte Kontraste (WCAG): Text auf Panel 17:1 / 14:1, Nebentext auf Panel 5.7:1 / 6.5:1,
Text auf Akzentknopf 5.7:1 / 5.6:1. Alles über 4.5:1.

Halbtöne mit `color-mix(in srgb, var(--accent) 8%, transparent)` bilden, keine neuen Farben erfinden.
Garnfarben sind Inhalt, nicht Oberfläche: nie als UI-Farbe verwenden.

## Schrift

- Systemschrift: `font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif`. Keine Webfonts
  für die Oberfläche (App läuft offline als PWA). Schriften für Beschriftung (Lettering) sind Inhalt.
- Größen: 14px Grundtext, 13px dichte Listen, 12px Beschriftungen und Panels, 11px nur für Zusatzinfos
  (Einheiten, Zähler). Unter 11px nichts Neues.
- Zahlen in Tabellen und Messwerten mit `font-variant-numeric: tabular-nums`.

## Abstände, Radien, Schatten

- Raster in 2px-Schritten, typisch `gap` 4 / 6 / 8px. Knöpfe `padding: 5px 8px`. Dicht, aber nie
  aneinanderklebend: mindestens 4px zwischen klickbaren Elementen.
- Radien: 6px Standard (Knöpfe, Felder), 4px klein (Chips), 8 bis 10px für schwebende Panels.
- Schatten nur für Schwebendes (Menüs, Popover): `0 8px 28px rgba(0,0,0,.35)`. Flächen sonst flach,
  Gliederung über `--line`.

## Bausteine

- **Knopf:** `button` mit `--bg`, Rahmen `--line`. Hauptaktion `button.primary` in `--accent`, höchstens
  einer pro Bereich. `button.icon` für reine Symbolknöpfe, immer mit `title` und `aria-label`.
  Deaktiviert: `opacity: .5`, kein Zeiger.
- **Umschalter:** Segmentknöpfe (z. B. Form | Objekte | Stiche, Linie | Fläche) statt Dropdowns, wenn es
  2 bis 4 Möglichkeiten gibt.
- **Zahlenfelder:** mit Einheit (mm, %), Live-Vorschau beim Ändern, kein "Übernehmen"-Knopf.
- **Panels:** aufklappbar, Zustand merken. Befunde und Hinweise erscheinen im Panel, nicht als Pop-up.
- **Menüs:** Kontextmenü am Objekt, schließen mit Esc und Klick daneben.
- **Dialoge:** keine modalen Dialoge für Arbeitsabläufe. Einzige Ausnahme heute: Druckansicht der
  Farbliste (`src/ui/colorList.ts`).

## Bewegung

- Kurz und funktional: 120 bis 150 ms für Hover, Ein- und Ausklappen. Keine Scroll-Animationen,
  keine Animationsbibliothek.
- Animationen am Stickbild (Stichablauf) sind Inhalt und laufen nur auf Wunsch.

## Bedienung und Zugänglichkeit

- Alles per Tastatur erreichbar, sichtbarer Fokus über `:focus-visible` (nie Fokusring entfernen).
- Tastenkürzel zeigen wir im `title` des Knopfes an (z. B. "Duplizieren (Strg+D)").
- Zustand nie nur über Farbe zeigen: Auswahl zusätzlich über Rahmen oder Markierung.
- Rückgängig stellt immer alles oder nichts wieder her.
- Fehler als Hinweis direkt am betroffenen Objekt oder Feld, mit Vorschlag zur Behebung.

## Bekannte Lücken (vom Skill-Abgleich gefunden)

- `prefers-reduced-motion` wird noch nicht berücksichtigt (die wenigen Übergänge sollten dann entfallen).
- Rahmen von Feldern und Knöpfen (`--line` auf `--panel`) haben nur etwa 1.3:1 Kontrast; WCAG empfiehlt
  3:1 für Bedienelement-Grenzen. Bei Bedarf eigenes Token für Feldrahmen einführen.
- Viele Texte in 11px und einige in 10px; bei Überarbeitung auf mindestens 11px bzw. 12px gehen.

## Vor dem Ausliefern von Oberfläche

- [ ] Nur Tokens, keine neuen Farben; hell und dunkel angesehen
- [ ] Höchstens eine Hauptaktion pro Bereich
- [ ] Tastatur und sichtbarer Fokus funktionieren
- [ ] Icon-Knöpfe haben `title` und `aria-label`
- [ ] Deutsche und englische Texte da, Begriffe nach `plans/begriffe.md` (Projektdateien)
- [ ] Kein modaler Dialog, Änderungen live sichtbar
- [ ] Mit realistischem Screenshot geprüft

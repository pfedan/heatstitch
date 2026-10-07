# Bauanleitung für die Bereiche des UI-Umbaus

Für jeden, der einen Bereich der neuen Oberfläche baut. Erst lesen: [konzept.md](konzept.md), [MASTER.md](MASTER.md),
den eigenen Teil der [funktionsliste.md](funktionsliste.md).

## Ziel eines Bereichs

1. **Jede Funktion des Bereichs aus der Funktionsliste bleibt erhalten.** Der Weg dorthin darf neu sein und soll
   einfacher werden. Nichts stillschweigend streichen: Wenn etwas bewusst entfällt oder zusammengelegt wird, steht es
   mit Grund im Abschlussbericht.
2. **Jede Aktion ist ein Befehl** (`src/shell/commands.ts`). Knöpfe, Kontextmenüs und die Befehlssuche rufen den
   Befehl auf, nicht eigene Funktionen. Tasten, die heute `src/app/keys.ts` behandelt, bekommen im Befehl
   `keys: [...]` und `bind: false`, damit sie in Befehlssuche und Tastenübersicht (`?`) erscheinen; `keys.ts` selbst
   ändert nur, wer dafür eingeteilt ist.
3. **Weniger Text auf dem Schirm.** Lange Erklärungen raus aus den Panels: als `title`-Hinweis am Element oder knapp
   unter einem Abschnitt. Die Texte bleiben in den i18n-Dateien, wenn sie noch gebraucht werden.
4. **Konsistenz:** Bausteine aus `src/shell/ui.ts` (`section`, `slider`, `showMenu`, `toast`) und die Klassen aus
   `src/style.css` (`.field`, `.segmented`, `.check`, `button.primary`, `button.icon`, `.tool`) verwenden.
   Farben nur über Tokens (`--bg`, `--panel`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`, `--stage`).
5. **Kein modaler Dialog, keine Bestätigungsfrage.** Statt "Wirklich löschen?" sofort ausführen und `toast()` mit
   Rückgängig zeigen. Fehler als Hinweis am Ort, nie still verwerfen.
6. **Touch und Tastatur:** Was per Ziehen geht, geht auch per Befehl oder Menü. Sichtbarer Fokus bleibt.

## Wo was hingehört (Konflikte vermeiden)

Mehrere Bereiche werden gleichzeitig gebaut und danach zusammengeführt.

- **Texte:** nur in `src/i18n/areas/<bereich>.ts` neue Schlüssel anlegen (Präfix `<bereich>.`), Deutsch und Englisch.
  Bestehende Schlüssel in `de.ts`/`en.ts` dürfen nur Texte ändern, die zum eigenen Bereich gehören.
- **CSS:** neue Regeln in `src/areas/<bereich>/<bereich>.css`, importiert aus dem eigenen Modul. In `src/style.css`
  nur Regeln des eigenen Bereichs ändern oder löschen.
- **Code:** neue Module unter `src/areas/<bereich>/`. Die bestehenden Module des Bereichs (siehe Zuteilung) dürfen
  frei umgebaut werden. `src/main.ts`, `index.html` und `src/app/keys.ts` nur an den Stellen des eigenen Bereichs
  ändern und so klein wie möglich.
- **IDs, die Tests nutzen,** bleiben oder die Tests werden mitgezogen (`tests/langSwitch.test.ts`, `tests/spaceKey.test.ts`).

## Prüfen vor dem Abschluss

```bash
npx tsc --noEmit
npx vitest run
BROWSER_TESTS=1 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx vitest run tests/langSwitch.test.ts tests/spaceKey.test.ts
```

Dazu selbst ansehen: `npx vite --port <frei>` starten, mit Playwright (Chromium unter
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) das Demo-Projekt `public/examples/demo/heatstitch-demo.heatstitch`
laden, Screenshots in hell und dunkel machen und selbst beurteilen. Hart prüfen: Wirkt es aufgeräumt? Ist jede
Funktion des Bereichs erreichbar? Geht es in Deutsch und Englisch?

## Regeln aus dem Projekt

- Keine langen Gedankenstriche in Texten, auch nicht in Kommentaren und Commit-Nachrichten.
- Begriffe: Projekt > Stickmuster > Farbe > Objekt > Form + Stichart > Stiche > Einstiche; "Stickrahmen" für den
  Rahmen der Maschine, "Rahmen" ist der Auswahlrahmen.
- Rückgängig stellt alles oder nichts wieder her. Nichts an Modell, Rechnen oder Dateiformaten ändern, was nicht
  für die Oberfläche nötig ist.

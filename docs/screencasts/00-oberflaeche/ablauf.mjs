// Teil 0: Die heatstitch Oberfläche. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.

const btn = (s, name) => s.page.getByRole('button', { name }).first();
// Gestalten and Prüfen are radio buttons inside their labels.
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();

export default {
  title: 'Die heatstitch Oberfläche',
  part: 0,
  voice: {
    model: 'google/gemini-3.1-flash-tts',
    voice: 'Aoede',
    language: 'de-DE',
    prompt:
      'Speak German in a calm, friendly and clear voice, like an experienced embroiderer showing a friend something on the computer. Natural pace, small pauses between thoughts. Let real enthusiasm show when something nice happens.',
  },
  lead: 0.4,
  tail: 0.6,
  scenes: [
    {
      say: '[warm, inviting] Das ist heatstitch, dein Stickprogramm im Browser. Ein frischer Start fragt: Was möchtest du sticken? Du kannst eine Stickdatei öffnen, ein Bild umwandeln, leer anfangen oder ein Beispiel ansehen.',
      text: 'Das ist heatstitch, dein Stickprogramm im Browser. Ein frischer Start fragt: Was möchtest du sticken? Du kannst eine Stickdatei öffnen, ein Bild umwandeln, leer anfangen oder ein Beispiel ansehen.',
      textEn: 'This is heatstitch, your embroidery program in the browser. A fresh start asks: What would you like to embroider? You can open an embroidery file, convert an image, start empty or look at an example.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(5.2);
        for (const [name, word, sec] of [
          [/^Stickdatei öffnen/, 'Stickdatei öffnen', 1.3],
          [/^Bild umwandeln/, 'Bild umwandeln', 1.0],
          [/^Leer anfangen/, 'Leer anfangen', 1.0],
          [/^Beispiel ansehen/, 'Beispiel ansehen', 1.0],
        ]) {
          await s.move(btn(s, name), 0.7);
          await s.label(word, btn(s, name), 'above');
          await s.wait(sec);
        }
        s.unlabel();
      },
    },
    {
      say: 'Unter „Weitere Beispiele“ öffne ich die Katze, eine fertige Stickdatei.',
      text: 'Unter „Weitere Beispiele“ öffne ich die Katze, eine fertige Stickdatei.',
      textEn: 'Under “More examples” I open the cat, a finished embroidery file.',
      run: async (s) => {
        await s.click(btn(s, /^Katze/), { move: 1.0, before: 0.8 });
        await s.move([980, 620], 1.0);
        await s.wait(1.6);
      },
    },
    {
      say: 'Oben links steht ihr Name. Ein Klick darauf öffnet das Stickmuster-Menü: Neu, Öffnen und deine offenen Stickmuster. Daneben liegen Rückgängig und Wiederholen.',
      text: 'Oben links steht ihr Name. Ein Klick darauf öffnet das Stickmuster-Menü: Neu, Öffnen und deine offenen Stickmuster. Daneben liegen Rückgängig und Wiederholen.',
      textEn: 'Its name is at the top left. A click on it opens the design menu: New, Open and your open designs. Next to it are Undo and Redo.',
      run: async (s) => {
        const name = btn(s, /cat-60mm/);
        await s.zoom([0, 0, 640, 360], 1.8);
        await s.move(name, 1.0);
        await s.wait(0.6);
        await s.click(null);
        await s.label('Stickmuster-Menü', [40, 50, 300, 0], 'below');
        await s.wait(4.2);
        s.unlabel();
        await s.press('Escape', { show: 0 });
        await s.move(btn(s, 'Rückgängig'), 0.9);
        await s.label('Rückgängig', btn(s, 'Rückgängig'), 'below');
        await s.wait(1.2);
        await s.move(btn(s, 'Wiederholen'), 0.5);
        await s.label('Wiederholen', btn(s, 'Wiederholen'), 'below');
        await s.wait(1.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'In der Mitte wechselst du zwischen Gestalten und Prüfen. [curious] Prüfen sucht Stellen, an denen es beim Sticken haken könnte.',
      text: 'In der Mitte wechselst du zwischen Gestalten und Prüfen. Prüfen sucht Stellen, an denen es beim Sticken haken könnte.',
      textEn: 'In the middle you switch between Design and Check. Check looks for spots where stitching could go wrong.',
      run: async (s) => {
        await s.zoom([960, 24, 0, 0], 1.6);
        await s.move(mode(s, 'Gestalten'), 1.0);
        await s.label('Gestalten', mode(s, 'Gestalten'), 'below');
        await s.wait(1.6);
        await s.move(mode(s, /^Prüfen/), 0.6);
        await s.label('Prüfen', mode(s, /^Prüfen/), 'below');
        await s.wait(1.6);
        s.unlabel();
      },
    },
    {
      say: 'Oben rechts findet „Suchen“ jeden Befehl, schneller geht es mit Strg K. Daneben ist Speichern. Im Menü mit den drei Punkten wählst du die Sprache und findest die Anleitung und die Tastenkürzel.',
      text: 'Oben rechts findet „Suchen“ jeden Befehl, schneller geht es mit Strg+K. Daneben ist Speichern. Im Menü mit den drei Punkten wählst du die Sprache und findest die Anleitung und die Tastenkürzel.',
      textEn: 'At the top right, “Search” finds every command, even quicker with Ctrl+K. Next to it is Save. In the menu with the three dots you choose the language and find the guide and the keyboard shortcuts.',
      run: async (s) => {
        s.zoomOut();
        await s.move(btn(s, /^Suchen/), 1.0);
        await s.label('Suchen', btn(s, /^Suchen/), 'below');
        await s.wait(0.8);
        s.unlabel();
        await s.press('Control+k', { label: 'Strg+K', show: 0.4 });
        await s.type('spiegeln', { perChar: 0.1 });
        await s.wait(1.2);
        await s.press('Escape', { show: 0 });
        await s.zoom([1700, 24, 0, 0], 1.8);
        await s.move(btn(s, 'Speichern'), 0.8);
        await s.label('Speichern', btn(s, 'Speichern'), 'below');
        await s.wait(1.4);
        s.unlabel();
        await s.click(btn(s, 'Mehr'), { move: 0.6 });
        await s.move([1800, 110], 0.7);
        await s.wait(4.0);
        await s.press('Escape', { show: 0 });
        s.zoomOut();
      },
    },
    {
      say: 'Links an der Bühne liegt die Werkzeugleiste. Damit zeichnest du Rechtecke, Ellipsen, Pfade, Freihandlinien und Text.',
      text: 'Links an der Bühne liegt die Werkzeugleiste. Damit zeichnest du Rechtecke, Ellipsen, Pfade, Freihandlinien und Text.',
      textEn: 'On the left of the stage is the toolbar. With it you draw rectangles, ellipses, paths, freehand lines and text.',
      run: async (s) => {
        await s.zoom([24, 260, 0, 0], 1.8);
        await s.move(btn(s, 'Wählen'), 1.2);
        await s.label('Werkzeugleiste', [8, 60, 32, 400], 'right');
        await s.wait(1.4);
        for (const name of ['Rechteck', 'Ellipse', 'Pfad', 'Freihand', 'Text']) await s.move(btn(s, name), 0.55);
        await s.wait(0.6);
        s.unlabel();
      },
    },
    {
      say: 'Daneben stehen „Farben und Objekte“. Jede Farbe ist ein Garn. Klappst du sie auf, siehst du ihre Objekte, in der Reihenfolge, in der die Maschine stickt.',
      text: 'Daneben stehen „Farben und Objekte“. Jede Farbe ist ein Garn. Klappst du sie auf, siehst du ihre Objekte, in der Reihenfolge, in der die Maschine stickt.',
      textEn: 'Next to it are “Colors and objects”. Each color is a thread. Expand it and you see its objects, in the order the machine stitches them.',
      run: async (s) => {
        await s.zoom([200, 300, 0, 0], 1.6);
        await s.move([200, 160], 1.0);
        await s.label('Farben und Objekte', [70, 70, 260, 0], 'below');
        await s.wait(3.0);
        s.unlabel();
        await s.click(btn(s, /^Die 18 Objekte zeigen/), { move: 0.8 });
        await s.move([200, 420], 1.2);
        await s.wait(1.0);
      },
    },
    {
      say: '[focused] In der Mitte liegt die Bühne. Ein Klick wählt ein Objekt. Oben zeigt der Breadcrumb, wo du gerade bist. Unten rechts ist die Ansichtsleiste: das Auge für das Ansicht-Menü, daneben Zoom und Einpassen.',
      text: 'In der Mitte liegt die Bühne. Ein Klick wählt ein Objekt. Oben zeigt der Breadcrumb, wo du gerade bist. Unten rechts ist die Ansichtsleiste: das Auge für das Ansicht-Menü, daneben Zoom und Einpassen.',
      textEn: 'In the middle is the stage. A click selects an object. At the top, the breadcrumb shows where you are. At the bottom right is the view bar: the eye for the view menu, next to it zoom and fit.',
      run: async (s) => {
        s.zoomOut();
        await s.move([975, 400], 1.2);
        await s.wait(1.2);
        await s.click([1000, 840], { move: 1.0 });
        await s.wait(0.8);
        const crumb = s.page.getByRole('button', { name: /^Ebene:/ });
        await s.move(crumb, 1.0);
        await s.label('Breadcrumb', crumb, 'below');
        await s.wait(2.2);
        s.unlabel();
        const eye = s.page.getByRole('button', { name: 'Stiche', exact: true });
        await s.zoom([1430, 1000, 0, 0], 1.6);
        await s.move(eye, 1.0);
        await s.label('Ansichtsleiste', [1276, 984, 314, 36], 'above');
        await s.wait(1.8);
        s.unlabel();
        await s.move(btn(s, 'Einpassen'), 1.2);
        await s.wait(0.6);
        s.zoomOut();
      },
    },
    {
      say: 'Rechts liegen die Karten. Die Karte Objekt zeigt alles zum gewählten Objekt, etwa Größe und Stichart. Die Karte Stickmuster gilt für das ganze Muster: Stickrahmen, Stoff und Garne.',
      text: 'Rechts liegen die Karten. Die Karte Objekt zeigt alles zum gewählten Objekt, etwa Größe und Stichart. Die Karte Stickmuster gilt für das ganze Muster: Stickrahmen, Stoff und Garne.',
      textEn: 'On the right are the cards. The Object card shows everything about the selected object, such as size and stitch type. The Design card covers the whole design: hoop, fabric and threads.',
      run: async (s) => {
        await s.zoom([1760, 380, 0, 0], 1.7);
        await s.move(s.page.getByRole('tab', { name: 'Objekt' }), 1.0);
        await s.label('Karte Objekt', [1610, 60, 150, 26], 'below');
        await s.wait(1.4);
        s.unlabel();
        await s.move(s.page.getByLabel('Breite in mm'), 0.8);
        await s.label('Größe', s.page.getByLabel('Breite in mm'), 'below');
        await s.wait(1.3);
        const stitch = s.page.getByText('Stichart', { exact: true }).first();
        await s.move(stitch, 0.8);
        await s.label('Stichart', stitch, 'below');
        await s.wait(1.3);
        s.unlabel();
        const tab = s.page.getByRole('tab', { name: 'Stickmuster' });
        await s.click(tab, { move: 0.9 });
        await s.label('Karte Stickmuster', tab, 'below');
        await s.move([1760, 300], 0.9);
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Unten ist der Player. [delighted] Mit der Leertaste siehst du, wie die Maschine Stich für Stich stickt.',
      text: 'Unten ist der Player. Mit der Leertaste siehst du, wie die Maschine Stich für Stich stickt.',
      textEn: 'At the bottom is the player. The space bar shows you how the machine stitches, stitch by stitch.',
      run: async (s) => {
        await s.press('Escape', { show: 0 });
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.move(btn(s, /^Abspielen/), 1.0);
        await s.label('Player', [360, 1040, 1230, 34], 'above');
        await s.wait(1.6);
        s.unlabel();
        await s.move([975, 700], 0.8);
        await s.press('Home', { label: 'Pos1', show: 0.5 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(4.5);
      },
    },
    {
      say: 'Fährst du mit der Maus über einen Knopf, erklärt ein Hinweis, was er tut, und nennt die passende Taste.',
      text: 'Fährst du mit der Maus über einen Knopf, erklärt ein Hinweis, was er tut, und nennt die passende Taste.',
      textEn: 'Hover over a button and a hint explains what it does and names the matching key.',
      run: async (s) => {
        await s.tips(true);
        await s.zoom([24, 170, 0, 0], 1.8);
        await s.move(btn(s, 'Ellipse'), 1.2);
        await s.wait(3.2);
        await s.move(btn(s, 'Text'), 0.9);
        await s.wait(2.4);
        await s.move([200, 600], 0.8);
        await s.tips(false);
        s.zoomOut();
      },
    },
    {
      say: 'Und keine Angst vor Fehlern. Ist etwas weg, holt Rückgängig es zurück, Schritt für Schritt.',
      text: 'Und keine Angst vor Fehlern. Ist etwas weg, holt Rückgängig es zurück, Schritt für Schritt.',
      textEn: 'And no fear of mistakes. If something is gone, Undo brings it back, step by step.',
      run: async (s) => {
        // The player of scene 10 may still run; Ende shows all stitches again.
        await s.page.keyboard.press('End');
        await s.move([1000, 700], 1.0);
        await s.press('Control+a', { label: 'Strg+A', show: 0.6 });
        await s.press('Delete', { label: 'Entf', show: 1.4 });
        await s.click(btn(s, 'Rückgängig'), { move: 1.2, before: 0.4 });
        await s.move([960, 700], 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: '[warm] Alles bleibt in deinem Browser. Deine Dateien verlassen nie dein Gerät, und beim nächsten Besuch ist alles noch da. [proud, warm] Viel Spaß beim Sticken!',
      text: 'Alles bleibt in deinem Browser. Deine Dateien verlassen nie dein Gerät, und beim nächsten Besuch ist alles noch da. Viel Spaß beim Sticken!',
      textEn: 'Everything stays in your browser. Your files never leave your device, and on your next visit everything is still there. Have fun embroidering!',
      run: async (s) => {
        await s.press('Escape', { show: 0 });
        await s.move([1300, 760], 1.4);
        await s.wait(4.0);
      },
    },
  ],
};

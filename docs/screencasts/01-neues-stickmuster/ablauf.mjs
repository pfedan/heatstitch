// Teil 1: Ein neues Stickmuster. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Ziel: ein runder Aufnäher mit einer Welle. Bei 1920 × 1080 und dem Stickrahmen 100 × 100 mm
// liegt die Mitte des Rahmens bei (975, 564), etwa 9,2 Pixel pro Millimeter.

const btn = (s, name) => s.page.getByRole('button', { name }).first();
const card = (s) => s.page.getByRole('region', { name: 'Objekt' });
// The thread button of the Objekt card is named after the thread ("Garn dieses Objekts wählen: 1. Tangerine").
const thread = (s) => btn(s, /^Garn dieses Objekts/);

// Circle dragged corner to corner with the option Kreis, then typed to 60 mm.
const circle = [[735, 324], [1215, 804]];
// The wave: a corner at the start, then four curves, each dragged to the right.
const wave = [[730, 600], [850, 530], [975, 600], [1100, 530], [1220, 600]];

/** Picks a thread from the open thread picker (swatches are buttons named "405 Blue" and so on). */
const pick = async (s, pass, name) => {
  await s.move(btn(s, pass), 0.7);
  await s.wait(0.3);
  await s.click(btn(s, name), { move: 0.5, before: 0.4 });
};

export default {
  title: 'Ein neues Stickmuster',
  part: 1,
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
      say: '[warm, inviting] In diesem Video stickst du dein erstes eigenes Muster: einen runden Aufnäher mit einer Welle. Ein frischer Start fragt: Was möchtest du sticken? Du klickst auf „Leer anfangen“.',
      text: 'In diesem Video stickst du dein erstes eigenes Muster: einen runden Aufnäher mit einer Welle. Ein frischer Start fragt: Was möchtest du sticken? Du klickst auf „Leer anfangen“.',
      textEn: 'In this video you embroider your very first design of your own: a round patch with a wave. A fresh start asks: What would you like to embroider? You click “Start empty”.',
      run: async (s) => {
        const empty = btn(s, /^Leer anfangen/);
        // The start page fades in by a CSS animation with a delay; in the frame-by-frame capture
        // it can stay at opacity 0. Without the animation it shows as for users.
        await s.page.addStyleTag({ content: '.start { animation: none !important; }' });
        await s.move([960, 300], 0.1);
        await s.wait(7.0);
        await s.move(empty, 1.4);
        await s.label('Leer anfangen', empty, 'left');
        await s.wait(1.6);
        await s.click(null, { before: 0.3, after: 0.3 });
        s.unlabel();
      },
    },
    {
      say: 'Der gestrichelte Rahmen ist dein Stickrahmen. Rechts in der Karte Stickmuster stellst du ihn passend zu deiner Maschine ein. Hundert mal hundert Millimeter reichen für den Aufnäher.',
      text: 'Der gestrichelte Rahmen ist dein Stickrahmen. Rechts in der Karte Stickmuster stellst du ihn passend zu deiner Maschine ein. Hundert mal hundert Millimeter reichen für den Aufnäher.',
      textEn: 'The dashed frame is your hoop. On the right, in the Design card, you set it to match your machine. One hundred by one hundred millimetres is enough for the patch.',
      run: async (s) => {
        await s.move([975, 140], 1.0);
        await s.label('Stickrahmen', [975, 103, 0, 0], 'below');
        await s.wait(2.2);
        s.unlabel();
        const tab = s.page.getByRole('tab', { name: 'Stickmuster' });
        const hoop = s.page.getByRole('combobox', { name: 'Stickrahmen' });
        await s.zoom([1760, 200, 0, 0], 1.7);
        await s.move(tab, 1.0);
        await s.label('Karte Stickmuster', tab, 'below');
        await s.wait(1.6);
        await s.move(hoop, 0.9);
        await s.label('Stickrahmen', hoop, 'below');
        await s.wait(4.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Links in der Werkzeugleiste nimmst du die Ellipse. [focused] Oben wählst du „Kreis“ und ziehst ihn auf der Bühne auf. [delighted] Sobald du loslässt, ist er schon gestickt, als Füllung passend zu deinem Stoff.',
      text: 'Links in der Werkzeugleiste nimmst du die Ellipse. Oben wählst du „Kreis“ und ziehst ihn auf der Bühne auf. Sobald du loslässt, ist er schon gestickt, als Füllung passend zu deinem Stoff.',
      textEn: 'In the toolbar on the left you take the ellipse. At the top you choose “Circle” and drag it out on the stage. As soon as you let go, it is already stitched, as a fill suited to your fabric.',
      run: async (s) => {
        const ellipse = btn(s, 'Ellipse');
        await s.zoom([24, 200, 0, 0], 1.6);
        await s.move(ellipse, 1.0);
        await s.label('Ellipse', ellipse, 'right');
        await s.wait(0.8);
        await s.click(null, { before: 0.2, after: 0.3 });
        s.unlabel();
        s.zoomOut();
        const round = btn(s, 'Kreis');
        await s.move(round, 1.0);
        await s.label('Kreis', round, 'below');
        await s.click(null, { before: 0.4, after: 0.4 });
        s.unlabel();
        await s.drag(circle, { sec: 2.4 });
        await s.move([1330, 780], 0.8);
        await s.wait(0.6);
        await s.label('Füllung', [735, 324, 480, 480], 'right');
        await s.wait(3.4);
        s.unlabel();
      },
    },
    {
      say: 'Rechts in der Karte Objekt steht seine Größe. Tipp sechzig Millimeter ein, die Höhe geht mit. Oben beendet „Fertig“ das Bearbeiten der Form.',
      text: 'Rechts in der Karte Objekt steht seine Größe. Tipp sechzig Millimeter ein, die Höhe geht mit. Oben beendet „Fertig“ das Bearbeiten der Form.',
      textEn: 'On the right, in the Object card, you see its size. Type sixty millimetres, the height follows. At the top, “Done” finishes editing the shape.',
      run: async (s) => {
        const width = s.page.getByLabel('Breite in mm');
        await s.zoom([1760, 230, 0, 0], 1.7);
        await s.move(width, 1.0);
        await s.label('Größe', [1626, 210, 270, 18], 'below');
        await s.wait(2.0);
        await s.click(null, { before: 0.3, after: 0.2 });
        // Select the old value; Strg+A would be Cmd+A on a Mac.
        await width.selectText();
        await s.wait(0.4);
        await s.type('60', { perChar: 0.25 });
        await s.press('Enter', { show: 0.9 });
        s.unlabel();
        s.zoomOut();
        const done = btn(s, 'Fertig');
        await s.move(done, 1.2);
        await s.label('Fertig', done, 'below');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
      },
    },
    {
      say: 'Darüber steht das Garn. Ein Klick öffnet die Farben, ich nehme ein kräftiges Blau. Der Kreis wird sofort blau.',
      text: 'Darüber steht das Garn. Ein Klick öffnet die Farben, ich nehme ein kräftiges Blau. Der Kreis wird sofort blau.',
      textEn: 'Above it is the thread. A click opens the colours, I take a strong blue. The circle turns blue right away.',
      run: async (s) => {
        await s.zoom([1600, 250, 0, 0], 1.5);
        await s.move(thread(s), 1.0);
        await s.label('Garn', thread(s), 'below');
        await s.wait(0.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await pick(s, '007 Prussian Blue', 'Cornflower Blue');
        await s.move([1330, 800], 0.9);
        s.zoomOut();
        await s.wait(2.0);
      },
    },
    {
      say: '[focused] Jetzt die Welle, mit dem Pfad. Ein Klick setzt eine Ecke, Ziehen macht eine Rundung. Enter beendet die Linie, dann wieder „Fertig“. Eine Linie wird zuerst im Steppstich gestickt.',
      text: 'Jetzt die Welle, mit dem Pfad. Ein Klick setzt eine Ecke, Ziehen macht eine Rundung. Enter beendet die Linie, dann wieder „Fertig“. Eine Linie wird zuerst im Steppstich gestickt.',
      textEn: 'Now the wave, with the path. A click sets a corner, dragging makes a curve. Enter finishes the line, then “Done” again. A line is stitched as a running stitch at first.',
      run: async (s) => {
        const path = btn(s, 'Pfad');
        await s.move(path, 1.0);
        await s.label('Pfad', path, 'right');
        await s.click(null, { before: 0.3, after: 0.3 });
        s.unlabel();
        await s.click(wave[0], { move: 1.0, after: 0.4 });
        for (const [x, y] of wave.slice(1)) {
          await s.move([x, y], 0.55);
          await s.wait(0.15);
          await s.page.mouse.down();
          await s.move([x + 56, y], 0.45);
          await s.page.mouse.up();
          await s.wait(0.2);
        }
        await s.move([1240, 700], 0.5);
        await s.press('Enter', { show: 0.9 });
        const done = btn(s, 'Fertig');
        await s.move(done, 1.0);
        await s.click(null, { before: 0.3, after: 0.4 });
        await s.move([1290, 720], 0.8);
        await s.label('Steppstich', [730, 530, 490, 70], 'below');
        await s.wait(2.4);
        s.unlabel();
      },
    },
    {
      say: '[enthusiastic] Für eine kräftige Welle stellst du unter Stichart die Art auf Satin. Die Breite ziehst du auf drei Millimeter, und als Garn nimmst du Weiß.',
      text: 'Für eine kräftige Welle stellst du unter Stichart die Art auf Satin. Die Breite ziehst du auf drei Millimeter, und als Garn nimmst du Weiß.',
      textEn: 'For a bold wave, under stitch type you set the type to satin. You drag the width to three millimetres, and for the thread you take white.',
      run: async (s) => {
        const satin = card(s).getByRole('radiogroup', { name: 'Art', exact: true }).getByRole('radio', { name: 'Satin' });
        await s.zoom([1760, 560, 0, 0], 1.6);
        await s.move(s.page.getByText('Stichart', { exact: true }).first(), 1.0);
        await s.label('Stichart', s.page.getByText('Stichart', { exact: true }).first(), 'above');
        await s.wait(1.0);
        await s.move(satin, 0.8);
        await s.label('Satin', satin, 'above');
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        const slider = card(s).getByRole('group').filter({ hasText: 'Breite' }).getByRole('slider').first();
        const b = await s.box(slider);
        const [min, max] = await slider.evaluate((e) => [Number(e.min), Number(e.max)]);
        const at = (v) => [b.x + 8 + ((v - min) / (max - min)) * (b.width - 16), b.y + b.height / 2];
        await s.label('Breite', s.page.getByRole('status', { name: 'Breite' }), 'above');
        await s.drag([at(2), at(3)], { sec: 1.0 });
        // The thumb lands within a step; the arrow keys make it exactly 3,0 mm.
        for (let i = 0; i < 6; i++) {
          const v = Number(await slider.inputValue());
          if (Math.abs(v - 3) < 0.05) break;
          await slider.press(v < 3 ? 'ArrowRight' : 'ArrowLeft');
        }
        await s.wait(0.6);
        s.unlabel();
        await s.zoom([1600, 250, 0, 0], 1.5);
        await s.click(thread(s), { move: 1.0, before: 0.3, after: 0.4 });
        await pick(s, '005 Silver', '001 White');
        await s.move([1330, 800], 0.9);
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: '[curious] Mit der Leertaste spielt unten der Player ab, wie die Maschine stickt: erst den blauen Kreis, dann die weiße Welle.',
      text: 'Mit der Leertaste spielt unten der Player ab, wie die Maschine stickt: erst den blauen Kreis, dann die weiße Welle.',
      textEn: 'With the space bar, the player at the bottom shows how the machine stitches: first the blue circle, then the white wave.',
      run: async (s) => {
        // Let go of the wave, so its frame does not cover the playback, and take the focus off
        // the width slider, which would swallow the space bar.
        await s.page.keyboard.press('Escape');
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.move(btn(s, /^Abspielen/), 1.0);
        await s.label('Player', [360, 1040, 1230, 34], 'above');
        await s.wait(0.8);
        await s.move([975, 900], 0.8);
        s.unlabel();
        await s.page.keyboard.press('Home');
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.4);
      },
    },
    {
      say: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Mit „Realistische Fäden“ siehst du dein Muster so, wie es auf dem Stoff aussehen wird. [impressed] Schön, oder?',
      text: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Mit „Realistische Fäden“ siehst du dein Muster so, wie es auf dem Stoff aussehen wird. Schön, oder?',
      textEn: 'At the bottom right of the stage, the eye opens the view menu. With “Realistic threads” you see your design the way it will look on the fabric. Nice, isn’t it?',
      run: async (s) => {
        // The player may still run; Ende shows all stitches.
        await s.page.keyboard.press('End');
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1430, 760, 0, 0], 1.5);
        await s.move(eye, 1.0);
        await s.label('Ansicht-Menü', eye, 'above');
        await s.click(null, { before: 0.6, after: 0.6 });
        s.unlabel();
        const real = s.page.getByRole('checkbox', { name: 'Realistische Fäden' });
        await s.move(real, 1.0);
        await s.label('Realistische Fäden', s.page.getByText('Realistische Fäden', { exact: true }).first(), 'right');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        await s.page.keyboard.press('Escape');
        s.zoomOut();
        await s.move([1330, 820], 1.0);
        await s.zoom([975, 564, 0, 0], 1.35);
        await s.wait(4.8);
        s.zoomOut();
      },
    },
    {
      say: 'Zum Schluss klickst du oben rechts auf Speichern. Ganz oben steht, dass alles in den Stickrahmen passt. Wähl das Format deiner Maschine, etwa PES für Brother, und speichere. [proud, warm] Fertig ist dein erstes Stickmuster.',
      text: 'Zum Schluss klickst du oben rechts auf Speichern. Ganz oben steht, dass alles in den Stickrahmen passt. Wähl das Format deiner Maschine, etwa PES für Brother, und speichere. Fertig ist dein erstes Stickmuster.',
      textEn: 'Finally, you click Save at the top right. Right at the top it says that everything fits in the hoop. Choose your machine’s format, for example PES for Brother, and save. Your first design is done.',
      run: async (s) => {
        const save = s.page.getByRole('button', { name: 'Speichern', exact: true }).first();
        await s.zoom([1720, 300, 0, 0], 1.5);
        await s.move(save, 1.2);
        await s.label('Speichern', save, 'below');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        const dialog = s.page.getByRole('dialog', { name: 'Speichern' });
        const fits = dialog.getByText(/^Passt in den Stickrahmen/);
        await s.move(fits, 1.0);
        await s.label('Passt in den Stickrahmen', fits, 'left');
        await s.wait(2.4);
        s.unlabel();
        const pes = dialog.getByRole('radio', { name: /^PES/ });
        await s.click(pes, { move: 1.0, before: 0.5 });
        await s.label('PES', pes, 'left');
        await s.wait(1.6);
        s.unlabel();
        const go = dialog.getByRole('button', { name: 'Speichern', exact: true });
        await s.click(go, { move: 1.0, before: 0.5, after: 0.6 });
        s.zoomOut();
        await s.move([1330, 820], 1.2);
        await s.wait(2.4);
      },
    },
  ],
};

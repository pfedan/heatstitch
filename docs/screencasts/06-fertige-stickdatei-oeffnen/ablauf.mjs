// Teil 6: Fertige Stickdatei öffnen. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.

const btn = (s, name) => s.page.getByRole('button', { name }).first();

/**
 * A browser driven by Playwright cannot show a file dragged in from the desktop. A small file
 * card follows the pointer instead, the page gets the same drag events as from a real drop (its
 * overlay „Loslassen zum Öffnen“ shows), and the file is the built-in cat under the name a user
 * would have.
 */
const dragFileIn = async (s, from, to, sec = 1.8) => {
  await s.move(from, 0.7);
  await s.page.evaluate(async ([x, y]) => {
    const blob = await (await fetch('examples/cat-60mm.pes')).blob();
    const file = new File([blob], 'katze.pes');
    const card = document.createElement('div');
    card.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
      'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
      'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
    const icon = document.createElement('div');
    icon.textContent = 'PES';
    icon.style.cssText =
      'width:48px;height:60px;border-radius:6px;border:1px solid #e6e1ea;background:#fbf7fa;display:flex;' +
      'align-items:flex-end;justify-content:center;padding-bottom:8px;box-sizing:border-box;font:700 12px Inter,sans-serif;color:#c2185b';
    const name = document.createElement('span');
    name.textContent = 'katze.pes';
    card.append(icon, name);
    document.body.append(card);
    const place = (px, py) => (card.style.transform = `translate(${px - 18}px, ${py + 14}px)`);
    place(x, y);
    const fire = (type, px, py) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.elementFromPoint(px, py) ?? document.body;
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: px, clientY: py }));
    };
    fire('dragenter', x, y);
    const onMove = (e) => {
      place(e.clientX, e.clientY);
      fire('dragover', e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', onMove, true);
    window.__dropFile = (px, py) => {
      window.removeEventListener('mousemove', onMove, true);
      card.remove();
      fire('dragover', px, py);
      fire('drop', px, py);
      delete window.__dropFile;
    };
  }, from);
  await s.move(to, sec);
  await s.wait(0.6);
  await s.page.evaluate(([x, y]) => window.__dropFile(x, y), to);
};

/** Turns the mouse wheel in small steps, one per frame, so the zoom glides. */
const wheel = async (s, dy, steps = 8) => {
  for (let i = 0; i < steps; i++) {
    await s.page.mouse.wheel(0, dy / steps);
    await s.wait(1 / 30);
  }
};

/** Drags the player knob from one share of the slider to another. */
const slideTo = async (s, from, to, sec = 1.2) => {
  const b = await s.box('#player-pos');
  const at = (f) => [b.x + 8 + f * (b.width - 16), b.y + b.height / 2];
  await s.drag([at(from), at(to)], { sec });
};

export default {
  title: 'Fertige Stickdatei öffnen',
  part: 6,
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
      say: '[warm and inviting] Du hast eine fertige Stickdatei, gekauft, geschenkt oder aus dem Netz? Dann öffne sie in heatstitch und schau genau hin, wie sie gestickt wird.',
      text: 'Du hast eine fertige Stickdatei, gekauft, geschenkt oder aus dem Netz? Dann öffne sie in heatstitch und schau genau hin, wie sie gestickt wird.',
      textEn: 'You have a finished embroidery file, bought, a gift or from the web? Then open it in heatstitch and take a close look at how it is stitched.',
      run: async (s) => {
        await s.move([1180, 300], 0.1);
        await s.wait(8.0);
        await s.move([1180, 420], 1.5);
      },
    },
    {
      say: 'Ein Klick auf „Stickdatei öffnen“ fragt nach der Datei. Das geht mit PES, DST, JEF und den anderen gängigen Formaten. Willst du mitmachen? Die Katze aus diesem Video findest du unter „Weitere Beispiele“.',
      text: 'Ein Klick auf „Stickdatei öffnen“ fragt nach der Datei. Das geht mit PES, DST, JEF und den anderen gängigen Formaten. Willst du mitmachen? Die Katze aus diesem Video findest du unter „Weitere Beispiele“.',
      textEn: 'A click on “Open embroidery file” asks for the file. That works with PES, DST, JEF and the other common formats. Want to follow along? You find the cat from this video under “More examples”.',
      run: async (s) => {
        const open = btn(s, /^Stickdatei öffnen/);
        await s.zoom([975, 590, 0, 0], 1.5);
        await s.move(open, 0.9);
        await s.label('Stickdatei öffnen', open, 'above');
        await s.wait(8.4);
        s.unlabel();
        const cat = btn(s, /^Katze/);
        await s.move(cat, 1.0);
        await s.label('Weitere Beispiele', cat, 'below');
        await s.wait(6.5);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Noch schneller: Zieh die Datei einfach ins Fenster. [short pause] Sie bleibt dabei auf deinem Gerät.',
      text: 'Noch schneller: Zieh die Datei einfach ins Fenster. Sie bleibt dabei auf deinem Gerät.',
      textEn: 'Even quicker: simply drag the file into the window. It stays on your device.',
      run: async (s) => {
        await s.label('ziehen', [1420, 200, 0, 0], 'above');
        await dragFileIn(s, [1420, 200], [980, 300], 2.0);
        s.unlabel();
        await s.move([1180, 560], 1.0);
        await s.wait(2.4);
      },
    },
    {
      say: 'Links stehen die Farben, in der Reihenfolge, in der die Maschine sie stickt: sieben Garne, von Creme bis Dunkelbraun. [curious] Aus den Stichen erkennt heatstitch sogar die einzelnen Objekte.',
      text: 'Links stehen die Farben, in der Reihenfolge, in der die Maschine sie stickt: sieben Garne, von Creme bis Dunkelbraun. Aus den Stichen erkennt heatstitch sogar die einzelnen Objekte.',
      textEn: 'On the left are the colors, in the order the machine stitches them: seven threads, from cream to dark brown. heatstitch even recognizes the separate objects from the stitches.',
      run: async (s) => {
        await s.zoom([200, 290, 0, 0], 1.7);
        // Over a row the other colors fade on the stage; the pointer runs beside the list instead.
        await s.move([200, 80], 1.0);
        await s.label('Farben', [70, 130, 260, 300], 'right');
        await s.move([343, 150], 0.8);
        await s.move([343, 412], 2.6);
        await s.wait(2.8);
        s.unlabel();
        const note = s.page.getByText(/^Alle Objekte sind aus den Stichen erkannt/).first();
        // Over the note too the colors fade; the pointer stays beside it.
        await s.move([343, 462], 0.9);
        await s.label('Objekte', note, 'below');
        await s.wait(3.8);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Rechts in der Karte Stickmuster verrät die Datei, für welchen Stickrahmen sie angelegt ist. Ein Klick auf den Vorschlag, [delighted] und der Rahmen liegt um die Katze. Sie passt, mit reichlich Rand.',
      text: 'Rechts in der Karte Stickmuster verrät die Datei, für welchen Stickrahmen sie angelegt ist. Ein Klick auf den Vorschlag, und der Rahmen liegt um die Katze. Sie passt, mit reichlich Rand.',
      textEn: 'On the right, in the Design card, the file tells you which hoop it was made for. One click on the suggestion, and the hoop sits around the cat. It fits, with plenty of margin.',
      run: async (s) => {
        const pick = s.page.getByText('100 × 100 mm wählen');
        await s.zoom([1760, 230, 0, 0], 1.7);
        await s.move(s.page.getByText('Stickrahmen', { exact: true }).first(), 1.0);
        await s.label('Stickrahmen', s.page.getByText('Stickrahmen', { exact: true }).first(), 'left');
        await s.wait(2.2);
        s.unlabel();
        await s.move(pick, 0.9);
        await s.wait(1.6);
        await s.click(null);
        s.zoomOut();
        await s.move([1060, 560], 1.0);
        await s.wait(1.6);
        const fits = s.page.getByText(/^Passt/).first();
        await s.zoom([1760, 200, 0, 0], 1.7);
        await s.move(fits, 0.9);
        await s.label('passt', fits, 'below');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Mit dem Mausrad zoomst du hinein. [focused] Zeigst du auf einen Stich, steht daneben, der wievielte er ist, welche Stichart und wie lang. Ziehen verschiebt das Bild, „Einpassen“ zeigt wieder alles.',
      text: 'Mit dem Mausrad zoomst du hinein. Zeigst du auf einen Stich, steht daneben, der wievielte er ist, welche Stichart und wie lang. Ziehen verschiebt das Bild, „Einpassen“ zeigt wieder alles.',
      textEn: 'Zoom in with the mouse wheel. Point at a stitch and it tells you which number it is, its stitch type and its length. Dragging moves the view, “Fit” shows everything again.',
      run: async (s) => {
        await s.move([960, 470], 1.0);
        s.keyCap('Mausrad');
        await wheel(s, -500, 24);
        s.keyCap(null);
        await s.wait(0.6);
        await s.move([975, 455], 0.8);
        await s.zoom([1040, 455, 0, 0], 1.6);
        await s.wait(3.0);
        await s.move([905, 540], 0.9);
        await s.wait(2.0);
        s.zoomOut();
        await s.wait(0.4);
        await s.drag([[1100, 700], [1000, 560]], { sec: 1.0 });
        await s.wait(0.5);
        const fit = btn(s, 'Einpassen');
        await s.label('Einpassen', fit, 'above');
        await s.click(fit, { move: 1.0, before: 0.6 });
        s.unlabel();
        await s.move([1060, 560], 0.8);
        await s.wait(0.6);
      },
    },
    {
      say: '[enthusiastic] Und jetzt das Schönste: Drück die Leertaste, und die Maschine stickt vor deinen Augen, Farbe für Farbe. Erst Creme, dann Orange, Gold und das rote Strickzeug.',
      text: 'Und jetzt das Schönste: Drück die Leertaste, und die Maschine stickt vor deinen Augen, Farbe für Farbe. Erst Creme, dann Orange, Gold und das rote Strickzeug.',
      textEn: 'And now the best part: press the space bar, and the machine stitches before your eyes, color by color. First cream, then orange, gold and the red knitting.',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('Home', { label: 'Pos1', show: 0.5 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.move([1250, 700], 3.0);
        await s.wait(10.0);
      },
    },
    {
      say: 'Unten im Player steht, beim wievielten Stich du bist und wie lange die Maschine bis hierher braucht. Den Regler ziehst du einfach hin und her. Die Knöpfe daneben springen von Farbe zu Farbe.',
      text: 'Unten im Player steht, beim wievielten Stich du bist und wie lange die Maschine bis hierher braucht. Den Regler ziehst du einfach hin und her. Die Knöpfe daneben springen von Farbe zu Farbe.',
      textEn: 'Down in the player you see which stitch you are at and how long the machine takes up to here. Just drag the slider back and forth. The buttons next to it jump from color to color.',
      run: async (s) => {
        await s.press(' ', { label: 'Leertaste', show: 0.8 });
        const count = s.page.locator('.pi-count');
        await s.zoom([1100, 1040, 0, 0], 1.6);
        await s.move(count, 1.0);
        await s.label('Stich und Zeit', count, 'above');
        await s.wait(3.4);
        s.unlabel();
        await slideTo(s, 0.55, 0.2, 1.4);
        await slideTo(s, 0.2, 0.7, 1.4);
        s.zoomOut();
        await s.zoom([600, 1040, 0, 0], 1.6);
        const next = btn(s, 'Zur nächsten Farbe');
        await s.label('nächste Farbe', next, 'above');
        await s.click(next, { move: 1.0, before: 0.4, after: 0.9 });
        await s.click(next, { move: 0.1, before: 0.2, after: 0.9 });
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Zeigst du links auf eine Farbe, tritt der Rest zurück, [delighted] und du siehst genau, was in Rot gestickt wird. Mit dem Auge blendest du eine Farbe aus, hier das Dunkelbraun der Konturen. „Alle zeigen“ holt sie zurück.',
      text: 'Zeigst du links auf eine Farbe, tritt der Rest zurück, und du siehst genau, was in Rot gestickt wird. Mit dem Auge blendest du eine Farbe aus, hier das Dunkelbraun der Konturen. „Alle zeigen“ holt sie zurück.',
      textEn: 'Point at a color on the left and the rest steps back, so you see exactly what is stitched in red. The eye hides a color, here the dark brown of the outlines. “Show all” brings it back.',
      run: async (s) => {
        await s.page.keyboard.press('End');
        await s.move([200, 285], 1.2);
        await s.label('Rot', [70, 268, 260, 34], 'right');
        await s.wait(4.5);
        s.unlabel();
        await s.move([200, 371], 0.8);
        const eye = s.page.getByRole('button', { name: 'Ausblenden' }).first();
        await s.label('Auge', eye, 'right');
        await s.click(eye, { move: 0.7, before: 0.4 });
        s.unlabel();
        await s.move([1060, 470], 1.2);
        await s.wait(4.0);
        const all = s.page.getByText('Alle zeigen');
        await s.label('Alle zeigen', all, 'right');
        await s.click(all, { move: 1.2, before: 0.5 });
        s.unlabel();
        await s.move([700, 300], 1.0);
      },
    },
    {
      say: '[proud and warm] Im Ansicht-Menü, unter dem Auge unten rechts, schaltest du „Realistische Fäden“ ein. So siehst du schon vorher, wie die Katze auf dem Stoff wirkt. Jetzt kennst du deine Datei, bevor du etwas an ihr änderst.',
      text: 'Im Ansicht-Menü, unter dem Auge unten rechts, schaltest du „Realistische Fäden“ ein. So siehst du schon vorher, wie die Katze auf dem Stoff wirkt. Jetzt kennst du deine Datei, bevor du etwas an ihr änderst.',
      textEn: 'In the view menu, under the eye at the bottom right, you turn on “Realistic threads”. So you see in advance how the cat looks on the fabric. Now you know your file before you change anything in it.',
      run: async (s) => {
        // The eye button is named after the look that is on (Stiche, Realistisch …).
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1430, 800, 0, 0], 1.5);
        await s.label('Ansicht-Menü', eye, 'above');
        await s.click(eye, { move: 1.2, before: 0.4 });
        s.unlabel();
        const real = s.page.getByLabel('Realistische Fäden');
        await s.label('Realistische Fäden', real, 'left');
        await s.click(real, { move: 0.9, before: 0.4 });
        s.unlabel();
        await s.wait(0.6);
        await s.press('Escape', { show: 0 });
        await s.click(btn(s, 'Markierungen zeigen'), { move: 0.7 });
        s.zoomOut();
        // The light follows the pointer; from the upper left the threads look deep and shiny.
        await s.move([620, 260], 1.6);
        await s.zoom([975, 560, 0, 0], 1.4);
        await s.wait(7.0);
        s.zoomOut();
        await s.wait(1.0);
      },
    },
  ],
};

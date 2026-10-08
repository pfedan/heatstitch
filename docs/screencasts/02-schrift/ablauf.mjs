// Teil 2: Schrift. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit englischer
// Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die Szenenlänge.
// `text` und `textEn` sind die Untertitel, ohne Regie.

const btn = (s, name) => s.page.getByRole('button', { name }).first();
const card = (s) => s.page.getByRole('complementary').last();
const height = (s) => s.page.getByRole('spinbutton', { name: 'Höhe der Großbuchstaben' });
// The sliders of the lettering card have no name of their own; each sits in a row with its
// status (Radius, Buchstabenabstand).
const rowOf = (s, name) =>
  s.page.getByRole('status', { name }).locator('xpath=ancestor::*[.//input[@type="range"]][1]');
const sliderOf = (s, name) => rowOf(s, name).locator('input[type=range]');

/** Scrolls a list with the mouse wheel, a little per frame, until `item` is in its middle. */
const scrollTo = async (s, list, item, { step = 45 } = {}) => {
  for (let i = 0; i < 200; i++) {
    const lb = await list.boundingBox();
    const ib = await item.boundingBox();
    const d = ib.y + ib.height / 2 - (lb.y + lb.height / 2);
    if (Math.abs(d) < 8) break;
    await s.page.mouse.wheel(0, Math.max(-step, Math.min(step, d)));
    await s.wait(1 / 30);
  }
};

/** The x position of a range input's thumb at `value`. */
const thumbAt = async (s, slider, value) => {
  const b = await slider.boundingBox();
  const [min, max] = await slider.evaluate((el) => [Number(el.min), Number(el.max)]);
  const thumb = 16;
  return b.x + thumb / 2 + ((value - min) / (max - min)) * (b.width - thumb);
};

/**
 * Where the stitches are, read from the stage canvas: `point` lies well inside the leftmost
 * stroke (a sure hit for a double click), `box` holds all of them.
 */
const stitches = (s) =>
  s.page.evaluate(() => {
    const c = [...document.querySelectorAll('main canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = c.getBoundingClientRect();
    const { width: w, height: h } = c;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    // Thread colors are saturated; stage, hoop, markers and handles are not.
    const thread = (x, y) => {
      const i = (y * w + x) * 4;
      return Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 90;
    };
    const fx = r.width / w;
    const fy = r.height / h;
    let point = null;
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    for (let x = 6; x < w - 6; x += 2)
      for (let y = 6; y < h - 6; y += 2) {
        if (!thread(x, y)) continue;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        if (point) continue;
        let inside = true;
        for (let dx = -6; dx <= 6 && inside; dx += 2) for (let dy = -6; dy <= 6 && inside; dy += 2) inside = thread(x + dx, y + dy);
        if (inside) point = [r.x + (x + 4) * fx, r.y + y * fy];
      }
    return { point, box: [r.x + x0 * fx, r.y + y0 * fy, (x1 - x0) * fx, (y1 - y0) * fy] };
  });

/** A key the viewer needs not see (closing a menu, leaving a field). */
const quietKey = async (s, key) => {
  await s.page.keyboard.press(key);
  await s.wait(0.3);
};

export default {
  title: 'Schrift',
  part: 2,
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
      say: '[inviting] Ein Name auf dem Lätzchen, ein Gruß auf dem Kissen: Mit heatstitch stickst du Schrift in wenigen Schritten. Auf der Startseite fange ich leer an.',
      text: 'Ein Name auf dem Lätzchen, ein Gruß auf dem Kissen: Mit heatstitch stickst du Schrift in wenigen Schritten. Auf der Startseite fange ich leer an.',
      textEn: 'A name on a bib, a greeting on a pillow: with heatstitch you embroider lettering in a few steps. On the start page I start empty.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(8.0);
        const empty = btn(s, /^Leer anfangen/);
        await s.move(empty, 1.0);
        await s.label('Leer anfangen', empty, 'above');
        await s.wait(1.2);
        s.unlabel();
        await s.click(null, { before: 0.2, after: 0.6 });
        await s.move([975, 700], 0.8);
      },
    },
    {
      say: 'Links in der Werkzeugleiste wählst du Text, oder du drückst die Taste T. Gleich steht ein Schriftzug auf der Bühne. Rechts in der Karte Objekt ist das Feld Text schon bereit. Ich tippe einfach los.',
      text: 'Links in der Werkzeugleiste wählst du Text, oder du drückst die Taste T. Gleich steht ein Schriftzug auf der Bühne. Rechts in der Karte Objekt ist das Feld Text schon bereit. Ich tippe einfach los.',
      textEn: 'In the toolbar on the left you choose Text, or you press the T key. Right away there is lettering on the stage. On the right, in the Object card, the Text field is already waiting. I just start typing.',
      run: async (s) => {
        const tool = s.page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name: 'Text', exact: true });
        await s.zoom([24, 300, 0, 0], 1.6);
        await s.move(tool, 1.0);
        await s.wait(1.0);
        await s.label('Text', tool, 'right');
        await s.wait(1.6);
        s.unlabel();
        await s.move([700, 640], 0.8);
        s.zoomOut();
        await s.press('t', { label: 'T', show: 0.9 });
        await s.wait(3.2);
        const field = s.page.getByRole('textbox', { name: 'Text' });
        await s.zoom([1760, 200, 0, 0], 1.6);
        await s.move(field, 1.0);
        await s.wait(1.6);
        await s.label('Text', field, 'below');
        await s.wait(2.0);
        s.unlabel();
        await s.type('Emilia', { perChar: 0.14 });
        await s.wait(0.6);
        s.zoomOut();
        await s.move([975, 640], 0.9);
      },
    },
    {
      say: 'Ein Klick auf Schrift öffnet die Liste. [delighted] Jede Schrift zeigt gleich dein Wort, so siehst du sofort, was passt. Ich scrolle zur Schreibschrift und nehme Pacificlo.',
      text: 'Ein Klick auf Schrift öffnet die Liste. Jede Schrift zeigt gleich dein Wort, so siehst du sofort, was passt. Ich scrolle zur Schreibschrift und nehme Pacificlo.',
      textEn: 'A click on Font opens the list. Every font shows your word right away, so you see at once what fits. I scroll to the script fonts and take Pacificlo.',
      run: async (s) => {
        const font = btn(s, 'Barstitch regular');
        await s.zoom([1760, 450, 0, 0], 1.5);
        await s.move(font, 1.4);
        await s.label('Schrift', font, 'above');
        await s.click(null, { before: 0.4, after: 0.4 });
        await s.wait(0.6);
        s.unlabel();
        const list = s.page.getByRole('listbox', { name: 'Schrift' });
        await s.move([1760, 560], 0.8);
        await s.wait(3.6);
        const pick = s.page.getByRole('option', { name: 'Pacificlo' });
        await scrollTo(s, list, pick);
        await s.wait(0.8);
        await s.click(pick, { move: 0.7, before: 0.4, after: 0.4 });
        s.zoomOut();
        await s.move([975, 700], 0.9);
        await s.wait(1.0);
      },
    },
    {
      say: 'Mit Größe stellst du die Höhe der Großbuchstaben ein, in Millimetern. Darunter steht, welche Größen für diese Schrift gut sind, dazu die Maße und wie viele Stiche es werden. Ich nehme zwanzig.',
      text: 'Mit Größe stellst du die Höhe der Großbuchstaben ein, in Millimetern. Darunter steht, welche Größen für diese Schrift gut sind, dazu die Maße und wie viele Stiche es werden. Ich nehme zwanzig.',
      textEn: 'Size sets the height of the capital letters, in millimetres. Below it you see which sizes suit this font, plus the dimensions and how many stitches it takes. I take twenty.',
      run: async (s) => {
        const field = height(s);
        await s.zoom([1760, 390, 0, 0], 1.7);
        await s.move(field, 1.0);
        await s.label('Größe', field, 'above');
        await s.wait(3.2);
        s.unlabel();
        await s.move(card(s).getByText(/^Gut von/), 0.9);
        await s.wait(2.8);
        await s.move(card(s).getByText(/mm · .* Stiche/), 0.8);
        await s.wait(2.4);
        await s.click(field, { move: 0.7, before: 0.2, after: 0.2 });
        await field.selectText();
        await s.type('20', { perChar: 0.2 });
        await quietKey(s, 'Enter');
        s.zoomOut();
        await s.move([975, 720], 0.9);
        await s.wait(1.4);
      },
    },
    {
      say: '[curious] Jetzt der Bogen. Bogen oben wölbt den Namen nach oben, [delighted] wie ein Regenbogen. Daneben gibt es Bogen unten und Kreis. Mit Radius machst du den Bogen flacher oder runder.',
      text: 'Jetzt der Bogen. Bogen oben wölbt den Namen nach oben, wie ein Regenbogen. Daneben gibt es Bogen unten und Kreis. Mit Radius machst du den Bogen flacher oder runder.',
      textEn: 'Now the arc. Arc top curves the name upwards, like a rainbow. Next to it are Arc bottom and Circle. Radius makes the arc flatter or rounder.',
      run: async (s) => {
        const radio = (name) => s.page.getByRole('radio', { name });
        await s.zoom([1760, 500, 0, 0], 1.6);
        await s.move(radio('Bogen oben'), 1.0);
        await s.label('Bogen', s.page.getByRole('radiogroup', { name: 'Bogen' }), 'above');
        await s.wait(0.9);
        await s.label('Bogen oben', radio('Bogen oben'), 'above');
        await s.click(null, { before: 0.6, after: 0.3 });
        s.unlabel();
        s.zoomOut();
        await s.move([975, 720], 0.9);
        await s.wait(2.6);
        await s.zoom([1760, 500, 0, 0], 1.6);
        await s.move(radio('Bogen unten'), 0.9);
        await s.label('Bogen unten', radio('Bogen unten'), 'above');
        await s.wait(1.0);
        await s.move(radio('Kreis'), 0.6);
        await s.label('Kreis', radio('Kreis'), 'above');
        await s.wait(1.0);
        await s.move(sliderOf(s, 'Radius'), 0.8);
        await s.label('Radius', sliderOf(s, 'Radius'), 'below');
        await s.wait(2.6);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Darunter liegt der Buchstabenabstand. Nach rechts bekommen die Buchstaben mehr Luft, nach links rücken sie zusammen. Ein kleines Stück reicht.',
      text: 'Darunter liegt der Buchstabenabstand. Nach rechts bekommen die Buchstaben mehr Luft, nach links rücken sie zusammen. Ein kleines Stück reicht.',
      textEn: 'Below it is the letter spacing. To the right the letters get more room, to the left they move closer. A little is enough.',
      run: async (s) => {
        const slider = sliderOf(s, 'Buchstabenabstand');
        const y = (await s.box(slider)).y + 8;
        const from = await thumbAt(s, slider, 0);
        // Stage and card together, so the letters move while the thumb does.
        await s.zoom([1300, 560, 0, 0], 1.3);
        await s.move([from, y], 1.0);
        await s.label('Buchstabenabstand', rowOf(s, 'Buchstabenabstand'), 'above');
        await s.wait(2.4);
        s.unlabel();
        await s.drag([[from, y], [await thumbAt(s, slider, 1.8), y], [await thumbAt(s, slider, 0.6), y]], { sec: 1.6 });
        s.zoomOut();
        await s.move([975, 720], 1.0);
        await s.wait(0.8);
      },
    },
    {
      say: 'Unter Garn und Stiche wählst du das Garn. Ein Klick zeigt die Farben deiner Garnmarke. Ich nehme ein kräftiges Rosa. Links unter Farben und Objekte wechselt die Farbe mit.',
      text: 'Unter Garn und Stiche wählst du das Garn. Ein Klick zeigt die Farben deiner Garnmarke. Ich nehme ein kräftiges Rosa. Links unter Farben und Objekte wechselt die Farbe mit.',
      textEn: 'Under Thread and stitches you choose the thread. A click shows the colors of your thread brand. I take a strong pink. On the left, under Colors and objects, the color changes too.',
      run: async (s) => {
        const thread = btn(s, /^Red$/);
        await s.zoom([1600, 720, 0, 0], 1.5);
        await s.move(thread, 1.0);
        await s.wait(1.0);
        await s.label('Garn', thread, 'above');
        await s.wait(1.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await s.wait(2.6);
        await s.click(btn(s, '086 Deep Rose'), { move: 1.2, before: 0.6, after: 0.4 });
        s.zoomOut();
        const heading = s.page.getByRole('heading', { name: 'Farben und Objekte' });
        await s.move(s.page.getByRole('button', { name: 'Garnfarbe ändern' }), 1.0);
        await s.label('Farben und Objekte', heading, 'right');
        await s.wait(3.0);
        s.unlabel();
      },
    },
    {
      say: 'Und später? [warm] Der Schriftzug bleibt Text. Ein Doppelklick darauf, und das Feld Text ist wieder bereit. Ich tippe Jonas. [pleased] Schrift, Größe, Bogen und Garn bleiben, wie sie waren. Auch eine andere Schrift wählst du jederzeit.',
      text: 'Und später? Der Schriftzug bleibt Text. Ein Doppelklick darauf, und das Feld Text ist wieder bereit. Ich tippe Jonas. Schrift, Größe, Bogen und Garn bleiben, wie sie waren. Auch eine andere Schrift wählst du jederzeit.',
      textEn: 'And later? The lettering stays text. A double click on it and the Text field is ready again. I type Jonas. Font, size, arc and thread stay as they were. You can pick another font any time, too.',
      run: async (s) => {
        // Nothing selected: the lettering is done for now. The first Escape leaves the shape,
        // the second the selection.
        await s.page.evaluate(() => document.activeElement?.blur());
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.move([980, 840], 1.0);
        await s.wait(1.4);
        const { point } = await stitches(s);
        await s.click(point, { move: 1.0, before: 0.3, after: 0 });
        await s.page.mouse.down({ clickCount: 2 });
        await s.page.mouse.up({ clickCount: 2 });
        await s.wait(0.6);
        const field = s.page.getByRole('textbox', { name: 'Text' });
        await s.zoom([1760, 380, 0, 0], 1.5);
        await s.move(field, 0.8);
        await s.label('Text', field, 'below');
        await s.wait(1.4);
        s.unlabel();
        await s.type('Jonas', { perChar: 0.16 });
        await s.wait(0.8);
        // Font, size, arc and thread, as the voice names them.
        for (const [target, sec] of [
          [btn(s, 'Pacificlo'), 0.9],
          [height(s), 0.8],
          [s.page.getByRole('radio', { name: 'Bogen oben' }), 0.8],
          [btn(s, /^Deep Rose$/), 1.0],
        ]) {
          await s.move(target, 0.6);
          await s.wait(sec);
        }
        s.zoomOut();
        await s.move([975, 840], 1.0);
        await s.wait(1.4);
      },
    },
    {
      say: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Ich schalte Realistische Fäden ein. [delighted] So sieht dein Schriftzug fertig gestickt aus. Mit der Leertaste siehst du, wie die Maschine ihn Stich für Stich stickt. [warm] Viel Spaß beim Sticken!',
      text: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Ich schalte Realistische Fäden ein. So sieht dein Schriftzug fertig gestickt aus. Mit der Leertaste siehst du, wie die Maschine ihn Stich für Stich stickt. Viel Spaß beim Sticken!',
      textEn: 'At the bottom right of the stage, the eye opens the view menu. I turn on Realistic threads. This is how your lettering looks when it is stitched. The space bar shows you how the machine stitches it, stitch by stitch. Have fun embroidering!',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await quietKey(s, 'Escape');
        // Measured in the flat stitch view, before the threads get their sheen.
        const { box } = await stitches(s);
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1430, 800, 0, 0], 1.4);
        await s.move(eye, 1.0);
        await s.wait(1.2);
        await s.label('Ansicht-Menü', eye, 'above');
        await s.wait(1.4);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        const real = s.page.getByRole('checkbox', { name: 'Realistische Fäden' });
        await s.move(real, 1.0);
        await s.label('Realistische Fäden', real, 'above');
        await s.click(null, { before: 0.6, after: 0.6 });
        s.unlabel();
        await quietKey(s, 'Escape');
        await s.move([1300, 900], 1.0);
        await s.zoom(box, 1.5);
        await s.wait(2.4);
        await s.press('Home', { label: 'Pos1', show: 0.4 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(4.4);
        s.zoomOut();
        await s.wait(1.0);
      },
    },
  ],
};

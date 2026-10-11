// Teil 17: Logo nachsticken. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit
// englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Daniels Logo liegt nur als Bild vor (material/vorlage.png). Es kommt mit „Nur abpausen“ als
// Vorlage unter ein neues Stickmuster und wird Teil für Teil nachgezeichnet. Die Punkte auf der
// Vorlage stehen in Tausendsteln ihrer Breite (0 bis 1000, oben links 0); `onImage` rechnet sie
// auf den Bildschirm um, für die Vorlage in 80 mm (wie sie kommt) und in 160 mm (nach dem
// Einstellen, Stickrahmen 130 × 180, die Bühne passt sich auf 127 % an).
import fs from 'node:fs';

const IMAGE = new URL('./material/vorlage.png', import.meta.url);
const PROJECT = new URL('./material/heatstitch-logo.heatstitch', import.meta.url).pathname;

const btn = (s, name) => s.page.getByRole('button', { name }).first();
const card = (s) => s.page.locator('#inspector');
const tool = (s, name) => s.page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name, exact: true });

// Image box on the stage: [left, top, size in px].
const AT_80 = [628.5, 213.5, 692];
const AT_160 = [590, 176, 768];
const onImage = (box, [fx, fy]) => [box[0] + (box[2] * fx) / 1000, box[1] + (box[2] * fy) / 1000];

// Stretches the waits and glides of a scene to the pace of its take.
const paced = (r, run) => (s) =>
  run({ ...s, wait: (sec) => s.wait(sec * r), move: (target, sec = 0.8) => s.move(target, sec * r) });

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/** Where a slider's thumb sits for `value`. */
const thumbAt = async (s, sl, value) => {
  const b = await sl.boundingBox();
  const [min, max] = await sl.evaluate((e) => [Number(e.min), Number(e.max)]);
  return [b.x + 8 + ((b.width - 16) * (value - min)) / (max - min), b.y + b.height / 2];
};

/** Opens the thread picker from `chip`, searches `name` and clicks its swatch. */
const pickThread = async (s, chip, name) => {
  await s.click(chip, { move: 0.8, before: 0.2, after: 0.4 });
  const search = s.page.getByPlaceholder('Nummer oder Name');
  await s.click(search, { move: 0.6, before: 0.1, after: 0.1 });
  await s.type(name, { perChar: 0.1 });
  const swatch = s.page.getByRole('button', { name: new RegExp(`^\\d+ ${name}$`) }).first();
  await s.wait(0.4);
  await s.label(name, swatch, 'below');
  await s.click(swatch, { move: 0.7, before: 0.3, after: 0.4 });
  s.unlabel();
  await s.page.keyboard.press('Escape');
  await s.wait(0.3);
};

/**
 * A point on a bright stitch inside [x0, y0, x1, y1] of the stage, read from its canvas. The
 * template lies dimmed below, so only fresh thread is this bright. A drag that starts there
 * moves the object instead of the stage.
 */
const stitchIn = (s, [x0, y0, x1, y1]) =>
  s.page.evaluate(([x0, y0, x1, y1]) => {
    const c = [...document.querySelectorAll('main canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = c.getBoundingClientRect();
    const fx = c.width / r.width;
    const fy = c.height / r.height;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const bright = (x, y) => {
      const i = (Math.round(y * fy) * c.width + Math.round(x * fx)) * 4;
      return d[i] + d[i + 1] + d[i + 2] > 600;
    };
    for (let x = x0; x <= x1; x += 1)
      for (let y = y0; y <= y1; y += 1) {
        if (!bright(x - r.x, y - r.y)) continue;
        let n = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) n += bright(x - r.x + dx, y - r.y + dy);
        if (n >= 25) return [x + 2, y + 2];
      }
    return null;
  }, [x0, y0, x1, y1]);

/** A key the viewer need not see. */
const quietKey = async (s, key) => {
  await s.page.keyboard.press(key);
  await s.wait(0.2);
};

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app, with the same drag events and the real file.
 */
const dragFileIn = async (s, from, to) => {
  const b64 = fs.readFileSync(IMAGE).toString('base64');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'vorlage.png', { type: 'image/png' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${b64}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid #e6e1ea';
      const name = document.createElement('span');
      name.textContent = 'vorlage.png';
      card.append(img, name);
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
    },
    { b64, x: from[0], y: from[1] },
  );
  await s.move(to, 1.6);
  await s.wait(0.5);
  await s.page.evaluate(([x, y]) => window.__dropFile(x, y), to);
};

// Corners of the left bar of the H, clockwise from the top left.
const BAR = [[283, 163], [392, 188], [407, 214], [407, 616], [392, 636], [283, 657]];
// One strand of the thread band, from the left bar up to the eye of the needle.
const STRAND = [[290, 430], [320, 385], [360, 350], [420, 330], [490, 340], [560, 385], [620, 420], [670, 432], [705, 405], [728, 330], [722, 265], [708, 238]];
// Where the pointer rests while the voice speaks: on the stage, off the logo.
const REST = [1480, 900];

export default {
  title: 'Logo nachsticken',
  part: 17,
  voice: {
    model: 'google/gemini-3.1-flash-tts',
    voice: 'Gacrux',
    language: 'de-DE',
    prompt:
      'Speak German like a seasoned embroidery master teaching a workshop: mature, composed, precise, quietly authoritative but kind. Every word placed with care, with understated pride.',
  },
  lead: 0.4,
  tail: 0.6,
  scenes: [
    {
      say: '[warm] Ein Logo, das es nur als Bild gibt, zeichnest du in heatstitch nach und bestimmst jede Fläche selbst. Auf der Startseite klicke ich auf „Bild umwandeln“ und ziehe das Bild ins Fenster.',
      text: 'Ein Logo, das es nur als Bild gibt, zeichnest du in heatstitch nach und bestimmst jede Fläche selbst. Auf der Startseite klicke ich auf „Bild umwandeln“ und ziehe das Bild ins Fenster.',
      textEn: 'A logo that only exists as a picture you trace in heatstitch, deciding every area yourself. On the start page I click “Convert image” and drag the picture into the window.',
      run: paced(1.25, async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(5.6);
        const start = btn(s, /^Bild umwandeln/);
        await s.move(start, 1.0);
        await s.label('Bild umwandeln', start, 'above');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        await s.wait(0.6);
        await dragFileIn(s, [1912, 760], [1110, 560]);
        await until(s, async () => (await s.page.getByText(/^vorlage, /).count()) > 0, 'image loaded');
        await s.move([1180, 640], 1.0);
        await s.wait(0.8);
      }),
    },
    {
      say: 'Statt Stiche daraus zu rechnen, klicke ich auf „Nur abpausen“. Das Bild liegt jetzt blass als Vorlage unter einem neuen Stickmuster. Gestickt wird es nie.',
      text: 'Statt Stiche daraus zu rechnen, klicke ich auf „Nur abpausen“. Das Bild liegt jetzt blass als Vorlage unter einem neuen Stickmuster. Gestickt wird es nie.',
      textEn: 'Instead of computing stitches from it, I click “Trace only”. The picture now lies faintly as a template under a new design. It is never stitched.',
      run: paced(1.4, async (s) => {
        const trace = btn(s, 'Nur abpausen');
        await s.move(trace, 1.2);
        await s.label('Nur abpausen', trace, 'above');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        await until(s, async () => (await s.page.getByRole('tab', { name: 'Stickmuster' }).count()) > 0 && (await card(s).getByText('Vorlage', { exact: true }).count()) > 0, 'traced');
        await s.move([975, 300], 1.2);
        await s.wait(1.4);
        const head = card(s).getByText('Vorlage', { exact: true }).first();
        await s.move(head, 1.2);
        await s.label('Vorlage', head, 'below');
        await s.wait(2.2);
        s.unlabel();
        await s.move(REST, 1.2);
      }),
    },
    {
      say: 'Mit der Taste L messe ich das H: knapp 40 Millimeter. Mein Logo soll doppelt so groß werden. Rechts stelle ich die Breite der Vorlage auf 160 Millimeter und wähle den Stickrahmen 130 mal 180.',
      text: 'Mit der Taste L messe ich das H: knapp 40 Millimeter. Mein Logo soll doppelt so groß werden. Rechts stelle ich die Breite der Vorlage auf 160 Millimeter und wähle den Stickrahmen 130 mal 180.',
      textEn: 'With the L key I measure the H: just under 40 millimetres. My logo is to be twice that size. On the right I set the width of the template to 160 millimetres and choose the 130 by 180 hoop.',
      run: paced(1.4, async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        const top = onImage(AT_80, [283, 163]);
        const foot = onImage(AT_80, [283, 657]);
        await s.move([top[0] - 60, top[1]], 1.0);
        await s.press('l', { label: 'L', show: 0.9 });
        await s.zoom([top[0], (top[1] + foot[1]) / 2, 0, 0], 1.6);
        await s.move(top, 0.6);
        await s.drag([top, foot], { sec: 1.4 });
        await s.label('39,6 mm', [foot[0] + 10, (top[1] + foot[1]) / 2, 0, 0], 'right');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        // Fertig ends the measuring; the voice need not mention it.
        await btn(s, 'Fertig').evaluate((b) => b.click());
        await s.wait(0.2);
        await s.page.evaluate(() => document.activeElement?.blur());
        const width = card(s).getByText('Breite', { exact: true }).first().locator('xpath=following::input[1]');
        await s.zoom([1760, 330, 0, 0], 1.7);
        await s.click(width, { move: 1.0, before: 0.2, after: 0.2 });
        await width.selectText();
        await s.label('Breite', width, 'left');
        await s.type('160', { perChar: 0.18 });
        await quietKey(s, 'Enter');
        s.unlabel();
        const hoop = s.page.getByLabel('Stickrahmen', { exact: true });
        await s.move(hoop, 0.9);
        await s.label('Stickrahmen', hoop, 'below');
        await s.click(null, { before: 0.3, after: 0.2 });
        await hoop.selectOption({ label: '130 × 180 mm · Brother, Babylock' });
        await quietKey(s, 'Escape');
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.0);
      }),
    },
    {
      say: 'Den linken Balken zeichne ich mit dem Pfad nach: ein Klick für jede Ecke, dann „Zur Fläche schließen“. [pleased] Eine Fläche wird als Füllung gestickt.',
      text: 'Den linken Balken zeichne ich mit dem Pfad nach: ein Klick für jede Ecke, dann „Zur Fläche schließen“. Eine Fläche wird als Füllung gestickt.',
      textEn: 'I trace the left bar with the path: one click for every corner, then “Close to an area”. An area is stitched as a fill.',
      run: paced(1.3, async (s) => {
        await s.click(tool(s, 'Pfad'), { move: 1.0, before: 0.2, after: 0.3 });
        await s.label('Pfad', tool(s, 'Pfad'), 'right');
        await s.wait(0.6);
        s.unlabel();
        const mid = onImage(AT_160, [345, 410]);
        await s.zoom([mid[0], mid[1], 0, 0], 1.7);
        for (const p of BAR) await s.click(onImage(AT_160, p), { move: 0.45, before: 0.1, after: 0.15 });
        const close = btn(s, 'Zur Fläche schließen');
        s.zoomOut();
        await s.move(close, 0.9);
        await s.label('Zur Fläche schließen', close, 'below');
        await s.click(null, { before: 0.4, after: 0.4 });
        s.unlabel();
        await s.move(REST, 1.0);
        await s.wait(1.6);
      }),
    },
    {
      say: 'In der Vorlage laufen die Stiche schräg. Unter Winkel stelle ich die Reihen deshalb auf 60 Grad. Als Garn wähle ich Beige.',
      text: 'In der Vorlage laufen die Stiche schräg. Unter Winkel stelle ich die Reihen deshalb auf 60 Grad. Als Garn wähle ich Beige.',
      textEn: 'In the template the stitches run at a slant. So under Angle I set the rows to 60 degrees. As the thread I choose Beige.',
      run: paced(1.0, async (s) => {
        const mid = onImage(AT_160, [345, 410]);
        await s.zoom([mid[0], mid[1], 0, 0], 1.6);
        await s.move(mid, 1.0);
        await s.wait(1.6);
        s.zoomOut();
        const angle = card(s).locator('label', { hasText: 'Winkel' }).getByRole('slider').first();
        await s.zoom([1760, 560, 0, 0], 1.6);
        const now = Number(await angle.evaluate((e) => e.value));
        await s.move(await thumbAt(s, angle, now), 1.0);
        await s.label('Winkel', card(s).getByText('Winkel', { exact: true }).first(), 'above');
        await s.drag([await thumbAt(s, angle, now), await thumbAt(s, angle, 60)], { sec: 1.2 });
        s.unlabel();
        await s.zoom([1760, 260, 0, 0], 1.6);
        await pickThread(s, s.page.locator('[data-tip="Garn dieses Objekts wählen"]').first(), 'Beige');
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.2);
      }),
    },
    {
      say: 'Für einen Strang des Fadens nehme ich Freihand und ziehe ihn einfach nach. Unter Art wähle ich Satin, als Garn Orange.',
      text: 'Für einen Strang des Fadens nehme ich Freihand und ziehe ihn einfach nach. Unter Art wähle ich Satin, als Garn Orange.',
      textEn: 'For one strand of the thread I take Freehand and simply trace it. Under Type I choose Satin, and Orange as the thread.',
      run: paced(0.9, async (s) => {
        await quietKey(s, 'Escape');
        await s.click(tool(s, 'Freihand'), { move: 1.0, before: 0.2, after: 0.3 });
        await s.label('Freihand', tool(s, 'Freihand'), 'right');
        await s.wait(0.5);
        s.unlabel();
        const mid = onImage(AT_160, [500, 340]);
        await s.zoom([mid[0], mid[1], 0, 0], 1.5);
        const pts = STRAND.map((p) => onImage(AT_160, p));
        await s.move(pts[0], 0.8);
        await s.drag(pts, { sec: 0.22 });
        await s.wait(0.6);
        s.zoomOut();
        const satin = card(s).getByRole('radio', { name: 'Satin', exact: true }).nth(1);
        await s.zoom([1760, 260, 0, 0], 1.6);
        await s.move(satin, 1.0);
        await s.label('Satin', satin, 'below');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        await pickThread(s, s.page.locator('[data-tip="Garn dieses Objekts wählen"]').first(), 'Orange');
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.0);
      }),
    },
    {
      say: 'Fehlt die Schrift. Mit der Taste T steht ein Schriftzug da, ich tippe HEAT. Die Größe stelle ich auf zwölf Millimeter, das Garn auf Beige. Mit Umschalt und Pfeiltaste schiebe ich ihn an seinen Platz.',
      text: 'Fehlt die Schrift. Mit der Taste T steht ein Schriftzug da, ich tippe HEAT. Die Größe stelle ich auf zwölf Millimeter, das Garn auf Beige. Mit Umschalt und Pfeiltaste schiebe ich ihn an seinen Platz.',
      textEn: 'The lettering is missing. With the T key there is lettering on the stage, I type HEAT. I set the size to twelve millimetres, the thread to Beige. With Shift and the arrow key I push it into place.',
      run: paced(1.2, async (s) => {
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('t', { label: 'T', show: 0.9 });
        const field = s.page.getByRole('textbox', { name: 'Text' });
        await until(s, async () => (await field.count()) > 0, 'text field');
        await s.zoom([1760, 200, 0, 0], 1.6);
        await s.move(field, 0.8);
        await field.selectText();
        await s.type('HEAT', { perChar: 0.16 });
        const height = s.page.getByRole('spinbutton', { name: 'Höhe der Großbuchstaben' });
        await s.click(height, { move: 0.8, before: 0.2, after: 0.2 });
        await height.selectText();
        await s.label('Größe', height, 'left');
        await s.type('12', { perChar: 0.2 });
        await quietKey(s, 'Enter');
        s.unlabel();
        const chip = card(s).getByRole('button', { name: /^Orange$/ }).first();
        await pickThread(s, chip, 'Beige');
        s.zoomOut();
        // The new lettering sits in the middle of the hoop, on the line of the template's text.
        // Out of the letters to the whole lettering; Umschalt+← moves it by 1 mm, 38 mm to the
        // left puts it on HEAT in the template.
        await quietKey(s, 'Escape');
        // The lettering, picked in the list so the arrow keys move all of it.
        const list = s.page.locator('aside').first();
        if (!(await list.getByRole('button', { name: /^Schriftzug/ }).count()))
          await list.getByRole('button', { name: /zeigen$/ }).last().evaluate((b) => b.click());
        await list.getByRole('button', { name: /^Schriftzug/ }).first().evaluate((b) => b.click());
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.zoom([880, 755, 0, 0], 1.6);
        await s.move([880, 840], 1.0);
        s.keyCap('Umschalt+←');
        for (let i = 0; i < 38; i++) {
          await s.page.keyboard.press('Shift+ArrowLeft');
          await s.wait(0.05);
        }
        await s.wait(0.5);
        s.keyCap(null);
        await s.wait(0.6);
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(0.6);
      }),
    },
    {
      say: 'Mit Umschalt B blende ich die Vorlage aus. So entsteht das Logo Teil für Teil, den Rest baust du genauso. Mein fertiges Logo öffne ich über das Stickmuster-Menü.',
      text: 'Mit Umschalt+B blende ich die Vorlage aus. So entsteht das Logo Teil für Teil, den Rest baust du genauso. Mein fertiges Logo öffne ich über das Stickmuster-Menü.',
      textEn: 'With Shift+B I hide the template. That is how the logo grows piece by piece; you build the rest the same way. I open my finished logo from the design menu.',
      run: paced(1.1, async (s) => {
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('Shift+B', { label: 'Umschalt+B', show: 1.0 });
        await s.move([980, 520], 1.0);
        await s.wait(4.6);
        const menu = btn(s, /^Neues Stickmuster/);
        await s.zoom([200, 120, 0, 0], 1.6);
        await s.move(menu, 1.0);
        await s.label('Stickmuster-Menü', menu, 'below');
        await s.click(null, { before: 0.4, after: 0.5 });
        s.unlabel();
        const open = s.page.getByText(/^Öffnen/).first();
        await s.move(open, 0.8);
        // The system's file dialog does not show in the recording; the project goes in directly.
        const chooser = s.page.waitForEvent('filechooser');
        await s.click(null, { before: 0.3, after: 0.2 });
        await (await chooser).setFiles(PROJECT);
        s.zoomOut();
        await until(s, async () => (await btn(s, /^Heatstitch-Logo/).count()) > 0, 'project opens');
        await s.move(REST, 1.0);
        await s.wait(1.6);
      }),
    },
    {
      say: 'Ich schalte die realistische Ansicht ein und drücke die Leertaste. [warm] So stickt die Maschine dein Logo, Stich für Stich. Viel Spaß beim Nachsticken!',
      text: 'Ich schalte die realistische Ansicht ein und drücke die Leertaste. So stickt die Maschine dein Logo, Stich für Stich. Viel Spaß beim Nachsticken!',
      textEn: 'I turn on the realistic view and press the space bar. This is how the machine stitches your logo, stitch by stitch. Have fun tracing!',
      run: paced(1.0, async (s) => {
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1420, 900, 0, 0], 1.6);
        await s.click(eye, { move: 1.0, before: 0.3, after: 0.4 });
        const real = s.page.locator('#view-pop').getByText('Realistische Fäden', { exact: true }).first();
        await s.move(real, 0.8);
        await s.click(null, { before: 0.3, after: 0.4 });
        await quietKey(s, 'Escape');
        s.zoomOut();
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.move(REST, 1.0);
        await s.press('Home', { label: 'Pos1', show: 0.4 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(9.0);
      }),
    },
  ],
};

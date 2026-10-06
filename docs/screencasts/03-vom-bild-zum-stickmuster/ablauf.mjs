// Teil 3: Vom Bild zum Stickmuster. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`,
// mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Zwei Dinge zeichnet der Ablauf selbst in die Seite, weil eine Bildschirmaufnahme sie nicht
// zeigt: das Dateikärtchen beim Hineinziehen und die aufgeklappte Liste einer Auswahl (select).
import { fileURLToPath } from 'node:url';

const picture = fileURLToPath(new URL('./material/fliegenpilz.jpg', import.meta.url));

/** Image coordinates (0..1 of the 80 mm picture) to the page, while the view is fitted. */
const at = (u, v) => [475 + 950 * u, 105 + 950 * v];

/** Runs frames until `ready` holds (the workers stitch in real time), at most `max` seconds. */
const until = async (s, ready, max = 60, arg) => {
  for (let i = 0; i < max * 30; i++) {
    if (await s.page.evaluate(ready, arg)) return;
    await s.wait(1 / 30);
  }
  throw new Error('timed out waiting for the app');
};
const stitched = () => {
  const take = document.getElementById('image-take');
  return !!take && !take.disabled && !document.getElementById('image-status')?.textContent;
};
const hasColor = (name) => [...document.querySelectorAll('#image-palette .image-color-name')].some((e) => e.textContent === name);

/** The palette row of a thread, by its exact name. */
const row = (s, name) =>
  s.page.locator('#image-palette > li').filter({ has: s.page.locator('.image-color-name', { hasText: new RegExp(`^${name}$`) }) });

/** Drags a range slider to a value, then nudges it there exactly. */
const slide = async (s, input, value, sec = 1.2) => {
  const b = await s.box(input);
  const min = Number(await input.getAttribute('min'));
  const max = Number(await input.getAttribute('max'));
  const step = Number(await input.getAttribute('step'));
  const x = (v) => [b.x + 8 + ((v - min) / (max - min)) * (b.width - 16), b.y + b.height / 2];
  await s.drag([x(Number(await input.inputValue())), x(value)], { sec });
  for (let i = 0; i < 40; i++) {
    const v = Number(await input.inputValue());
    if (Math.abs(v - value) < step / 2) break;
    await input.press(v < value ? 'ArrowRight' : 'ArrowLeft');
  }
};

/** A file card that follows the pointer, as when a file is dragged in from the desktop. */
const dragFile = async (s, name, from, target, sec = 2.2) => {
  await s.page.evaluate((name) => {
    const card = document.createElement('div');
    card.id = 'sc-file';
    card.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 2h10l4 4v16H5z" fill="#fff" stroke="#888" stroke-width="1.2"/><rect x="7" y="9" width="10" height="8" rx="1" fill="#e2463c"/><circle cx="10" cy="11.5" r="1.1" fill="#fff"/></svg><span>${name}</span>`;
    Object.assign(card.style, {
      position: 'fixed', zIndex: 9999, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 12px 8px 8px', background: 'rgba(255,255,255,0.96)', borderRadius: '8px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.25)', font: '500 15px Inter, system-ui, sans-serif', color: '#222',
    });
    document.body.append(card);
    document.body.classList.add('dragging');
  }, name);
  const place = (x, y) => s.page.evaluate(([x, y]) => Object.assign(document.getElementById('sc-file').style, { left: `${x + 14}px`, top: `${y + 18}px` }), [x, y]);
  await s.move(from, 0.6);
  const to = await s.point(target);
  const n = Math.round(sec * 30);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const x = from[0] + (to.x - from[0]) * e;
    const y = from[1] + (to.y - from[1]) * e;
    await place(x, y);
    await s.move([x, y], 1 / 30);
  }
  await s.wait(0.3);
  await s.page.evaluate(() => {
    document.getElementById('sc-file')?.remove();
    document.body.classList.remove('dragging');
  });
};

/** Clicks a select and shows its options as an open list, then picks one. */
const pickOption = async (s, select, label) => {
  // A real click would open the browser's own list, which takes the input and never shows up in
  // a capture; a transparent cover takes the click instead.
  const options = await select.evaluate((el) => [...el.options].map((o) => o.textContent));
  const b = await s.box(select);
  await s.page.evaluate((b) => {
    const cover = document.createElement('div');
    cover.id = 'sc-cover';
    Object.assign(cover.style, { position: 'fixed', zIndex: 9998, left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px` });
    document.body.append(cover);
  }, b);
  await s.click(select, { move: 0.8 });
  await s.page.evaluate(
    ({ options, b }) => {
      const list = document.createElement('div');
      list.id = 'sc-options';
      Object.assign(list.style, {
        position: 'fixed', zIndex: 9999, left: `${b.x + b.width - 150}px`, top: `${b.y + b.height + 2}px`, width: '150px',
        background: '#fff', border: '1px solid #bbb', borderRadius: '6px', boxShadow: '0 8px 20px rgba(0,0,0,0.22)',
        font: '15px Inter, system-ui, sans-serif', color: '#222', padding: '4px 0',
      });
      for (const o of options) {
        const item = document.createElement('div');
        item.textContent = o;
        item.dataset.option = o;
        Object.assign(item.style, { padding: '5px 12px' });
        list.append(item);
      }
      document.body.append(list);
    },
    { options, b },
  );
  await s.wait(0.6);
  const item = s.page.locator(`#sc-options [data-option="${label}"]`);
  await s.move(item, 0.7);
  await item.evaluate((el) => Object.assign(el.style, { background: '#1a73e8', color: '#fff' }));
  await s.click(null, { before: 0.3, after: 0.1 });
  await s.page.evaluate(() => ['sc-options', 'sc-cover'].forEach((id) => document.getElementById(id)?.remove()));
  await select.selectOption({ label });
};

export default {
  title: 'Vom Bild zum Stickmuster',
  part: 3,
  voice: {
    model: 'google/gemini-3.1-flash-tts',
    voice: 'Aoede',
    language: 'de-DE',
    prompt:
      'Speak German in a calm, friendly and clear voice, like an experienced embroiderer showing a friend something on the computer. Natural pace, small pauses between thoughts. Let real enthusiasm show when something nice happens.',
  },
  lead: 0.4,
  tail: 0.7,
  scenes: [
    {
      say: '[warm, inviting] In diesem Video wird aus einem Bild ein Stickmuster: ein Fliegenpilz, wie du ihn im Netz findest oder selbst malst.',
      text: 'In diesem Video wird aus einem Bild ein Stickmuster: ein Fliegenpilz, wie du ihn im Netz findest oder selbst malst.',
      textEn: 'In this video a picture becomes an embroidery design: a toadstool, the kind you find online or paint yourself.',
      run: async (s) => {
        await s.move([960, 600], 0.1);
        await s.wait(4.5);
        await s.move('label:has(input[name=mode][value=image])', 2.0);
      },
    },
    {
      say: 'Oben wechselst du in den Modus Bild. Dann ziehst du dein Bild einfach links in das Feld. [delighted] Ein paar Sekunden später ist es schon gestickt.',
      text: 'Oben wechselst du in den Modus Bild. Dann ziehst du dein Bild einfach links in das Feld. Ein paar Sekunden später ist es schon gestickt.',
      textEn: 'At the top, switch to the Picture mode. Then simply drag your picture into the box on the left. A few seconds later it is already stitched.',
      run: async (s) => {
        await s.label('Bild', 'label:has(input[name=mode][value=image])', 'below');
        await s.click(null, { before: 0.3 });
        await s.wait(1.4);
        s.unlabel();
        await dragFile(s, 'fliegenpilz.jpg', [700, 1000], '#image-drop', 2.4);
        await s.page.setInputFiles('#image-input', picture);
        await s.move([1250, 900], 1.0);
        await until(s, stitched);
        await s.wait(1.5);
      },
    },
    {
      say: 'Über der Leinwand schaltest du um. „Vorbereitet“ zeigt, was heatstitch aus dem Bild macht: wenige, glatte Farbflächen. [curious] Aber schau auf den Stiel: Er ist grau, genau wie der Schatten.',
      text: 'Über der Leinwand schaltest du um. „Vorbereitet“ zeigt, was heatstitch aus dem Bild macht: wenige, glatte Farbflächen. Aber schau auf den Stiel: Er ist grau, genau wie der Schatten.',
      textEn: 'Above the canvas you switch views. “Prepared” shows what heatstitch makes of the picture: a few smooth areas of colour. But look at the stem: it is grey, just like the shadow.',
      run: async (s) => {
        await s.click('label:has(input[name=image-view][value=original])', { move: 1.0 });
        await s.wait(1.4);
        await s.label('Vorbereitet', 'label:has(input[name=image-view][value=prepared])', 'below');
        await s.click('label:has(input[name=image-view][value=prepared])', { move: 0.7 });
        await s.wait(3.2);
        s.unlabel();
        await s.zoom([at(0.5, 0.72)[0], at(0.5, 0.72)[1], 0, 0], 1.6);
        await s.move(at(0.5, 0.72), 1.0);
        await s.wait(1.6);
        await s.move(at(0.62, 0.85), 1.2);
        await s.wait(1.0);
        s.zoomOut();
      },
    },
    {
      say: 'Sechs Farben sind hier zu wenig. Mit neun bekommt der Stiel sein Beige.',
      text: 'Sechs Farben sind hier zu wenig. Mit neun bekommt der Stiel sein Beige.',
      textEn: 'Six colours are too few here. With nine, the stem gets its beige.',
      run: async (s) => {
        const colors = s.page.locator('#image-colors');
        await s.zoom('#image-colors', 1.5);
        await s.label('Höchstens Farben', colors, 'below');
        await slide(s, colors, 9, 1.4);
        s.unlabel();
        s.zoomOut();
        await s.move(at(0.5, 0.75), 1.0);
        await until(s, hasColor, 60, 'Beige');
        await s.wait(1.2);
      },
    },
    {
      say: 'Dafür wird der Farbverlauf auf dem Hut jetzt zu zwei Rottönen. Ein Rot genügt: Klick auf den Pfeil und mit Rot zusammenlegen.',
      text: 'Dafür wird der Farbverlauf auf dem Hut jetzt zu zwei Rottönen. Ein Rot genügt: Klick auf den Pfeil und mit Rot zusammenlegen.',
      textEn: 'In return, the gradient on the cap now becomes two shades of red. One red is enough: click the arrow and merge it with red.',
      run: async (s) => {
        await s.move(at(0.8, 0.45), 1.2);
        await s.wait(1.6);
        await s.zoom('#image-palette', 1.5);
        const select = row(s, 'Dark Fuchsia').locator('select');
        await s.label('Zusammenlegen', select, 'left');
        await pickOption(s, select, 'Red');
        s.unlabel();
        await until(s, (name) => ![...document.querySelectorAll('#image-palette .image-color-name')].some((e) => e.textContent === name), 60, 'Dark Fuchsia');
        await s.wait(0.6);
        s.zoomOut();
        await s.move(at(0.6, 0.35), 1.0);
      },
    },
    {
      say: 'Den Schatten will ich nicht sticken, also nehme ich das Häkchen weg.',
      text: 'Den Schatten will ich nicht sticken, also nehme ich das Häkchen weg.',
      textEn: "I don't want to stitch the shadow, so I untick it.",
      run: async (s) => {
        await s.move(at(0.5, 0.88), 0.9);
        await s.wait(0.6);
        await s.zoom('#image-palette', 1.5);
        await s.click(row(s, 'Warm Gray').locator('input[type=checkbox]'), { move: 1.0 });
        s.zoomOut();
        await s.move(at(0.5, 0.88), 1.0);
      },
    },
    {
      say: '[focused] Bleibt der rote Fleck oben rechts. Rot abwählen geht nicht, sonst fehlt der Hut. Dafür gibt es den Pinsel: Radieren, einmal darüber, und weg ist er. [satisfied] Jetzt sind es wieder fünf Garnfarben wie am Anfang, nur diesmal die richtigen.',
      text: 'Bleibt der rote Fleck oben rechts. Rot abwählen geht nicht, sonst fehlt der Hut. Dafür gibt es den Pinsel: Radieren, einmal darüber, und weg ist er. Jetzt sind es wieder fünf Garnfarben wie am Anfang, nur diesmal die richtigen.',
      textEn: "That leaves the red spot at the top right. Unticking red won't do, the cap would be gone. That's what the brush is for: Erase, one stroke over it, and it's gone. Now there are five thread colours again, as at the start, only this time the right ones.",
      run: async (s) => {
        const speck = at(345 / 400, 62 / 400);
        await s.move(speck, 1.2);
        await s.wait(1.0);
        await s.move(at(0.5, 0.3), 1.0);
        await s.wait(1.4);
        await s.label('Radieren', 'label:has(input[name=image-tool][value=erase])', 'below');
        await s.click('label:has(input[name=image-tool][value=erase])', { move: 1.2 });
        await s.wait(0.4);
        s.unlabel();
        await slide(s, s.page.locator('#image-brush'), 6, 0.9);
        await s.zoom([speck[0], speck[1], 0, 0], 1.7);
        await s.drag([[speck[0] - 18, speck[1] - 12], [speck[0] + 16, speck[1] - 2], [speck[0] - 12, speck[1] + 12]], { sec: 0.5 });
        await s.wait(0.4);
        await s.move([speck[0] + 60, speck[1] + 60], 0.6);
        await until(s, stitched);
        await s.wait(0.8);
        s.zoomOut();
        await s.zoom('#image-palette', 1.4);
        const boxes = s.page.locator('#image-palette input[type=checkbox]');
        await s.move(boxes.first(), 1.0);
        await s.move(boxes.nth(4), 1.4);
        await s.wait(0.6);
        s.zoomOut();
      },
    },
    {
      say: '[delighted] Unter „Stiche“ siehst du das Stickmuster, und mit „Wie gestickt“ glänzt das Garn im Licht. Rechts prüft heatstitch die Stiche für deinen Stoff. Zwei Stellen sind etwas dicht, die schaust du dir nach dem Übernehmen im Modus Dichte an.',
      text: 'Unter „Stiche“ siehst du das Stickmuster, und mit „Wie gestickt“ glänzt das Garn im Licht. Rechts prüft heatstitch die Stiche für deinen Stoff. Zwei Stellen sind etwas dicht, die schaust du dir nach dem Übernehmen im Modus Dichte an.',
      textEn: 'Under “Stitches” you see the design, and with “As stitched” the thread shines in the light. On the right, heatstitch checks the stitches for your fabric. Two spots are a little dense; you look at them in the Density mode after taking it over.',
      run: async (s) => {
        await s.click('label:has(input[name=image-tool][value=none])', { move: 0.9 });
        await s.click('label:has(input[name=image-view][value=stitches])', { move: 1.1 });
        await s.wait(0.8);
        await s.label('Wie gestickt', '#image-shine', 'below');
        await s.click('#image-shine', { move: 1.0 });
        await s.wait(0.6);
        s.unlabel();
        // The light follows the pointer: one slow round over the toadstool.
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * 2 * Math.PI;
          await s.move(at(0.5 + 0.28 * Math.cos(a), 0.5 + 0.28 * Math.sin(a)), 0.12);
        }
        await s.zoom('#image-verdict', 1.4);
        await s.move('#image-verdict', 1.2);
        await s.wait(2.8);
        s.zoomOut();
      },
    },
    {
      say: '[proud, warm] Ein Klick auf „Als Stickmuster übernehmen“, und dein Fliegenpilz ist ein ganz normales Stickmuster. Du kannst ihn abspielen, prüfen und als Stickdatei speichern.',
      text: 'Ein Klick auf „Als Stickmuster übernehmen“, und dein Fliegenpilz ist ein ganz normales Stickmuster. Du kannst ihn abspielen, prüfen und als Stickdatei speichern.',
      textEn: 'One click on “Use as design”, and your toadstool is an ordinary embroidery design. You can play it, check it and save it as a stitch file.',
      run: async (s) => {
        await s.click('#image-take', { move: 1.0, before: 0.4 });
        await s.wait(2.2);
        await s.move([1500, 520], 0.9);
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.0);
      },
    },
    {
      say: 'Ein Tipp zum Schluss: Fotos werden viel besser, wenn eine KI sie vorher in eine flache Grafik verwandelt. Den passenden Auftrag kopierst du hier. Und eine SVG-Datei übernimmt heatstitch Form für Form, ganz genau.',
      text: 'Ein Tipp zum Schluss: Fotos werden viel besser, wenn eine KI sie vorher in eine flache Grafik verwandelt. Den passenden Auftrag kopierst du hier. Und eine SVG-Datei übernimmt heatstitch Form für Form, ganz genau.',
      textEn: 'One last tip: photos turn out much better if an AI first turns them into a flat graphic. You copy the matching request here. And heatstitch takes over an SVG file shape by shape, exactly.',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.page.keyboard.press(' ');
        await s.click('label:has(input[name=mode][value=image])', { move: 1.0 });
        await s.wait(0.6);
        const summary = s.page.locator('details.ai-prep > summary');
        await s.label('Bild mit KI vorbereiten', summary, 'right');
        await s.click(summary, { move: 0.9 });
        await s.wait(0.6);
        s.unlabel();
        await s.zoom('details.ai-prep', 1.4);
        await s.move('#image-ai-copy', 1.4);
        await s.wait(2.4);
        s.zoomOut();
        await s.label('SVG', '#image-drop', 'right');
        await s.move('#image-drop', 1.2);
        await s.wait(2.6);
        s.unlabel();
      },
    },
  ],
};

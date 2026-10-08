// Teil 3: Vom Bild zum Stickmuster. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Die Umwandlung rechnet in Workern in Echtzeit. Jede Szene wartet deshalb auf das fertige
// Ergebnis (Status „Bereite Bild vor …“ / „Erzeuge Stiche …“ weg, erwartete Farben da), in
// kurzen s.wait-Schritten, damit weiter Bilder entstehen und es auch ohne Bilder (Teile) klappt.
import fs from 'node:fs';

const IMAGE = new URL('./material/fliegenpilz.jpg', import.meta.url);

const btn = (s, name) => s.page.getByRole('button', { name }).first();
// Radio buttons and check boxes sit inside their labels; the label is what the pointer aims at.
const choice = (s, name, role = 'radio') => s.page.locator('label', { has: s.page.getByRole(role, { name }) }).first();
// The colour list of step 2: a row per colour, named by the thread, then a select with all others.
const colorCard = (s) => s.page.getByRole('complementary').filter({ has: s.page.getByRole('heading', { name: 'Farben', exact: true }) });
const colorRow = async (s, name) => {
  const rows = colorCard(s).getByRole('listitem');
  const i = (await rows.allInnerTexts()).findIndex((t) => t.startsWith(name));
  if (i < 0) throw new Error(`no colour ${name}`);
  return rows.nth(i);
};
const colorNames = async (s) => (await colorCard(s).getByRole('listitem').allInnerTexts()).map((t) => t.split('\n')[0].trim());

/** Waits in frames until the image workers are done and `ready` holds. */
const settle = async (s, ready = async () => true, min = 0.4) => {
  await s.wait(min);
  for (let i = 0; i < 900; i++) {
    if (!(await s.page.locator('.image-status.busy').count()) && (await ready())) return;
    await s.wait(0.1);
  }
  throw new Error('image conversion did not finish');
};

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app. The browser cannot show a drag from the file manager; the card stands in for
 * it, and the page gets the same dragenter, dragover and drop events with the real file.
 */
const dragFileIn = async (s, from, to) => {
  const b64 = fs.readFileSync(IMAGE).toString('base64');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'fliegenpilz.jpg', { type: 'image/jpeg' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/jpeg;base64,${b64}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid #e6e1ea';
      const name = document.createElement('span');
      name.textContent = 'fliegenpilz.jpg';
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

// The realistic view lights the threads from the pointer's side of the stage (the light follows
// the mouse and stays where it left the stage). Light from the upper left shows the red cap
// deep and shiny; from the right or the middle it looks pale. So the pointer rests up left on
// the stage, and crosses to the right column over the header, which is not part of the stage.
const REST = [700, 290];
// In Gestalten the pointer rests off the motif, so the stage shows no stitch readout next to it.
const REST_DESIGN = [420, 140];
const glide = async (s, points, sec = 0.5) => {
  for (const p of points) await s.move(p, sec);
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
  tail: 0.6,
  scenes: [
    {
      say: '[warm] Aus einem Foto oder einer Grafik wird in heatstitch ein Stickmuster. Auf der Startseite klickst du dafür auf „Bild umwandeln“, oder du drückst die Taste 3.',
      text: 'Aus einem Foto oder einer Grafik wird in heatstitch ein Stickmuster. Auf der Startseite klickst du dafür auf „Bild umwandeln“, oder du drückst die Taste 3.',
      textEn: 'In heatstitch, a photo or a graphic becomes an embroidery design. On the start page you click “Convert image”, or you press the 3 key.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.2);
        const start = btn(s, /^Bild umwandeln/);
        await s.move(start, 1.0);
        await s.label('Bild umwandeln', start, 'above');
        await s.wait(1.6);
        s.unlabel();
        s.keyCap('3');
        await s.click(null, { before: 0.4, after: 0.6 });
        await s.wait(1.2);
        s.keyCap(null);
      },
    },
    {
      say: 'Ein Assistent führt dich in drei Schritten: Bild wählen, Farben und Flächen, Stiche und Ergebnis.',
      text: 'Ein Assistent führt dich in drei Schritten: Bild wählen, Farben und Flächen, Stiche und Ergebnis.',
      textEn: 'An assistant guides you in three steps: Choose image, Colors and areas, Stitches and result.',
      run: async (s) => {
        const steps = s.page.getByRole('list', { name: 'Schritte' }).getByRole('button');
        await s.zoom([570, 78, 0, 0], 1.8);
        await s.move([560, 160], 1.0);
        await s.wait(1.0);
        for (const [i, word] of ['Bild wählen', 'Farben und Flächen', 'Stiche und Ergebnis'].entries()) {
          await s.label(word, steps.nth(i), 'below');
          await s.wait(1.2);
        }
        s.unlabel();
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: 'Zieh dein Bild einfach aus deinem Ordner ins Fenster und lass es los. Ich nehme diesen Fliegenpilz. Mit „Weiter“ geht es zum zweiten Schritt.',
      text: 'Zieh dein Bild einfach aus deinem Ordner ins Fenster und lass es los. Ich nehme diesen Fliegenpilz. Mit „Weiter“ geht es zum zweiten Schritt.',
      textEn: 'Simply drag your image from your folder into the window and let go. I take this fly agaric. “Next” takes you to the second step.',
      run: async (s) => {
        await dragFileIn(s, [1912, 760], [1110, 560]);
        await settle(s, async () => (await s.page.getByText(/^fliegenpilz, /).count()) > 0);
        await s.move([1250, 640], 1.2);
        await s.wait(1.4);
        const next = btn(s, 'Weiter');
        await s.move(next, 1.2);
        await s.label('Weiter', next, 'above');
        await s.wait(0.6);
        await s.click(null);
        s.unlabel();
        await settle(s, async () => (await colorNames(s)).includes('Warm Gray'));
      },
    },
    {
      say: '[curious] Jetzt zerlegt heatstitch das Bild in Flächen. Den weißen Hintergrund lässt es gleich weg. Rechts unter Farben steht jede Farbe als Garn.',
      text: 'Jetzt zerlegt heatstitch das Bild in Flächen. Den weißen Hintergrund lässt es gleich weg. Rechts unter Farben steht jede Farbe als Garn.',
      textEn: 'Now heatstitch splits the image into areas. It leaves out the white background right away. On the right under Colors, every color is listed as a thread.',
      run: async (s) => {
        await s.move([960, 520], 1.0);
        await s.wait(1.6);
        const bg = choice(s, 'Hintergrund weglassen', 'checkbox');
        await s.zoom([150, 200, 0, 0], 1.6);
        await s.move(bg, 1.0);
        await s.label('Hintergrund weglassen', bg, 'below');
        await s.wait(2.0);
        s.unlabel();
        s.zoomOut();
        await s.wait(0.3);
        await s.zoom([1760, 230, 0, 0], 1.6);
        await s.move([1720, 220], 1.2);
        await s.label('Farben', [1626, 76, 60, 20], 'above');
        await s.wait(2.6);
        s.unlabel();
      },
    },
    {
      say: 'Links legst du mit „Höchstens Farben“ fest, wie viele Garne es werden. Bei sechs teilen sich Stiel und Schatten ein Grau. Ich stelle zehn ein. [pleased] Jetzt hat der Stiel sein eigenes Beige.',
      text: 'Links legst du mit „Höchstens Farben“ fest, wie viele Garne es werden. Bei sechs teilen sich Stiel und Schatten ein Grau. Ich stelle zehn ein. Jetzt hat der Stiel sein eigenes Beige.',
      textEn: 'On the left, “Max colors” sets how many threads you get. At six, the stem and the shadow share one gray. I set it to ten. Now the stem has its own beige.',
      run: async (s) => {
        s.zoomOut();
        const slider = s.page.getByRole('slider').first();
        const b = await s.box(slider);
        // The thumb sits where the value lies between min 2 and max 16.
        const at = (v) => [b.x + 8 + ((v - 2) / 14) * (b.width - 16), b.y + b.height / 2];
        await s.zoom([150, 160, 0, 0], 1.8);
        await s.move(at(6), 1.0);
        await s.label('Höchstens Farben', [24, 100, 120, 16], 'above');
        await s.wait(1.6);
        s.unlabel();
        await s.zoom([960, 700, 0, 0], 1.5);
        await s.move([960, 880], 1.0);
        await s.wait(2.2);
        await s.zoom([150, 160, 0, 0], 1.8);
        await s.drag([at(6), at(10)], { sec: 1.0 });
        if ((await slider.inputValue()) !== '10') await slider.fill('10');
        await settle(s, async () => (await colorNames(s)).includes('Beige'));
        s.zoomOut();
        await s.move([960, 780], 1.0);
        await s.wait(2.0);
      },
    },
    {
      say: 'Dafür ist am Hutrand ein dunkles Rot dazugekommen, Dark Fuchsia. Über den Pfeil daneben legst du eine Farbe mit einer anderen zusammen. Ich nehme Red.',
      text: 'Dafür ist am Hutrand ein dunkles Rot dazugekommen, Dark Fuchsia. Über den Pfeil daneben legst du eine Farbe mit einer anderen zusammen. Ich nehme Red.',
      textEn: 'In return, a dark red appeared at the edge of the cap, Dark Fuchsia. With the arrow next to it you merge one color into another. I pick Red.',
      run: async (s) => {
        await settle(s, async () => (await colorNames(s)).includes('Dark Fuchsia'));
        await s.move([1000, 600], 1.0);
        await s.wait(1.6);
        const row = await colorRow(s, 'Dark Fuchsia');
        await s.zoom([1760, 300, 0, 0], 1.7);
        await s.move(row.getByText('Dark Fuchsia'), 1.0);
        await s.label('Dark Fuchsia', row.getByText('Dark Fuchsia'), 'below');
        await s.wait(1.0);
        const merge = row.getByRole('combobox');
        await s.move(merge, 0.9);
        await s.label('zusammenlegen', merge, 'below');
        await s.wait(2.0);
        await s.click(null, { before: 0.2, after: 0.4 });
        await merge.selectOption({ label: 'Red' });
        await s.page.keyboard.press('Escape');
        s.unlabel();
        await settle(s, async () => !(await colorNames(s)).includes('Dark Fuchsia'));
        s.zoomOut();
        await s.move([1000, 560], 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Den grauen Schatten unter dem Pilz brauche ich nicht. Ohne Häkchen lässt heatstitch eine Farbe weg.',
      text: 'Den grauen Schatten unter dem Pilz brauche ich nicht. Ohne Häkchen lässt heatstitch eine Farbe weg.',
      textEn: 'I don’t need the gray shadow under the mushroom. Without a check mark, heatstitch leaves a color out.',
      run: async (s) => {
        await s.move([960, 930], 1.0);
        await s.wait(1.2);
        const box = (await colorRow(s, 'Warm Gray')).getByRole('checkbox');
        await s.zoom([1760, 300, 0, 0], 1.7);
        await s.move(box, 1.0);
        await s.label('Häkchen', box, 'left');
        await s.wait(0.8);
        await s.click(null);
        s.unlabel();
        await settle(s);
        s.zoomOut();
        await s.move([960, 900], 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Bleibt der rote Punkt oben rechts. Unter Pinsel wähle ich Radieren und wische ihn einfach weg. Mit Malen färbst du Flächen von Hand um.',
      text: 'Bleibt der rote Punkt oben rechts. Unter Pinsel wähle ich Radieren und wische ihn einfach weg. Mit Malen färbst du Flächen von Hand um.',
      textEn: 'That leaves the red dot at the top right. Under Brush I choose Erase and simply wipe it away. With Paint you recolor areas by hand.',
      run: async (s) => {
        await s.zoom([1280, 290, 0, 0], 1.6);
        await s.move([1282, 290], 1.2);
        await s.wait(1.0);
        s.zoomOut();
        await s.zoom([1760, 470, 0, 0], 1.7);
        const erase = choice(s, 'Radieren');
        await s.move(erase, 1.0);
        await s.label('Pinsel', [1626, 436, 50, 20], 'above');
        await s.wait(0.9);
        s.unlabel();
        await s.label('Radieren', erase, 'below');
        await s.click(null, { before: 0.3 });
        await s.wait(0.6);
        s.unlabel();
        s.zoomOut();
        await s.zoom([1280, 290, 0, 0], 1.8);
        await s.drag(
          [
            [1262, 278],
            [1300, 280],
            [1262, 290],
            [1302, 292],
            [1262, 302],
            [1298, 304],
          ],
          { sec: 0.35 },
        );
        await settle(s);
        await s.move([1340, 330], 0.6);
        await s.wait(0.8);
        s.zoomOut();
        await s.zoom([1760, 470, 0, 0], 1.7);
        const paint = choice(s, 'Malen');
        await s.move(paint, 1.0);
        await s.label('Malen', paint, 'below');
        await s.wait(1.8);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Weiter geht es zum dritten Schritt, Stiche und Ergebnis. Die Vorschau zeigt dein Motiv schon mit realistischen Fäden.',
      text: 'Weiter geht es zum dritten Schritt, Stiche und Ergebnis. Die Vorschau zeigt dein Motiv schon mit realistischen Fäden.',
      textEn: 'On to the third step, Stitches and result. The preview already shows your design with realistic threads.',
      run: async (s) => {
        const next = btn(s, 'Weiter');
        await s.move(next, 1.2);
        await s.label('Weiter', next, 'above');
        await s.click(null);
        s.unlabel();
        await settle(s, async () => (await s.page.getByRole('heading', { name: 'Ergebnis' }).count()) > 0);
        await s.move(REST, 1.2);
        await s.zoom([960, 560, 0, 0], 1.4);
        await s.wait(3.0);
        s.zoomOut();
      },
    },
    {
      say: 'Unter Stil wählst du, wie die Stiche laufen. Bei Dynamisch folgen die Reihen der Form und dem Bild. [thoughtful] Für den Fliegenpilz nehme ich Flach, mit geraden Reihen.',
      text: 'Unter Stil wählst du, wie die Stiche laufen. Bei Dynamisch folgen die Reihen der Form und dem Bild. Für den Fliegenpilz nehme ich Flach, mit geraden Reihen.',
      textEn: 'Under Style you choose how the stitches run. With Dynamic, the rows follow the shape and the image. For the fly agaric I take Flat, with straight rows.',
      run: async (s) => {
        const stats = s.page.getByRole('complementary').filter({ has: s.page.getByRole('heading', { name: 'Ergebnis' }) });
        const count = () => stats.getByRole('definition').first().innerText();
        await s.zoom([150, 210, 0, 0], 1.8);
        const flat = choice(s, /^Flach/);
        const dyn = choice(s, /^Dynamisch/);
        await s.move(flat, 1.0);
        await s.label('Stil', [24, 100, 30, 16], 'above');
        await s.wait(1.4);
        s.unlabel();
        const before = await count();
        await s.move(dyn, 0.7);
        await s.label('Dynamisch', dyn, 'below');
        await s.click(null, { before: 0.3 });
        await settle(s, async () => (await count()) !== before);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.zoom([960, 470, 0, 0], 1.5);
        await s.wait(2.4);
        s.zoomOut();
        await s.zoom([150, 210, 0, 0], 1.8);
        const dynCount = await count();
        await s.move(flat, 1.0);
        await s.label('Flach', flat, 'below');
        await s.click(null, { before: 0.3 });
        await settle(s, async () => (await count()) !== dynCount);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.zoom([960, 470, 0, 0], 1.5);
        await s.wait(2.0);
        s.zoomOut();
      },
    },
    {
      say: 'Rechts im Ergebnis stehen Stiche, Größe, Farben und Nähzeit. [pleased] Unauffällig heißt: keine Bereiche über den Grenzwerten für dieses Material.',
      text: 'Rechts im Ergebnis stehen Stiche, Größe, Farben und Nähzeit. Unauffällig heißt: keine Bereiche über den Grenzwerten für dieses Material.',
      textEn: 'On the right, Result shows stitches, size, colors and sewing time. Inconspicuous means: no areas above the limits for this material.',
      run: async (s) => {
        const stats = s.page.getByRole('complementary').filter({ has: s.page.getByRole('heading', { name: 'Ergebnis' }) });
        await glide(s, [[REST[0], 22], [1760, 22]], 0.6);
        await s.zoom([1760, 220, 0, 0], 1.7);
        await s.move(stats.getByRole('term').filter({ hasText: /^Stiche$/ }), 0.8);
        await s.label('Ergebnis', stats.getByRole('heading', { name: 'Ergebnis' }), 'below');
        await s.wait(1.0);
        s.unlabel();
        for (const word of ['Stiche', 'Größe', 'Farben', 'Nähzeit']) {
          await s.move(stats.getByRole('term').filter({ hasText: new RegExp(`^${word}$`) }), 0.6);
          await s.wait(0.3);
        }
        const ok = stats.getByText('Unauffällig', { exact: true });
        await s.move(ok, 0.9);
        await s.label('Unauffällig', ok, 'left');
        await s.wait(3.8);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Mit „Übernehmen“ wird daraus ein neues Stickmuster. [delighted] Da ist er, dein Fliegenpilz, fertig zum Gestalten, Prüfen und Speichern.',
      text: 'Mit „Übernehmen“ wird daraus ein neues Stickmuster. Da ist er, dein Fliegenpilz, fertig zum Gestalten, Prüfen und Speichern.',
      textEn: '“Apply” turns it into a new embroidery design. There it is, your fly agaric, ready to design, check and save.',
      run: async (s) => {
        const apply = btn(s, 'Übernehmen');
        await glide(s, [[1760, 22], [150, 22]], 0.6);
        await s.move(apply, 1.0);
        await s.label('Übernehmen', apply, 'above');
        await s.click(null, { before: 0.4 });
        s.unlabel();
        await btn(s, /^fliegenpilz/).waitFor();
        // The new design opens a little too large (455 % instead of 440 %, the top of the cap is cut);
        // Einpassen before the first frame shows it.
        await btn(s, 'Einpassen').evaluate((b) => b.click());
        await s.wait(0.6);
        await s.move(REST_DESIGN, 1.2);
        await s.wait(4.0);
      },
    },
    {
      say: 'Mit der Leertaste siehst du, wie die Maschine ihn Stich für Stich stickt. [warm] Viel Spaß beim Sticken!',
      text: 'Mit der Leertaste siehst du, wie die Maschine ihn Stich für Stich stickt. Viel Spaß beim Sticken!',
      textEn: 'With the space bar you see the machine stitch it, stitch by stitch. Have fun embroidering!',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('Home', { label: 'Pos1', show: 0.3 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.move(REST_DESIGN, 1.4);
        await s.wait(7.0);
      },
    },
  ],
};

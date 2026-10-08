// Teil 10: Vorschau und Speichern. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Das Stickblatt öffnet die App in einem neuen Tab. Die Aufnahme sieht nur ein Fenster; der
// Ablauf lässt window.open deshalb ein Blatt über der App öffnen, das wie ein neuer Tab aussieht.
import fs from 'node:fs';

const FILE = new URL('./material/aufnaeher-67.dst', import.meta.url);

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();
const eye = (s) => s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
const viewMenu = (s) => s.page.locator('#view-pop');
const inView = (s, text) => viewMenu(s).getByText(text, { exact: true }).first();
const saveButton = (s) => s.page.getByRole('button', { name: 'Speichern', exact: true }).first();
const saveMenu = (s) => s.page.getByRole('dialog', { name: 'Speichern' });
const sheet = (s) => s.page.frameLocator('#sheet-tab');

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/** Clicks a select and picks an option; the browser draws no list in the capture. */
const choose = async (s, select, label, { move = 0.8 } = {}) => {
  await s.click(select, { move, before: 0.3, after: 0.3 });
  await select.selectOption({ label });
  await s.wait(0.4);
};

/** Opens the Speichern menu at the top right. */
const openSave = async (s) => {
  await s.click(saveButton(s), { move: 0.9, before: 0.3, after: 0.5 });
  await until(s, async () => saveMenu(s).isVisible(), 'Speichern menu');
};

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app. The browser cannot show a drag from the file manager; the card stands in for
 * it, and the page gets the same dragenter, dragover and drop events with the real file.
 */
const dragFileIn = async (s, from, to) => {
  const b64 = fs.readFileSync(FILE).toString('base64');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'aufnaeher-67.dst', { type: 'application/octet-stream' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const icon = document.createElement('div');
      icon.textContent = 'DST';
      icon.style.cssText =
        'width:64px;height:64px;border-radius:8px;display:grid;place-items:center;background:#141118;color:#f7a23b;' +
        'font:700 15px Inter,system-ui,sans-serif;letter-spacing:.06em';
      const name = document.createElement('span');
      name.textContent = 'aufnaeher-67.dst';
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
    },
    { b64, x: from[0], y: from[1] },
  );
  await s.move(to, 1.6);
  await s.wait(0.5);
  await s.page.evaluate(([x, y]) => window.__dropFile(x, y), to);
};

/** Lets the next window.open show its page over the app, full size, like a new tab. */
const sheetAsTab = (s) =>
  s.page.evaluate(() => {
    window.open = () => {
      const f = document.createElement('iframe');
      f.id = 'sheet-tab';
      f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483600;background:#fff';
      document.body.append(f);
      return f.contentWindow;
    };
  });

/** Scrolls the stitch sheet to `y` over `sec`, eased. */
const scrollSheet = async (s, y, sec) => {
  const html = sheet(s).locator('html');
  const from = await html.evaluate(() => window.scrollY);
  const n = Math.max(1, Math.round(sec * 30));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await html.evaluate((_, v) => window.scrollTo(0, v), from + (y - from) * e);
    await s.wait(1 / 30);
  }
};

// Above the patch, so the stage shows no readout next to the pointer.
const REST = [1500, 120];

export default {
  title: 'Vorschau und Speichern',
  part: 10,
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
      say: '[warm] Bevor die Maschine losläuft, willst du sehen, wie dein Stickmuster wirklich wirkt, und alles bereitlegen. Ich ziehe diesen Aufnäher ins Fenster: [playful] eine Sechs und eine Sieben. [short pause] Du weißt schon.',
      text: 'Bevor die Maschine losläuft, willst du sehen, wie dein Stickmuster wirklich wirkt, und alles bereitlegen. Ich ziehe diesen Aufnäher ins Fenster: eine Sechs und eine Sieben. Du weißt schon.',
      textEn: 'Before the machine starts, you want to see how your design really looks, and get everything ready. I drag this patch into the window: a six and a seven. You know.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.6);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'aufnaeher-67.dst').count()) > 0, 'aufnaeher-67.dst opens');
        await s.move(REST, 1.2);
        await s.wait(3.0);
      },
    },
    {
      say: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Ich schalte Realistische Fäden ein. [delighted] Jetzt siehst du jeden Faden mit Glanz und Schatten.',
      text: 'Unten rechts auf der Bühne öffnet das Auge das Ansicht-Menü. Ich schalte Realistische Fäden ein. Jetzt siehst du jeden Faden mit Glanz und Schatten.',
      textEn: 'At the bottom right of the stage, the eye opens the View menu. I turn on Realistic threads. Now you see every thread with sheen and shadow.',
      run: async (s) => {
        await s.zoom([1420, 900, 0, 0], 1.6);
        await s.move(eye(s), 1.0);
        await s.label('Ansicht-Menü', eye(s), 'above');
        await s.wait(1.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await s.zoom([1430, 520, 0, 0], 1.7);
        const real = inView(s, 'Realistische Fäden');
        await s.move(real, 0.9);
        await s.label('Realistische Fäden', real, 'above');
        await s.wait(0.4);
        await s.click(null, { before: 0.2, after: 0.5 });
        s.unlabel();
        s.zoomOut();
        await s.move([1000, 140], 1.2);
        await s.wait(3.0);
      },
    },
    {
      say: 'Darunter wählst du Hintergrund und Stoff. Mein Aufnäher kommt auf schwarzes Leder. [enthusiastic] Schon liegt er darauf, fast wie echt.',
      text: 'Darunter wählst du Hintergrund und Stoff. Mein Aufnäher kommt auf schwarzes Leder. Schon liegt er darauf, fast wie echt.',
      textEn: 'Below that, you choose background and fabric. My patch goes on black leather. And there it is, almost like the real thing.',
      run: async (s) => {
        await s.zoom([1430, 790, 0, 0], 1.7);
        const black = viewMenu(s).getByRole('button', { name: 'Schwarz' });
        const fabric = viewMenu(s).getByRole('combobox', { name: 'Stoff' });
        await s.move(black, 1.0);
        await s.label('Hintergrund', [1284, 740, 240, 50], 'above');
        await s.wait(0.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await s.label('Stoff', fabric, 'below');
        await choose(s, fabric, 'Leder, Kunstleder');
        s.unlabel();
        s.zoomOut();
        await s.move([1000, 140], 1.0);
        await s.wait(3.2);
      },
    },
    {
      say: 'Unter Markierungen blendest du Sprünge und Fadenschnitte aus. So bleibt nur, was gestickt wird. [curious] Und bewegst du die Maus, wandert das Licht mit.',
      text: 'Unter Markierungen blendest du Sprünge und Fadenschnitte aus. So bleibt nur, was gestickt wird. Und bewegst du die Maus, wandert das Licht mit.',
      textEn: 'Under Markers you hide jumps and thread trims. That leaves only what gets stitched. And when you move the mouse, the light moves with it.',
      run: async (s) => {
        await s.zoom([1430, 900, 0, 0], 1.7);
        const jumps = inView(s, 'Sprünge');
        const trims = inView(s, 'Fadenschnitte');
        await s.move(jumps, 1.0);
        await s.label('Markierungen', inView(s, 'Markierungen'), 'above');
        await s.wait(0.4);
        await s.click(null, { before: 0.2, after: 0.4 });
        await s.click(trims, { move: 0.6, before: 0.2, after: 0.5 });
        s.unlabel();
        s.zoomOut();
        await s.press('Escape', { show: 0 });
        await s.move([500, 300], 1.4);
        await s.move([1400, 800], 2.6);
        await s.move([700, 820], 1.6);
        await s.move(REST, 1.2);
      },
    },
    {
      say: 'Rechts in der Karte Stickmuster steht unter Material jetzt auch Leder. Deshalb zeigt Prüfen oben eine Sechs: Auf Leder achtet heatstitch auch darauf, dass enge Einstiche das Leder nicht lochen.',
      text: 'Rechts in der Karte Stickmuster steht unter Material jetzt auch Leder. Deshalb zeigt Prüfen oben eine Sechs: Auf Leder achtet heatstitch auch darauf, dass enge Einstiche das Leder nicht lochen.',
      textEn: 'On the right, in the Design card, Material now says leather as well. That is why Check at the top shows a six: on leather, heatstitch also makes sure that tight needle holes do not punch through the leather.',
      run: async (s) => {
        const fabric = s.page.getByRole('complementary').getByRole('combobox', { name: 'Stoff' });
        await s.zoom([1760, 290, 0, 0], 1.8);
        await s.move(fabric, 1.2);
        await s.label('Material', fabric, 'below');
        await s.wait(3.6);
        s.unlabel();
        s.zoomOut();
        const check = mode(s, /^Prüfen/);
        await s.zoom([1000, 24, 0, 0], 1.8);
        await s.move(check, 1.2);
        await s.label('6 Stellen', check, 'below');
        await s.wait(5.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Darunter steht Bereit zum Sticken, passend zu Stoff und Stichzahl. Für Leder rät heatstitch zu Klebevlies, für echtes Leder zu einer Ledernadel der Stärke 80, und zu höchstens etwa 400 Stichen pro Minute.',
      text: 'Darunter steht Bereit zum Sticken, passend zu Stoff und Stichzahl. Für Leder rät heatstitch zu Klebevlies, für echtes Leder zu einer Ledernadel der Stärke 80, und zu höchstens etwa 400 Stichen pro Minute.',
      textEn: 'Below that is Ready to stitch, matched to fabric and stitch count. For leather, heatstitch recommends tear-away adhesive stabilizer, a size 80 leather needle for real leather, and at most about 400 stitches per minute.',
      run: async (s) => {
        const card = s.page.getByRole('complementary');
        const heading = card.getByText('Bereit zum Sticken', { exact: true }).first();
        const term = (name) => card.getByRole('term').filter({ hasText: new RegExp(`^${name}$`) }).first();
        // The value next to a term: the definition right after it.
        const value = (name) => term(name).locator('xpath=following-sibling::*[1]');
        await s.zoom([1760, 560, 0, 0], 1.6);
        await s.move(heading, 1.2);
        await s.label('Bereit zum Sticken', heading, 'above');
        await s.wait(4.0);
        for (const [name, sec] of [['Vlies', 3.4], ['Nadel', 4.0], ['Tempo', 3.4]]) {
          await s.move(term(name), 0.8);
          await s.label(name, value(name), 'left');
          await s.wait(sec);
        }
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Oben rechts klickst du auf Speichern. Ganz oben erinnert dich heatstitch: Kein Stickrahmen gewählt. Wählen springt zum Stickrahmen, und ich nehme 50 mal 50 Millimeter. Passt knapp.',
      text: 'Oben rechts klickst du auf Speichern. Ganz oben erinnert dich heatstitch: Kein Stickrahmen gewählt. Wählen springt zum Stickrahmen, und ich nehme 50 mal 50 Millimeter. Passt knapp.',
      textEn: 'At the top right you click Save. Right at the top, heatstitch reminds you: no hoop chosen. Choose jumps to the hoop, and I take 50 by 50 millimetres. A tight fit.',
      run: async (s) => {
        await s.zoom([1720, 200, 0, 0], 1.6);
        await s.move(saveButton(s), 0.9);
        await s.label('Speichern', saveButton(s), 'left');
        await s.wait(0.6);
        await s.click(null, { before: 0.2, after: 0.3 });
        s.unlabel();
        await until(s, async () => saveMenu(s).isVisible(), 'Speichern menu');
        const pick = saveMenu(s).getByRole('button', { name: 'Wählen' });
        await s.move(pick, 1.0);
        await s.label('Kein Stickrahmen gewählt', [1566, 60, 292, 26], 'left');
        await s.wait(2.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        const hoop = s.page.getByRole('combobox', { name: 'Stickrahmen' });
        await s.label('Stickrahmen', hoop, 'below');
        await choose(s, hoop, '50 × 50 mm · Janome, Brother', { move: 0.9 });
        s.unlabel();
        await s.move([1800, 200], 0.8);
        await s.label('Passt knapp', [1806, 190, 92, 20], 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Unter Für deine Maschine wählst du das Format. Meine Maschine ist eine Brother, also PES. Der Dateiname steht schon da. Ein Klick auf Speichern, und die Stickdatei liegt bei deinen Downloads.',
      text: 'Unter Für deine Maschine wählst du das Format. Meine Maschine ist eine Brother, also PES. Der Dateiname steht schon da. Ein Klick auf Speichern, und die Stickdatei liegt bei deinen Downloads.',
      textEn: 'Under For your machine you choose the format. My machine is a Brother, so PES. The file name is already there. One click on Save, and the embroidery file is in your downloads.',
      run: async (s) => {
        await s.zoom([1710, 300, 0, 0], 1.6);
        await openSave(s);
        const group = saveMenu(s).getByRole('group', { name: 'Für deine Maschine' });
        const pes = saveMenu(s).locator('label', { has: s.page.getByRole('radio', { name: /^PES/ }) }).first();
        const name = saveMenu(s).getByRole('textbox');
        await s.move(pes, 1.0);
        await s.label('Für deine Maschine', group.getByText('Für deine Maschine', { exact: true }), 'above');
        await s.wait(2.0);
        s.unlabel();
        await s.label('PES', pes, 'left');
        await s.click(null, { before: 0.3, after: 0.6 });
        await s.wait(1.4);
        s.unlabel();
        await s.move(name, 0.9);
        await s.label('Dateiname', name, 'left');
        await s.wait(2.4);
        s.unlabel();
        const save = saveMenu(s).getByRole('button', { name: 'Speichern', exact: true });
        await s.click(save, { move: 0.8, before: 0.4, after: 0.4 });
        await s.label('aufnaeher-67.pes', saveButton(s), 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Als Projekt speichert alles, um später weiterzuarbeiten. Die Farbliste nennt die Garne in Stickreihenfolge, zum Bereitlegen.',
      text: 'Als Projekt speichert alles, um später weiterzuarbeiten. Die Farbliste nennt die Garne in Stickreihenfolge, zum Bereitlegen.',
      textEn: 'As project saves everything, so you can keep working later. The colour list names the threads in stitching order, to lay them out.',
      run: async (s) => {
        await s.zoom([1710, 560, 0, 0], 1.6);
        if (!(await saveMenu(s).isVisible())) await openSave(s);
        const project = saveMenu(s).getByRole('button', { name: /^Als Projekt speichern/ });
        const colors = saveMenu(s).getByRole('button', { name: /^Farbliste drucken/ });
        await s.move(project, 1.0);
        await s.label('Als Projekt speichern', project, 'left');
        await s.wait(3.6);
        await s.move(colors, 0.8);
        await s.label('Farbliste drucken', colors, 'left');
        await s.wait(3.6);
        s.unlabel();
      },
    },
    {
      say: 'Am meisten hilft das Stickblatt. Es zeigt die Vorlage in Originalgröße mit Fadenkreuz zum Ausrichten, darunter die Farben zum Abhaken, Vlies und Nadel. [warm] So liegt alles bereit, bevor die Maschine losläuft. Viel Spaß beim Sticken!',
      text: 'Am meisten hilft das Stickblatt. Es zeigt die Vorlage in Originalgröße mit Fadenkreuz zum Ausrichten, darunter die Farben zum Abhaken, Vlies und Nadel. So liegt alles bereit, bevor die Maschine losläuft. Viel Spaß beim Sticken!',
      textEn: 'The stitch sheet helps the most. It shows the template at actual size with a crosshair for lining up, below it the colours to tick off, stabilizer and needle. That way everything is ready before the machine starts. Have fun embroidering!',
      run: async (s) => {
        await sheetAsTab(s);
        const sheetBtn = saveMenu(s).getByRole('button', { name: /^Stickblatt drucken/ });
        await s.move(sheetBtn, 0.8);
        await s.label('Stickblatt drucken', sheetBtn, 'left');
        await s.wait(1.0);
        await s.click(null, { before: 0.2, after: 0.3 });
        s.unlabel();
        s.zoomOut();
        await until(s, async () => (await sheet(s).getByText('Vorlage 1:1').count()) > 0, 'stitch sheet');
        await s.move([1500, 300], 0.8);
        await s.label('Vorlage 1:1', [866, 244, 188, 112], 'right');
        await s.wait(3.4);
        s.unlabel();
        const colors = sheet(s).getByText('Farben in Stickreihenfolge', { exact: true });
        await scrollSheet(s, 480, 1.6);
        await s.label('Farben zum Abhaken', colors, 'above');
        await s.wait(2.6);
        s.unlabel();
        await scrollSheet(s, 880, 1.4);
        const ready = sheet(s).getByRole('heading', { name: 'Bereit zum Sticken' });
        await s.label('Vlies und Nadel', ready, 'above');
        await s.wait(2.4);
        s.unlabel();
        await s.wait(4.0);
      },
    },
  ],
};

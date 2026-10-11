// Teil 15: Handstiche und Redwork. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit
// englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Demodatei ist material/blumenzweig.svg: Stiel (Light Brown), zwei Blätter (Leaf Green), Blüte
// (Red, ihre Linien berühren sich und kommen als Redwork an) und eine Linie unten (Cornflower
// Blue), alles dünne Linien im Steppstich. Die Objekte werden über ihre Garnfarbe auf der Bühne
// gefunden, nicht über feste Punkte.
import fs from 'node:fs';

const FILE = new URL('./material/blumenzweig.svg', import.meta.url);

// Thread colours as the stage draws them, and a point near each part to pick the nearest stroke.
const STEM = { rgb: [178, 118, 36], near: [850, 680] };
const LEAF = { rgb: [102, 186, 73], near: [1190, 430] };
const BLOSSOM = { rgb: [237, 23, 31], near: [1100, 260] };
const GROUND = { rgb: [75, 107, 175], near: [960, 960] };
// Above the design, so the stage shows no readout next to the pointer.
const REST = [1500, 120];

const btn = (s, name, exact = true) => s.page.getByRole('button', { name, exact }).first();
const radio = (s, group, name) => s.page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app. The browser cannot show a drag from the file manager; the card stands in for
 * it, and the page gets the same dragenter, dragover and drop events with the real file.
 */
const dragFileIn = async (s, from, to) => {
  const text = fs.readFileSync(FILE, 'utf8');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ text, x, y }) => {
      const file = new File([text], 'blumenzweig.svg', { type: 'image/svg+xml' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;background:#141118;padding:4px;box-sizing:border-box';
      const name = document.createElement('span');
      name.textContent = 'blumenzweig.svg';
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
    { text, x: from[0], y: from[1] },
  );
  await s.move(to, 1.6);
  await s.wait(0.5);
  await s.page.evaluate(([x, y]) => window.__dropFile(x, y), to);
};

/** A point well inside a stroke of `part`'s thread colour on the stage, nearest to its `near`. */
const hit = (s, part) =>
  s.page.evaluate(({ rgb, near }) => {
    const c = [...document.querySelectorAll('main canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = c.getBoundingClientRect();
    const { width: w, height: h } = c;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const fx = r.width / w;
    const fy = r.height / h;
    const is = (x, y) => {
      const i = (y * w + x) * 4;
      return Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 60;
    };
    let best = null;
    let bd = Infinity;
    for (let y = 3; y < h - 3; y++)
      for (let x = 3; x < w - 3; x++) {
        if (!is(x, y) || !is(x - 1, y) || !is(x + 1, y) || !is(x, y - 1) || !is(x, y + 1)) continue;
        const px = r.x + x * fx;
        const py = r.y + y * fy;
        const dd = (px - near[0]) ** 2 + (py - near[1]) ** 2;
        if (dd < bd) [bd, best] = [dd, [px, py]];
      }
    return best;
  }, part);

/** Clears the selection, so no colour is dimmed, then clicks `part` on the stage. */
const pick = async (s, part) => {
  await s.page.evaluate(() => document.activeElement?.blur());
  await s.page.keyboard.press('Escape');
  await s.wait(0.3);
  const at = await hit(s, part);
  if (!at) throw new Error(`no stroke in ${part.rgb}`);
  await s.click(at, { move: 1.0, before: 0.3, after: 0.4 });
  await until(s, async () => (await radio(s, 'Stichart', 'Linie').count()) > 0, 'line selected');
};

/** Turns the mouse wheel with Ctrl in small steps at `at`, one per frame, so the zoom glides. */
const wheel = async (s, at, dy, steps = 8) => {
  await s.page.mouse.move(at[0], at[1]);
  await s.page.keyboard.down('Control');
  for (let i = 0; i < steps; i++) {
    await s.page.mouse.wheel(0, dy / steps);
    await s.wait(1 / 30);
  }
  await s.page.keyboard.up('Control');
};

/** Art Motiv, then motif `name`, with labels, in a zoom on the card. */
const motif = async (s, name, { label = true } = {}) => {
  const art = radio(s, 'Art', 'Motiv');
  const m = radio(s, 'Motiv', name);
  if ((await art.getAttribute('aria-checked')) !== 'true') {
    await s.zoom(art, 1.6);
    await s.move(art, 1.0);
    await s.label('Motiv', art, 'above');
    await s.click(null, { before: 0.3, after: 0.6 });
    s.unlabel();
  }
  await s.zoom(m, 1.6);
  await s.move(m, 0.9);
  if (label) await s.label(name, m, 'above');
  await s.click(null, { before: 0.3, after: 0.8 });
  s.unlabel();
};

export default {
  title: 'Handstiche und Redwork',
  part: 15,
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
      say: '[warm] Linien müssen nicht nach Maschine aussehen. heatstitch kennt Handstiche und Redwork. Ich ziehe diesen Blumenzweig ins Fenster: lauter Linien, im Steppstich.',
      text: 'Linien müssen nicht nach Maschine aussehen. heatstitch kennt Handstiche und Redwork. Ich ziehe diesen Blumenzweig ins Fenster: lauter Linien, im Steppstich.',
      textEn: 'Lines need not look machine-made. heatstitch knows hand stitches and redwork. I drag this flower sprig into the window: nothing but lines, in running stitch.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.0);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'blumenzweig', false).count()) > 0, 'blumenzweig opens');
        // A little out, around the top, so the line at the bottom does not lie under the hints at the
        // stage edge.
        await wheel(s, [975, 100], 8, 10);
        await s.move(REST, 1.2);
        await s.wait(2.0);
      },
    },
    {
      say: 'Die Linien der Blüte berühren sich. Deshalb ist schon Durchgehend, also Redwork, an: Alle Linien laufen in einem Zug, jede hin und zurück, ohne Sprung und ohne Fadenschnitt.',
      text: 'Die Linien der Blüte berühren sich. Deshalb ist schon Durchgehend, also Redwork, an: Alle Linien laufen in einem Zug, jede hin und zurück, ohne Sprung und ohne Fadenschnitt.',
      textEn: 'The lines of the blossom touch. That is why Continuous, that is redwork, is already on: all lines run in one go, each there and back, without a jump and without a thread trim.',
      run: async (s) => {
        await pick(s, BLOSSOM);
        const red = s.page.getByRole('checkbox', { name: 'Durchgehend (Redwork)' });
        await s.zoom(red, 1.7);
        await s.move(red, 1.0);
        await s.label('Durchgehend (Redwork)', red, 'above');
        await s.wait(4.0);
        s.unlabel();
        s.zoomOut();
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.move(REST, 0.8);
        await s.press('Home', { label: 'Pos1', show: 0.5 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(4.0);
      },
    },
    {
      say: 'Mit Bohnenstich obenauf läuft der Rückweg jeder Linie dreifach. [pleased] Die Blüte wird kräftiger, wie mit dickerem Garn.',
      text: 'Mit Bohnenstich obenauf läuft der Rückweg jeder Linie dreifach. Die Blüte wird kräftiger, wie mit dickerem Garn.',
      textEn: 'With Bean stitch on top, the way back of each line runs three times. The blossom gets bolder, as with a thicker thread.',
      run: async (s) => {
        const bean = s.page.locator('label.check', { hasText: 'Bohnenstich obenauf' }).first();
        await s.zoom(bean, 1.7);
        await s.move(bean, 1.0);
        await s.label('Bohnenstich obenauf', bean, 'above');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 0.9);
        const at = await hit(s, BLOSSOM);
        await s.zoom([at[0], at[1] - 60, 0, 0], 1.8);
        await s.wait(3.4);
        s.zoomOut();
      },
    },
    {
      say: 'Den Stiel mache ich zum Stielstich: unter Art auf Motiv, dann Stielstich. Unter Ausführung nehme ich Kordel. Jeder Stich liegt schräg über den nächsten, dicht wie eine gedrehte Kordel.',
      text: 'Den Stiel mache ich zum Stielstich: unter Art auf Motiv, dann Stielstich. Unter Ausführung nehme ich Kordel. Jeder Stich liegt schräg über den nächsten, dicht wie eine gedrehte Kordel.',
      textEn: 'I turn the stem into a stem stitch: under Type, Motif, then Stem stitch. Under Execution I take Cord. Every stitch lies slanted over the next, dense like a twisted cord.',
      run: async (s) => {
        await pick(s, STEM);
        await motif(s, 'Stielstich');
        const cord = radio(s, 'Ausführung', 'Kordel');
        await s.zoom(cord, 1.6);
        await s.move(cord, 0.9);
        await s.label('Ausführung: Kordel', cord, 'above');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 0.9);
        const at = await hit(s, STEM);
        await s.zoom(at, 2.2);
        await s.wait(3.4);
        s.zoomOut();
      },
    },
    {
      say: 'Das rechte Blatt bekommt Federstich: offene Schlingen, abwechselnd links und rechts, wie kleine Zweige.',
      text: 'Das rechte Blatt bekommt Federstich: offene Schlingen, abwechselnd links und rechts, wie kleine Zweige.',
      textEn: 'The right leaf gets feather stitch: open loops, alternating left and right, like little twigs.',
      run: async (s) => {
        await pick(s, LEAF);
        await motif(s, 'Federstich');
        s.zoomOut();
        await s.move(REST, 0.9);
        await s.zoom(LEAF.near, 2.0);
        await s.wait(3.2);
        s.zoomOut();
      },
    },
    {
      say: 'Für die Linie unten probiere ich Kretastich und nehme dann Chevron: ein Zickzack mit einem kurzen Steg an jeder Spitze.',
      text: 'Für die Linie unten probiere ich Kretastich und nehme dann Chevron: ein Zickzack mit einem kurzen Steg an jeder Spitze.',
      textEn: 'For the line at the bottom I try cretan stitch and then take chevron: a zigzag with a short bar at each point.',
      run: async (s) => {
        await pick(s, GROUND);
        await motif(s, 'Kretastich');
        s.zoomOut();
        const at = await hit(s, GROUND);
        await s.zoom(at, 1.8);
        await s.wait(2.0);
        s.zoomOut();
        await motif(s, 'Chevron');
        s.zoomOut();
        await s.move(REST, 0.9);
        await s.zoom(at, 1.8);
        await s.wait(2.6);
        s.zoomOut();
      },
    },
    {
      say: 'Stielstich, Federstich, Kretastich und Chevron geben deinen Linien den Look von Handarbeit. [warm] Viel Spaß beim Sticken!',
      text: 'Stielstich, Federstich, Kretastich und Chevron geben deinen Linien den Look von Handarbeit. Viel Spaß beim Sticken!',
      textEn: 'Stem stitch, feather stitch, cretan stitch and chevron give your lines the look of handwork. Have fun embroidering!',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.page.keyboard.press('Escape');
        await s.wait(0.3);
        await s.press('Home', { label: 'Pos1', show: 0.5 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.0);
      },
    },
  ],
};

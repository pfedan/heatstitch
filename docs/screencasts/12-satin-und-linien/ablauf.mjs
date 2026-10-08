// Teil 12: Satin und Linien. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit
// englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Demodatei ist material/abzeichen.svg: Ring (Kontur 4 mm, wird Linie mit Art Satin), Stern
// (Fläche, wird Füllung) und Welle (dünne Linie, wird Steppstich). Punkte auf der Bühne gelten
// für die eingepasste Ansicht bei 1920 × 1080.
import fs from 'node:fs';

const FILE = new URL('./material/abzeichen.svg', import.meta.url);

const STAR = [1110, 405];
const RING = [532, 540];
const WAVE = [921, 835];
// Above the badge, so the stage shows no readout next to the pointer.
const REST = [1500, 120];
// In the top point of the star, found in stills: the divider down its middle (blue, square
// handles), a rung across its left half (yellow, round handles), the order number at its tip,
// and the left handle of a rung that the drag slides down the edge.
const DIVIDER = [968, 222, 14, 156];
const RUNG = [950, 278, 40, 16];
const ORDER = [962, 198, 24, 24];
const RUNG_DRAG = [[940, 330], [922, 368]];
// Fransen an: the side of the ring path that lies outside.
const OUTSIDE = 'Links';

const btn = (s, name, exact = true) => s.page.getByRole('button', { name, exact }).first();
const radio = (s, group, name) => s.page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });
const card = (s) => s.page.getByRole('complementary');
const field = (s, name) =>
  s.page.locator('label.field').filter({ has: s.page.locator('.name', { hasText: new RegExp(`^${name}$`) }) }).first();
const slider = (s, name) => field(s, name).locator('input[type=range]');
const eye = (s) => s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
const viewMenu = (s) => s.page.locator('#view-pop');
const row = (s, name) => s.page.getByText(name, { exact: true }).first();

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/** Scrolls the Objekt card, eased over `sec`, so that `target` sits at `y` on the screen. */
const scrollCard = async (s, target, y, sec = 0.6) => {
  const scroller = await target.evaluateHandle((el) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    return p;
  });
  const box = await target.boundingBox();
  const from = await scroller.evaluate((el) => el.scrollTop);
  const to = Math.max(0, from + box.y - y);
  const n = Math.max(1, Math.round(sec * 30));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await scroller.evaluate((el, v) => (el.scrollTop = v), from + (to - from) * e);
    await s.wait(1 / 30);
  }
};

/** Drags a card slider to `value`, then sets it exactly (the thumb lands within a pixel). */
const slide = async (s, name, value, sec = 1.2) => {
  const input = slider(s, name);
  const b = await input.boundingBox();
  const [min, max, cur] = await input.evaluate((el) => [Number(el.min), Number(el.max), Number(el.value)]);
  const x = (v) => b.x + 8 + ((v - min) / (max - min)) * (b.width - 16);
  const y = b.y + b.height / 2;
  await s.drag([[x(cur), y], [x(value), y]], { sec });
  await input.evaluate((el, v) => {
    if (Number(el.value) === v) return;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await s.wait(0.3);
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
      const file = new File([text], 'abzeichen.svg', { type: 'image/svg+xml' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;background:#141118;padding:4px;box-sizing:border-box';
      const name = document.createElement('span');
      name.textContent = 'abzeichen.svg';
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

/** Clicks an object on the stage and waits until the Objekt card shows its colour. */
const pickOnStage = async (s, at, color) => {
  await s.click(at, { move: 1.0, before: 0.3, after: 0.4 });
  await until(s, async () => (await card(s).getByText(color, { exact: true }).count()) > 0, `${color} selected`);
};

export default {
  title: 'Satin und Linien',
  part: 12,
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
      say: '[warm] Satin sind glatte, glänzende Säulen: Jeder Stich geht von Rand zu Rand. Ich ziehe dieses Abzeichen ins Fenster. Ein Ring, ein Stern und eine Welle.',
      text: 'Satin sind glatte, glänzende Säulen: Jeder Stich geht von Rand zu Rand. Ich ziehe dieses Abzeichen ins Fenster. Ein Ring, ein Stern und eine Welle.',
      textEn: 'Satin means smooth, shiny columns: every stitch goes from edge to edge. I drag this badge into the window. A ring, a star and a wave.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(3.4);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'abzeichen', false).count()) > 0, 'abzeichen opens');
        await s.move(REST, 1.2);
        await s.wait(2.0);
      },
    },
    {
      say: 'Der Stern ist noch eine Füllung. Rechts in der Karte Objekt klicke ich unter Stichart auf Satin. Für eine einzige Säule ist der Stern zu breit, deshalb öffnet heatstitch oben das Werkzeug mit Querlinien.',
      text: 'Der Stern ist noch eine Füllung. Rechts in der Karte Objekt klicke ich unter Stichart auf Satin. Für eine einzige Säule ist der Stern zu breit, deshalb öffnet heatstitch oben das Werkzeug mit Querlinien.',
      textEn: 'The star is still a fill. On the right, in the Object card, I click Satin under Stitch type. The star is too wide for a single column, so heatstitch opens the tool with rungs at the top.',
      run: async (s) => {
        await pickOnStage(s, STAR, '2. Harvest Gold');
        const fill = radio(s, 'Stichart', 'Füllung');
        const satin = radio(s, 'Stichart', 'Satin');
        await s.zoom(fill, 1.7);
        await s.move(fill, 1.0);
        await s.label('Füllung', fill, 'above');
        await s.wait(1.6);
        await s.move(satin, 0.7);
        await s.label('Satin', satin, 'above');
        await s.wait(0.6);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await until(s, async () => (await btn(s, 'Vorschlagen').count()) > 0, 'Zu Satin tool');
        const rung = s.page.getByRole('radio', { name: 'Querlinie' }).or(btn(s, 'Querlinie')).first();
        await s.zoom([700, 114, 0, 0], 1.6);
        await s.move(rung, 1.0);
        await s.label('Querlinie', rung, 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: '[curious] Ein Klick auf Vorschlagen, und der Stern ist zerlegt. Trennlinien teilen ihn in Abschnitte, hier jede Zacke in zwei Hälften. Querlinien zeigen die Richtung der Stiche. Dazwischen dreht sie sich weich mit.',
      text: 'Ein Klick auf Vorschlagen, und der Stern ist zerlegt. Trennlinien teilen ihn in Abschnitte, hier jede Zacke in zwei Hälften. Querlinien zeigen die Richtung der Stiche. Dazwischen dreht sie sich weich mit.',
      textEn: 'One click on Suggest, and the star is split up. Dividers cut it into sections, here every point into two halves. Rungs show the direction of the stitches. In between, it turns smoothly.',
      run: async (s) => {
        await s.click(btn(s, 'Vorschlagen'), { move: 0.9, before: 0.3, after: 0.6 });
        await until(s, async () => (await s.page.getByText(/zerlegt: \d+ Abschnitte/).count()) > 0, 'suggestion');
        await s.zoom([975, 330, 0, 0], 1.8);
        await s.move([1060, 200], 1.0);
        await s.wait(1.4);
        await s.label('Trennlinie', DIVIDER, 'right');
        await s.wait(3.0);
        await s.label('Querlinie', RUNG, 'right');
        await s.wait(3.4);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Als Satin sticken. [delighted] Und schon glänzt der Stern, jede Zacke wie gefaltet.',
      text: 'Als Satin sticken. Und schon glänzt der Stern, jede Zacke wie gefaltet.',
      textEn: 'Stitch as satin. And the star shines, every point as if folded.',
      run: async (s) => {
        const sew = btn(s, 'Als Satin sticken');
        await s.zoom(sew, 1.5);
        await s.move(sew, 1.0);
        await s.label('Als Satin sticken', sew, 'below');
        await s.click(null, { before: 0.4, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await until(s, async () => (await card(s).getByText('Satin 1', { exact: true }).count()) > 0, 'star sewn as satin');
        await s.move(REST, 1.0);
        await s.zoom([975, 440, 0, 0], 1.6);
        await s.wait(2.4);
        s.zoomOut();
      },
    },
    {
      say: 'Jeder Satin öffnet sich mit der Taste R wieder in seinen Abschnitten, auch einer aus einer Stickdatei. Die Zahlen zeigen, in welcher Reihenfolge gestickt wird. Ziehst du an einer Querlinie, drehen sich die Stiche mit.',
      text: 'Jeder Satin öffnet sich mit der Taste R wieder in seinen Abschnitten, auch einer aus einer Stickdatei. Die Zahlen zeigen, in welcher Reihenfolge gestickt wird. Ziehst du an einer Querlinie, drehen sich die Stiche mit.',
      textEn: 'Every satin opens again in its sections with the R key, even one from an embroidery file. The numbers show the order of stitching. Drag a rung, and the stitches turn with it.',
      run: async (s) => {
        await s.move([1250, 300], 0.8);
        await s.press('r', { label: 'R', show: 1.4 });
        await until(s, async () => (await btn(s, 'Fertig').count()) > 0, 'Richtung tool');
        await s.wait(1.6);
        await s.zoom([975, 400, 0, 0], 1.6);
        await s.label('Reihenfolge', ORDER, 'right');
        await s.wait(2.8);
        s.unlabel();
        await s.drag(RUNG_DRAG, { sec: 1.4 });
        await s.move([1250, 330], 0.8);
        await s.wait(1.6);
        s.zoomOut();
        await s.click(btn(s, 'Fertig'), { move: 0.9, before: 0.3, after: 0.4 });
        await s.move(REST, 0.8);
      },
    },
    {
      say: 'Unter Stoff und Halt steht Zugausgleich auf Nach Stoff. Der Faden zieht den Stoff beim Sticken etwas zusammen. Deshalb stickt heatstitch jede Säule eine Spur breiter, passend zu deinem Stoff.',
      text: 'Unter Stoff und Halt steht Zugausgleich auf Nach Stoff. Der Faden zieht den Stoff beim Sticken etwas zusammen. Deshalb stickt heatstitch jede Säule eine Spur breiter, passend zu deinem Stoff.',
      textEn: 'Under Fabric and support, pull compensation is set to By fabric. The thread pulls the fabric together a little while stitching. So heatstitch stitches every column a touch wider, matched to your fabric.',
      run: async (s) => {
        const pull = field(s, 'Zugausgleich');
        await scrollCard(s, pull, 640);
        await s.zoom(pull, 1.8);
        await s.move(pull, 1.0);
        await s.label('Zugausgleich', pull, 'above');
        await s.wait(6.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Der Ring ist eine Linie. Unter Art steht Satin: eine Säule, die der Linie folgt, hier vier Millimeter breit.',
      text: 'Der Ring ist eine Linie. Unter Art steht Satin: eine Säule, die der Linie folgt, hier vier Millimeter breit.',
      textEn: 'The ring is a line. Under Type it says Satin: a column that follows the line, here four millimetres wide.',
      run: async (s) => {
        await pickOnStage(s, RING, '1. Tangerine');
        const line = radio(s, 'Stichart', 'Linie');
        const art = radio(s, 'Art', 'Satin');
        const width = field(s, 'Breite');
        await s.zoom(art, 1.7);
        await s.move(line, 1.0);
        await s.label('Linie', line, 'above');
        await s.wait(1.4);
        await s.move(art, 0.7);
        await s.label('Art: Satin', art, 'above');
        await s.wait(1.8);
        await s.move(width, 0.7);
        await s.label('Breite', width, 'above');
        await s.wait(1.8);
        s.unlabel();
      },
    },
    {
      say: '[enthusiastic] Mit Fransen wird der Rand ausgefranst, wie Fell oder Federn. Ich nehme nur die Außenseite. Jetzt sieht der Ring aus wie ein echter Aufnäher.',
      text: 'Mit Fransen wird der Rand ausgefranst, wie Fell oder Federn. Ich nehme nur die Außenseite. Jetzt sieht der Ring aus wie ein echter Aufnäher.',
      textEn: 'Fringe frays the edge, like fur or feathers. I take only the outside. Now the ring looks like a real patch.',
      run: async (s) => {
        const fringe = field(s, 'Fransen');
        await s.zoom(fringe, 1.7);
        await s.label('Fransen', fringe, 'above');
        await slide(s, 'Fransen', 1.5, 1.4);
        s.unlabel();
        const outside = radio(s, 'Fransen an', OUTSIDE);
        await s.move(outside, 0.8);
        await s.label('Außen', outside, 'below');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(2.6);
      },
    },
    {
      say: 'Die Welle ist eine Linie im Steppstich. Unter Wiederholung wähle ich dreifach. Jeder Stich läuft dann dreimal, und die Linie wird kräftig.',
      text: 'Die Welle ist eine Linie im Steppstich. Unter Wiederholung wähle ich dreifach. Jeder Stich läuft dann dreimal, und die Linie wird kräftig.',
      textEn: 'The wave is a running stitch line. Under Repeat I choose triple. Every stitch then runs three times, and the line becomes bold.',
      run: async (s) => {
        await pickOnStage(s, WAVE, '3. Cornflower Blue');
        const triple = radio(s, 'Wiederholung', '3-fach');
        await scrollCard(s, triple, 560);
        await s.zoom(triple, 1.7);
        await s.move(radio(s, 'Art', 'Steppstich'), 1.0);
        await s.label('Steppstich', radio(s, 'Art', 'Steppstich'), 'above');
        await s.wait(1.8);
        await s.move(triple, 0.8);
        await s.label('Wiederholung', triple, 'above');
        await s.wait(0.8);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.zoom([921, 820, 0, 0], 1.6);
        await s.wait(2.4);
        s.zoomOut();
      },
    },
    {
      say: 'Unter Effekte macht Echo Kopien neben der Linie. Ich nehme beide Seiten, je eine Kopie, mit wenig Abstand. [delighted] Aus einer Welle werden drei.',
      text: 'Unter Effekte macht Echo Kopien neben der Linie. Ich nehme beide Seiten, je eine Kopie, mit wenig Abstand. Aus einer Welle werden drei.',
      textEn: 'Under Effects, Echo makes copies next to the line. I take both sides, one copy each, close together. One wave becomes three.',
      run: async (s) => {
        const both = radio(s, 'Echo', 'Beide');
        await scrollCard(s, both, 420);
        await s.zoom(both, 1.6);
        await s.move(both, 1.0);
        await s.label('Echo', both, 'above');
        await s.click(null, { before: 0.4, after: 0.5 });
        s.unlabel();
        await until(s, async () => (await field(s, 'Kopien je Seite').count()) > 0, 'echo options');
        await s.label('Kopien je Seite', field(s, 'Kopien je Seite'), 'above');
        await slide(s, 'Kopien je Seite', 1, 0.8);
        s.unlabel();
        await s.label('Abstand', field(s, 'Abstand').last(), 'above');
        await slide(s, 'Abstand', 1.5, 1.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.zoom([921, 820, 0, 0], 1.6);
        await s.wait(2.4);
        s.zoomOut();
      },
    },
    {
      say: 'Schatten legt eine versetzte Kopie darunter. Sie bekommt links in der Liste eine eigene Farbe, dunkelgrau. So hebt sich die Welle vom Stoff ab.',
      text: 'Schatten legt eine versetzte Kopie darunter. Sie bekommt links in der Liste eine eigene Farbe, dunkelgrau. So hebt sich die Welle vom Stoff ab.',
      textEn: 'Shadow puts an offset copy underneath. It gets its own colour in the list on the left, dark grey. That makes the wave stand out from the fabric.',
      run: async (s) => {
        const se = radio(s, 'Schatten', '↘');
        await scrollCard(s, se, 560);
        await s.zoom(se, 1.6);
        await s.move(se, 1.0);
        await s.label('Schatten', se, 'above');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        const shade = s.page.locator('.layer-name', { hasText: /Farbe 3$/ }).first();
        await until(s, async () => (await shade.count()) > 0, 'shadow colour');
        await s.zoom(shade, 1.6);
        await s.move(shade, 1.2);
        await s.label('Neue Farbe', shade, 'right');
        await s.wait(2.6);
        s.unlabel();
        s.zoomOut();
        await s.zoom([921, 820, 0, 0], 1.6);
        await s.move([1300, 700], 1.0);
        await s.wait(2.2);
        s.zoomOut();
      },
    },
    {
      say: '[proud warm] Satin für die glänzenden Flächen, Linien für Ränder und Wellen, und das Abzeichen ist fertig. Viel Spaß beim Sticken!',
      text: 'Satin für die glänzenden Flächen, Linien für Ränder und Wellen, und das Abzeichen ist fertig. Viel Spaß beim Sticken!',
      textEn: 'Satin for the shiny areas, lines for edges and waves, and the badge is done. Have fun embroidering!',
      run: async (s) => {
        await s.press('Escape', { show: 0 });
        await s.click(eye(s), { move: 1.0, before: 0.3, after: 0.4 });
        const real = viewMenu(s).getByText('Realistische Fäden', { exact: true }).first();
        await s.click(real, { move: 0.8, before: 0.3, after: 0.5 });
        await s.press('Escape', { show: 0 });
        await s.move(REST, 1.2);
        await s.wait(4.0);
      },
    },
  ],
};

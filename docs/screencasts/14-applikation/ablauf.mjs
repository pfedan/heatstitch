// Teil 14: Applikation. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit englischer
// Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die Szenenlänge. `text`
// und `textEn` sind die Untertitel, ohne Regie.
//
// Demodatei ist material/apfel.svg: Apfel (Fläche, wird Füllung, dann Applikation) und Stiel
// (Linie). Punkte auf der Bühne gelten für die eingepasste Ansicht bei 1920 × 1080.
import fs from 'node:fs';

const FILE = new URL('./material/apfel.svg', import.meta.url);

const APPLE = [960, 600];
// Above the apple, so the stage shows no readout next to the pointer.
const REST = [1500, 120];
// On the outline of the apple: the upper left lobe, where placement and tack-down lines run.
const OUTLINE = [700, 238, 140, 40];
// Just inside it, where the tack-down line runs.
const TACK = [700, 250, 140, 40];
// The left side of the apple, where the edge runs.
const EDGE = [536, 520, 40, 160];

const btn = (s, name, exact = true) => s.page.getByRole('button', { name, exact }).first();
const radio = (s, group, name) => s.page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });
const card = (s) => s.page.locator('#inspector');
const field = (s, name) =>
  s.page.locator('label.field').filter({ has: s.page.locator('.name', { hasText: new RegExp(`^${name}$`) }) }).first();
const slider = (s, name) => field(s, name).locator('input[type=range]');

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
      const file = new File([text], 'apfel.svg', { type: 'image/svg+xml' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;background:#141118;padding:4px;box-sizing:border-box';
      const name = document.createElement('span');
      name.textContent = 'apfel.svg';
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

const saveButton = (s) => s.page.getByRole('button', { name: 'Speichern', exact: true }).first();
const saveMenu = (s) => s.page.getByRole('dialog', { name: 'Speichern' });
/** Opens the Speichern menu at the top right. */
const openSave = async (s) => {
  await s.click(saveButton(s), { move: 0.9, before: 0.3, after: 0.5 });
  await until(s, async () => saveMenu(s).isVisible(), 'Speichern menu');
};

export default {
  title: 'Applikation',
  part: 14,
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
      say: '[warm] Bei einer Applikation näht die Maschine ein Stück Stoff auf, statt eine Fläche mit Stichen zu füllen. Ich ziehe diesen Apfel ins Fenster.',
      text: 'Bei einer Applikation näht die Maschine ein Stück Stoff auf, statt eine Fläche mit Stichen zu füllen. Ich ziehe diesen Apfel ins Fenster.',
      textEn: 'With an appliqué, the machine sews on a piece of fabric instead of filling an area with stitches. I drag this apple into the window.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.0);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'apfel', false).count()) > 0, 'apfel opens');
        await s.move(REST, 1.2);
        await s.wait(1.6);
      },
    },
    {
      say: 'Ich klicke den Apfel an. Rechts unter Stichart wähle ich Applikation, den vierten Knopf. Darunter steht der Ablauf: drei Teile mit zwei Stopps.',
      text: 'Ich klicke den Apfel an. Rechts unter Stichart wähle ich Applikation, den vierten Knopf. Darunter steht der Ablauf: drei Teile mit zwei Stopps.',
      textEn: 'I click the apple. On the right under Stitch type I choose Appliqué, the fourth button. Below it you see the steps: three parts with two stops.',
      run: async (s) => {
        await s.click(APPLE, { move: 1.0, before: 0.3, after: 0.4 });
        await until(s, async () => (await card(s).getByText('Füllung 1', { exact: true }).count()) > 0, 'apple selected');
        const appl = radio(s, 'Stichart', 'Applikation');
        await s.zoom(appl, 1.7);
        await s.move(appl, 1.2);
        await s.label('Applikation', appl, 'above');
        await s.wait(1.2);
        await s.click(null, { before: 0.2, after: 0.6 });
        s.unlabel();
        const steps = card(s).getByText(/^Drei Teile mit zwei Stopps/);
        await until(s, async () => (await steps.count()) > 0, 'appliqué steps');
        await s.move(steps, 0.9);
        await s.label('Ablauf', steps, 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Unter Kante ist Satin gewählt, der übliche Abschluss. Für Filz passt auch der E-Stich. Die Breite stelle ich auf dreieinhalb Millimeter, der grüne Streifen zeigt, was üblich ist.',
      text: 'Unter Kante ist Satin gewählt, der übliche Abschluss. Für Filz passt auch der E-Stich. Die Breite stelle ich auf dreieinhalb Millimeter, der grüne Streifen zeigt, was üblich ist.',
      textEn: 'Under Edge, Satin is chosen, the usual finish. For felt the E stitch works too. I set the width to three and a half millimetres; the green band shows what is usual.',
      run: async (s) => {
        const satin = radio(s, 'Kante', 'Satin');
        const e = radio(s, 'Kante', 'E-Stich');
        await s.zoom(satin, 1.7);
        await s.move(satin, 1.0);
        await s.label('Kante: Satin', satin, 'above');
        await s.wait(2.6);
        await s.move(e, 0.7);
        await s.label('E-Stich', e, 'above');
        await s.wait(2.0);
        s.unlabel();
        await s.label('Breite', field(s, 'Breite'), 'above');
        await slide(s, 'Breite', 3.5, 1.4);
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Unter Stoff wählst du Stoffart und Stofffarbe. Ich nehme ein helles Rot. Das ändert keinen Stich, nur die Ansicht.',
      text: 'Unter Stoff wählst du Stoffart und Stofffarbe. Ich nehme ein helles Rot. Das ändert keinen Stich, nur die Ansicht.',
      textEn: 'Under Fabric you choose the kind of fabric and its color. I take a bright red. That changes no stitch, only the view.',
      run: async (s) => {
        const cotton = radio(s, 'Stoff', 'Baumwolle');
        const color = btn(s, 'Wie das Garn');
        await s.zoom(cotton, 1.6);
        await s.move(cotton, 1.0);
        await s.label('Stoff', cotton, 'above');
        await s.wait(1.4);
        s.unlabel();
        await s.label('Stofffarbe', color, 'above');
        await s.click(color, { move: 0.8, before: 0.3, after: 0.6 });
        s.unlabel();
        const red = btn(s, '800 Red');
        await s.click(red, { move: 1.0, before: 0.4, after: 0.6 });
        s.zoomOut();
        await s.page.keyboard.press('Escape');
        await s.move(REST, 1.0);
        await s.wait(1.4);
      },
    },
    {
      say: 'Unten im Player springe ich durch die Teile. Zuerst stickt die Maschine die Platzierungslinie, genau auf dem Umriss. Dann stoppt sie, und du legst den Stoff darüber.',
      text: 'Unten im Player springe ich durch die Teile. Zuerst stickt die Maschine die Platzierungslinie, genau auf dem Umriss. Dann stoppt sie, und du legst den Stoff darüber.',
      textEn: 'Down in the player I jump through the parts. First the machine stitches the placement line, right on the outline. Then it stops, and you lay the fabric over it.',
      run: async (s) => {
        // Nothing selected, so the stage shows the stitches without frame and handles.
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.page.keyboard.press('Escape');
        await s.wait(0.3);
        await s.page.keyboard.press('Escape');
        await s.press('Home', { label: 'Pos1', show: 0.6 });
        const next = btn(s, 'Zur nächsten Farbe');
        await s.zoom([500, 1056, 0, 0], 1.6);
        await s.move(next, 1.0);
        await s.label('nächste Farbe', next, 'above');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.label('Platzierungslinie', OUTLINE, 'above');
        await s.wait(4.0);
        s.unlabel();
      },
    },
    {
      say: 'Die Heftlinie hält den Stoff fest. Beim zweiten Stopp nimmst du den Rahmen ab, ohne auszuspannen, und schneidest den Stoff knapp an der Heftlinie ab.',
      text: 'Die Heftlinie hält den Stoff fest. Beim zweiten Stopp nimmst du den Rahmen ab, ohne auszuspannen, und schneidest den Stoff knapp an der Heftlinie ab.',
      textEn: 'The tack-down line holds the fabric in place. At the second stop you take the hoop off without unhooping and trim the fabric close to the tack-down line.',
      run: async (s) => {
        const next = btn(s, 'Zur nächsten Farbe');
        await s.click(next, { move: 1.0, before: 0.3, after: 0.6 });
        await s.move(REST, 1.0);
        await s.label('Heftlinie', TACK, 'above');
        await s.zoom([780, 400, 0, 0], 1.6);
        await s.wait(5.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: '[pleased] Mit der Leertaste geht es weiter: Die Kante deckt die Schnittkante ab, zuletzt kommt der Stiel.',
      text: 'Mit der Leertaste geht es weiter: Die Kante deckt die Schnittkante ab, zuletzt kommt der Stiel.',
      textEn: 'The space bar carries on: the edge covers the cut edge, the stem comes last.',
      run: async (s) => {
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(2.0);
        await s.label('Kante', EDGE, 'right');
        await s.wait(4.0);
        s.unlabel();
      },
    },
    {
      say: 'Gespeichert wird wie immer, etwa als PES. Die Stopps stehen in der Datei als Farbwechsel zur selben Farbe: Deine Maschine hält an und zeigt dasselbe Garn noch einmal. [warm] Viel Spaß beim Sticken!',
      text: 'Gespeichert wird wie immer, etwa als PES. Die Stopps stehen in der Datei als Farbwechsel zur selben Farbe: Deine Maschine hält an und zeigt dasselbe Garn noch einmal. Viel Spaß beim Sticken!',
      textEn: 'Saving works as always, say as PES. The stops are in the file as color changes to the same color: your machine halts and shows the same thread once more. Have fun embroidering!',
      run: async (s) => {
        await s.zoom([1710, 300, 0, 0], 1.5);
        await openSave(s);
        const pes = saveMenu(s).locator('label', { has: s.page.getByRole('radio', { name: /^PES/ }) }).first();
        await s.label('PES', pes, 'left');
        await s.click(pes, { move: 1.0, before: 0.3, after: 0.6 });
        s.unlabel();
        const save = saveMenu(s).getByRole('button', { name: 'Speichern', exact: true });
        await s.click(save, { move: 0.8, before: 0.4, after: 0.4 });
        await s.label('apfel.pes', saveButton(s), 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(3.0);
      },
    },
  ],
};

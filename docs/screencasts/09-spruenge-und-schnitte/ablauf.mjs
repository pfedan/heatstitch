// Teil 9: Sprünge und Schnitte. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Demodatei ist ein Konfetti mit 15 Punkten in Pingpong-Reihenfolge und losen Sprüngen
// (tests/fixtures/pingpong-confetti.pes, siehe vorlage.md), ins Fenster gezogen als konfetti.pes. Die Prüfung rechnet in Workern in Echtzeit; wo sie
// neu rechnet, wartet die Szene in kurzen s.wait-Schritten auf das Ergebnis.
import fs from 'node:fs';

const FILE = new URL('../../../tests/fixtures/pingpong-confetti.pes', import.meta.url);

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
// Gestalten and Prüfen are radio buttons inside their labels.
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();
const uncutNote = (s) => s.page.getByText(/Sprünge? ab .* ohne Schnitt/).first();

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/**
 * Scrolls the right column by `dy` CSS px over `sec`. The wheel would scroll whatever list
 * lies under the pointer (Befunde has its own), so the column itself is moved, eased.
 */
const scrollAside = async (s, dy, sec = 0.8) => {
  const aside = s.page.getByRole('complementary');
  const from = await aside.evaluate((el) => el.scrollTop);
  const to = await aside.evaluate((el, y) => Math.max(0, Math.min(el.scrollHeight - el.clientHeight, y)), from + dy);
  const n = Math.max(1, Math.round(sec * 30));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await aside.evaluate((el, y) => (el.scrollTop = y), from + (to - from) * e);
    await s.wait(1 / 30);
  }
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
      const file = new File([bytes], 'konfetti.pes', { type: 'application/octet-stream' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const icon = document.createElement('div');
      icon.textContent = 'PES';
      icon.style.cssText =
        'width:64px;height:64px;border-radius:8px;display:grid;place-items:center;background:#141118;color:#f7a23b;' +
        'font:700 15px Inter,system-ui,sans-serif;letter-spacing:.06em';
      const name = document.createElement('span');
      name.textContent = 'konfetti.pes';
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


/** Scrolls the right column so that `target` sits `offset` px below its top. */
const scrollAsideTo = async (s, target, offset, sec = 0.9) => {
  const top = await s.page.getByRole('complementary').evaluate((el) => el.getBoundingClientRect().top);
  await scrollAside(s, (await target.boundingBox()).y - top - offset, sec);
};

// Off the motif, so the stage shows no readout next to the pointer.
const REST = [1500, 160];

export default {
  title: 'Sprünge und Schnitte',
  part: 9,
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
      say: '[warm] Zwischen zwei Teilen einer Farbe springt die Nadel. Ob die Maschine dort den Faden schneidet, siehst du in heatstitch auf einen Blick. Ich ziehe dieses Konfetti ins Fenster.',
      text: 'Zwischen zwei Teilen einer Farbe springt die Nadel. Ob die Maschine dort den Faden schneidet, siehst du in heatstitch auf einen Blick. Ich ziehe dieses Konfetti ins Fenster.',
      textEn: 'Between two parts of one color, the needle jumps. Whether the machine trims the thread there, heatstitch shows you at a glance. I drag this confetti into the window.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.6);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'konfetti.pes').count()) > 0, 'konfetti.pes opens');
        await s.move(REST, 1.2);
        await s.wait(1.4);
      },
    },
    {
      say: '[concerned] Die dicken Linien quer über das Muster sind Sprünge ohne Schnitt: Dort liegt der Faden später lose auf dem Stoff. Nur an einer Stelle zeigt eine kleine Schere einen Schnitt.',
      text: 'Die dicken Linien quer über das Muster sind Sprünge ohne Schnitt: Dort liegt der Faden später lose auf dem Stoff. Nur an einer Stelle zeigt eine kleine Schere einen Schnitt.',
      textEn: 'The thick lines across the design are jumps without a trim: there the thread will lie loose on the fabric. Only in one place does a little pair of scissors show a trim.',
      run: async (s) => {
        await s.zoom([960, 380, 0, 0], 1.3);
        await s.move([760, 262], 1.0);
        await s.label('Sprung ohne Schnitt', [740, 238, 460, 34], 'above');
        await s.move([1180, 246], 2.4);
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
        await s.zoom([958, 760, 0, 0], 1.8);
        await s.move([930, 790], 1.0);
        await s.label('Schnitt', [949, 766, 18, 18], 'above');
        await s.wait(2.6);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Rechts klappst du Sprünge und Schnitte auf. Der gelbe Hinweis sagt: Neunzehn lange Sprünge sind nicht geschnitten.',
      text: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Rechts klappst du Sprünge und Schnitte auf. Der gelbe Hinweis sagt: Neunzehn lange Sprünge sind nicht geschnitten.',
      textEn: 'At the top you click Check, or you press the 2 key. On the right you open Jumps and trims. The yellow note says: nineteen long jumps are not trimmed.',
      run: async (s) => {
        const check = mode(s, /^Prüfen/);
        await s.move(check, 0.9);
        await s.label('Prüfen', check, 'below');
        await s.wait(0.5);
        s.keyCap('2');
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        s.keyCap(null);
        await until(s, async () => (await s.page.getByRole('heading', { name: /Sprünge und Schnitte/ }).count()) > 0, 'check');
        const heading = s.page.getByRole('heading', { name: /Sprünge und Schnitte/ }).first();
        // Opened where it is: scrolled down first, the column would jump on opening (scroll anchoring).
        await s.click(heading, { move: 1.0, before: 0.3, after: 0.5 });
        await s.zoom([1760, 260, 0, 0], 1.6);
        await s.move(uncutNote(s), 0.9);
        await s.label('19 ohne Schnitt', uncutNote(s), 'below');
        await s.wait(3.6);
        s.unlabel();
      },
    },
    {
      say: 'Darunter steht jeder Sprung mit seiner Länge. Ein Klick zeigt ihn auf der Bühne. Dieser ist über sechs Zentimeter lang.',
      text: 'Darunter steht jeder Sprung mit seiner Länge. Ein Klick zeigt ihn auf der Bühne. Dieser ist über sechs Zentimeter lang.',
      textEn: 'Below, every jump is listed with its length. A click shows it on the stage. This one is more than six centimeters long.',
      run: async (s) => {
        await s.move([1760, 600], 0.6);
        await scrollAsideTo(s, s.page.getByRole('heading', { name: /Sprünge und Schnitte/ }).first(), 40);
        await s.move(s.page.getByText('Sprung 1', { exact: true }).first(), 0.9);
        await s.wait(1.2);
        const jump = s.page.getByText('Sprung 2', { exact: true }).first();
        await s.click(jump, { move: 0.9, before: 0.4, after: 0.6 });
        s.zoomOut();
        await s.wait(0.6);
        await s.move(REST, 1.0);
        await s.label('63,8 mm', [740, 525, 120, 40], 'above');
        await s.wait(2.6);
        s.unlabel();
      },
    },
    {
      say: 'Schneiden und vernähen sichert den Faden mit ein paar kleinen Stichen. Dann schneidet die Maschine und setzt am nächsten Punkt neu an.',
      text: 'Schneiden und vernähen sichert den Faden mit ein paar kleinen Stichen. Dann schneidet die Maschine und setzt am nächsten Punkt neu an.',
      textEn: 'Trim and tie off secures the thread with a few small stitches. Then the machine trims and starts again at the next dot.',
      run: async (s) => {
        const cut = btn(s, 'Schneiden und vernähen', true);
        await s.zoom([1760, 560, 0, 0], 1.5);
        await s.move(cut, 1.0);
        await s.label('Schneiden und vernähen', cut, 'above');
        await s.wait(1.4);
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(4.0);
      },
    },
    {
      say: 'Alle auf einmal geht nach Länge. Unter Schneiden ab steht die Grenze, drei Millimeter. Ab Grenze schneiden schneidet jeden längeren Sprung. [satisfied] Jetzt liegt kein Faden mehr lose. Darunter nicht schneiden macht das Gegenteil für kurze Sprünge, das spart Zeit.',
      text: 'Alle auf einmal geht nach Länge. Unter Schneiden ab steht die Grenze, drei Millimeter. Ab Grenze schneiden schneidet jeden längeren Sprung. Jetzt liegt kein Faden mehr lose. Darunter nicht schneiden macht das Gegenteil für kurze Sprünge, das spart Zeit.',
      textEn: 'All at once goes by length. Under Trim from you see the limit, three millimeters. Trim from limit trims every longer jump. Now no thread lies loose anymore. Do not trim below does the opposite for short jumps, which saves time.',
      run: async (s) => {
        const all = btn(s, /^Ab Grenze schneiden/);
        await s.move([1760, 600], 0.8);
        await scrollAsideTo(s, all, 260);
        const limit = s.page.getByText('Schneiden ab', { exact: true }).first();
        await s.zoom(all, 1.6);
        await s.move(limit, 0.9);
        await s.label('3 mm', limit, 'above');
        await s.wait(2.6);
        s.unlabel();
        await s.move(all, 0.8);
        await s.label('Ab Grenze schneiden', all, 'above');
        await s.wait(1.0);
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        await s.wait(3.0);
        const below = btn(s, /^Darunter nicht schneiden/);
        await s.move(below, 0.9);
        await s.label('Darunter nicht schneiden', below, 'below');
        await s.wait(3.6);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Mit der Taste 1 geht es zurück zu Gestalten. Die Schnitte sitzen, aber die Wege kreuzen sich quer über das Muster. Links oben klickst du auf Reihenfolge optimieren. [pleased] Die Wege werden viel kürzer, und was oben liegt, bleibt oben. Dann auf Übernehmen.',
      text: 'Mit der Taste 1 geht es zurück zu Gestalten. Die Schnitte sitzen, aber die Wege kreuzen sich quer über das Muster. Links oben klickst du auf Reihenfolge optimieren. Die Wege werden viel kürzer, und was oben liegt, bleibt oben. Dann auf Übernehmen.',
      textEn: 'With the 1 key you go back to Design. The trims are in place, but the paths cross all over the design. At the top left you click Optimize order. The paths get much shorter, and what lies on top stays on top. Then Apply.',
      run: async (s) => {
        await s.move(REST, 0.6);
        await s.press('1', { label: '1', show: 0.8 });
        await until(s, async () => (await btn(s, /Reihenfolge optimieren/).count()) > 0, 'design');
        // Gestalten opens on the jump chosen in Prüfen; Einpassen shows the whole design.
        await s.click(btn(s, 'Einpassen'), { move: 1.0, before: 0.2, after: 0.5 });
        await s.move([830, 420], 1.2);
        await s.wait(3.4);
        const opt = btn(s, /Reihenfolge optimieren/);
        await s.zoom([200, 260, 0, 0], 1.8);
        await s.click(opt, { move: 1.0, before: 0.4, after: 0.6 });
        await until(s, async () => (await s.page.getByText('Eine bessere Reihenfolge:').count()) > 0, 'order found');
        const row = s.page.locator('.order-table tr', { hasText: 'Wege' }).first();
        await s.move(row, 0.8);
        await s.label('kürzere Wege', row, 'below');
        await s.wait(3.8);
        s.unlabel();
        await s.click(btn(s, 'Übernehmen', true), { move: 0.9, before: 0.4, after: 0.6 });
        s.zoomOut();
        await s.move([830, 420], 1.0);
        await s.wait(1.6);
      },
    },
    {
      say: 'Mit der Leertaste siehst du, wie die Maschine jetzt stickt: Punkt für Punkt, ohne Umwege. [warm] Viel Spaß beim Sticken!',
      text: 'Mit der Leertaste siehst du, wie die Maschine jetzt stickt: Punkt für Punkt, ohne Umwege. Viel Spaß beim Sticken!',
      textEn: 'With the space bar you see how the machine stitches now: dot by dot, without detours. Have fun embroidering!',
      run: async (s) => {
        await s.move(REST, 0.8);
        // At 50× the eight dots would be done in two seconds; 10× lets the eye follow.
        await s.page.getByRole('combobox', { name: /^Tempo/ }).selectOption('10');
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('Home', { show: 0 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(11.0);
      },
    },
  ],
};

// Teil 8: Beheben und vergleichen. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Prüfung und Lösungssuche rechnen in Workern in Echtzeit. Wo sie rechnen, wartet die Szene in
// kurzen s.wait-Schritten auf das Ergebnis, damit weiter Bilder entstehen und es auch ohne
// Bilder (Teile) klappt. Beim Aufnäher sucht die App die Lösungen von selbst, und ihr Ergebnis
// ist bei jedem Lauf gleich.
import fs from 'node:fs';

const FILE = new URL('../../../public/examples/demos/patch.pes', import.meta.url);

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
// Gestalten and Prüfen are radio buttons inside their labels.
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();
const fabric = (s, name) => s.page.getByRole('group', { name: 'Für Stoff' }).getByRole('button', { name, exact: true });
const verdict = (s) => s.page.locator('strong.ampel-verdict').first();
const reason = (s, name) => s.page.locator('.ampel-reason').filter({ has: s.page.locator('.name', { hasText: name }) }).first();
const aside = (s) => s.page.locator('aside.inspector');

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what, sec = 120) => {
  for (let i = 0; i < sec * 10; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/**
 * Scrolls the right column by `dy` CSS px over `sec`, eased. The wheel would scroll whatever
 * list lies under the pointer (Befunde has its own), so the column itself is moved.
 */
const scrollAside = async (s, dy, sec = 0.8) => {
  const el = aside(s);
  const from = await el.evaluate((e) => e.scrollTop);
  const to = await el.evaluate((e, y) => Math.max(0, Math.min(e.scrollHeight - e.clientHeight, y)), from + dy);
  const n = Math.max(1, Math.round(sec * 30));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await el.evaluate((x, y) => (x.scrollTop = y), from + (to - from) * e);
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
      const file = new File([bytes], 'patch.pes', { type: 'application/octet-stream' });
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
      name.textContent = 'patch.pes';
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

// Off the motif, so the stage shows no readout next to the pointer.
const REST = [1500, 160];
// The handle of the compare line: the middle of the stage.
const SPLIT = [800, 563];
// The lettering on the whole stage (300 %).
const TEXT = [640, 690];

export default {
  title: 'Beheben und vergleichen',
  part: 8,
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
      say: '[warm] Dieser Aufnäher soll auf ein T-Shirt. Die Schrift liegt in Satin auf einer vollen Füllung, auf dünnem Strick wird das schnell zu dicht. Ich ziehe ihn ins Fenster.',
      text: 'Dieser Aufnäher soll auf ein T-Shirt. Die Schrift liegt in Satin auf einer vollen Füllung, auf dünnem Strick wird das schnell zu dicht. Ich ziehe ihn ins Fenster.',
      textEn: 'This patch is going on a T-shirt. The lettering is satin on top of a full fill, and on thin knit that quickly gets too dense. I drag it into the window.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(5.0);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'patch.pes').count()) > 0, 'patch.pes opens');
        await s.move(REST, 1.2);
        await s.wait(1.4);
      },
    },
    {
      say: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Rechts wähle ich den Stoff Strick. [concerned] Die Ampel sagt: Riskant auf Strick. Auf der Bühne leuchten die Buchstaben, dort liegt zu viel Garn.',
      text: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Rechts wähle ich den Stoff Strick. Die Ampel sagt: Riskant auf Strick. Auf der Bühne leuchten die Buchstaben, dort liegt zu viel Garn.',
      textEn: 'At the top you click Check, or you press the 2 key. On the right I choose the fabric Knit. The traffic light says: Risky on knit. On the stage the letters glow, that is where too much thread lies.',
      run: async (s) => {
        const check = mode(s, /^Prüfen/);
        await s.move(check, 0.9);
        await s.label('Prüfen', check, 'below');
        await s.wait(0.5);
        s.keyCap('2');
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        s.keyCap(null);
        await until(s, async () => (await fabric(s, 'Strick').count()) > 0 && / auf /.test(await verdict(s).innerText()), 'check');
        await s.zoom([1760, 200, 0, 0], 1.7);
        await s.click(fabric(s, 'Strick'), { move: 1.0, before: 0.4 });
        await until(s, async () => /Strick/.test(await verdict(s).innerText()), 'verdict for Strick');
        await s.move(verdict(s), 0.8);
        await s.label('Riskant auf Strick', verdict(s), 'below');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        await s.move([420, 640], 1.2);
        await s.move([850, 640], 1.6);
        await s.move([420, 830], 1.0);
        await s.move([850, 830], 1.6);
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'heatstitch sucht dabei schon nach Lösungen. Unter Dichte stehen jetzt zwei Wege. Beheben ändert nur, was man kaum sieht. Ein Vorschlag geht weiter, dafür sieht man ihn.',
      text: 'heatstitch sucht dabei schon nach Lösungen. Unter Dichte stehen jetzt zwei Wege. Beheben ändert nur, was man kaum sieht. Ein Vorschlag geht weiter, dafür sieht man ihn.',
      textEn: 'Meanwhile heatstitch is already looking for solutions. Under Density there are now two ways. Fix only changes what you can hardly see. A proposal goes further, but you can see it.',
      run: async (s) => {
        const fix = s.page.locator('.ampel-fix').first();
        const rest = s.page.locator('.ampel-rest').first();
        await s.zoom(reason(s, 'Dichte'), 1.8);
        await s.move(reason(s, 'Dichte').locator('.name'), 0.9);
        await until(s, async () => (await fix.count()) > 0 && (await rest.count()) > 0 && !/Wird berechnet/.test(await reason(s, 'Dichte').innerText()), 'fixes ready');
        await s.wait(1.6);
        await s.move(fix, 0.7);
        await s.label('Beheben', fix, 'left');
        await s.wait(3.0);
        await s.move(rest, 0.6);
        await s.label('Vorschlag', rest, 'left');
        await s.wait(3.0);
        s.unlabel();
      },
    },
    {
      say: 'Ein Klick auf Vorschlag zeigt vorher und nachher. Hier würde das H deutlich lockerer gestickt. Mit Übernehmen nimmst du den Vorschlag. Ich schließe ihn und nehme lieber Beheben.',
      text: 'Ein Klick auf Vorschlag zeigt vorher und nachher. Hier würde das H deutlich lockerer gestickt. Mit Übernehmen nimmst du den Vorschlag. Ich schließe ihn und nehme lieber Beheben.',
      textEn: 'A click on Proposal shows before and after. Here the H would be stitched much more loosely. With Apply you take the proposal. I close it and prefer Fix.',
      run: async (s) => {
        await s.click(s.page.locator('.ampel-rest').first(), { move: 0.5, before: 0.3, after: 0.6 });
        const look = s.page.locator('.ampel-look');
        const pic = look.locator('canvas.ampel-compare');
        await s.zoom(pic, 1.8);
        await s.wait(0.4);
        const b = await s.box(pic);
        await s.move([b.x + b.width * 0.25, b.y + b.height * 0.55], 0.8);
        await s.label('Vorher', [b.x, b.y, b.width / 2, b.height], 'above');
        await s.wait(1.6);
        await s.move([b.x + b.width * 0.75, b.y + b.height * 0.55], 0.8);
        await s.label('Nachher', [b.x + b.width / 2, b.y, b.width / 2, b.height], 'above');
        await s.wait(2.4);
        const take = look.getByRole('button', { name: 'Übernehmen' });
        await s.move(take, 0.8);
        await s.label('Übernehmen', take, 'below');
        await s.wait(2.0);
        s.unlabel();
        await s.click(look.getByRole('button', { name: 'Schließen' }), { move: 0.8, before: 0.6, after: 0.4 });
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: '[delighted] Ein Klick, und aus Riskant wird Mit Vorsicht. Oben bei Prüfen stehen statt sechzehn nur noch vier offene Stellen.',
      text: 'Ein Klick, und aus Riskant wird Mit Vorsicht. Oben bei Prüfen stehen statt sechzehn nur noch vier offene Stellen.',
      textEn: 'One click, and Risky becomes With care. Up at Check there are only four open spots instead of sixteen.',
      run: async (s) => {
        const fix = s.page.locator('.ampel-fix').first();
        await s.zoom([1760, 250, 0, 0], 1.6);
        await s.click(fix, { move: 0.8, before: 0.3, after: 0.3 });
        await until(s, async () => /Vorsicht/.test(await verdict(s).innerText()), 'verdict after fix');
        await s.move(verdict(s), 0.6);
        await s.label('Mit Vorsicht auf Strick', verdict(s), 'below');
        await s.wait(1.6);
        s.unlabel();
        s.zoomOut();
        const check = mode(s, /^Prüfen/);
        await until(s, async () => (await check.locator('.check-badge').innerText()).trim() !== '16', 'badge');
        const open = (await check.locator('.check-badge').innerText()).trim();
        await s.zoom([1000, 24, 0, 0], 1.8);
        await s.move(check, 1.0);
        await s.label(`${open} offen`, check, 'below');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 0.8);
      },
    },
    {
      say: 'Mit der Taste C vergleichst du mit dem Original. Ich ziehe die Trennlinie über die Schrift. [curious] Links glüht das Original, rechts ist die Korrektur viel ruhiger.',
      text: 'Mit der Taste C vergleichst du mit dem Original. Ich ziehe die Trennlinie über die Schrift. Links glüht das Original, rechts ist die Korrektur viel ruhiger.',
      textEn: 'With the C key you compare with the original. I drag the dividing line across the lettering. On the left the original glows, on the right the correction is much calmer.',
      run: async (s) => {
        // The key goes to the stage, not to a button that still has the focus.
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('c', { label: 'C', show: 1.0 });
        await until(s, async () => (await btn(s, /^Vergleich beenden/).count()) > 0, 'compare on');
        await s.move([700, 75], 0.9);
        await s.label('Original', [726, 60, 64, 22], 'below');
        await s.wait(1.2);
        await s.move([850, 75], 0.6);
        await s.label('Korrigiert', [810, 60, 72, 22], 'below');
        await s.wait(1.2);
        s.unlabel();
        await s.zoom([TEXT[0], TEXT[1], 0, 0], 1.5);
        await s.drag([SPLIT, [390, 640], [900, 640], [640, 640]], { sec: 1.8 });
        await s.wait(0.4);
      },
    },
    {
      say: 'Was hat heatstitch gemacht? Die Füllung weicht unter den Buchstaben ein Stück zurück. Schmale Buchstaben verzichten auf ihre Unterlage. Und die Satinstiche rücken unmerklich auseinander.',
      text: 'Was hat heatstitch gemacht? Die Füllung weicht unter den Buchstaben ein Stück zurück. Schmale Buchstaben verzichten auf ihre Unterlage. Und die Satinstiche rücken unmerklich auseinander.',
      textEn: 'What did heatstitch do? The fill draws back a little from under the letters. Narrow letters do without their underlay. And the satin stitches move imperceptibly further apart.',
      run: async (s) => {
        await s.move([700, 560], 1.0);
        await s.wait(2.4);
        await s.move([745, 840], 1.0);
        await s.wait(2.6);
        await s.move([440, 600], 1.0);
        await s.wait(2.6);
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Rechts unter Vergleich stehen die Zahlen. [proud, warm] Die kritische Fläche schrumpft von 36 auf 6 Quadratmillimeter, und das mit 130 Stichen weniger.',
      text: 'Rechts unter Vergleich stehen die Zahlen. Die kritische Fläche schrumpft von 36 auf 6 Quadratmillimeter, und das mit 130 Stichen weniger.',
      textEn: 'On the right under Compare you find the figures. The critical area shrinks from 36 to 6 square millimetres, and with 130 fewer stitches.',
      run: async (s) => {
        await s.move([1760, 600], 0.8);
        const title = s.page.getByText('Vergleich', { exact: true }).first();
        const top = await aside(s).evaluate((el) => el.getBoundingClientRect().top);
        await scrollAside(s, (await title.boundingBox()).y - top - 380, 1.0);
        const table = s.page.locator('table', { hasText: 'Kritische Fläche' }).first();
        await s.zoom(table, 1.8);
        const crit = table.locator('tr', { hasText: 'Kritische Fläche' });
        await s.move(crit, 0.8);
        await s.label('Kritische Fläche', crit, 'below');
        await s.wait(3.2);
        const stitches = table.locator('tr', { hasText: 'Stiche' }).first();
        await s.move(stitches, 0.7);
        await s.label('Stiche', stitches, 'above');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Gefällt dir das Ergebnis nicht, klickst du auf Korrektur zurücknehmen. Dann ist alles wieder wie vorher. [warm] So probierst du ohne Risiko. Viel Spaß beim Sticken!',
      text: 'Gefällt dir das Ergebnis nicht, klickst du auf Korrektur zurücknehmen. Dann ist alles wieder wie vorher. So probierst du ohne Risiko. Viel Spaß beim Sticken!',
      textEn: 'If you do not like the result, you click Undo correction. Then everything is back to how it was. That way you can try things without risk. Have fun embroidering!',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('c', { label: 'C', show: 0.8 });
        await scrollAside(s, -4000, 0.8);
        const back = s.page.locator('.ampel-revert');
        await s.zoom([1760, 260, 0, 0], 1.6);
        await s.move(back, 1.0);
        await s.label('Korrektur zurücknehmen', back, 'below');
        await s.wait(1.2);
        await s.click(null, { before: 0.3, after: 0.5 });
        s.unlabel();
        await until(s, async () => /Riskant/.test(await verdict(s).innerText()), 'correction undone');
        await s.move(verdict(s), 0.8);
        await s.wait(1.6);
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(3.0);
      },
    },
  ],
};

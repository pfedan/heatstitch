// Teil 7: Stickdatei prüfen. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Die Prüfung rechnet in Workern in Echtzeit. Wo sie neu rechnet (Prüfen, anderer Stoff),
// wartet die Szene in kurzen s.wait-Schritten auf das Ergebnis, damit weiter Bilder entstehen
// und es auch ohne Bilder (Teile) klappt.
import fs from 'node:fs';

const FILE = new URL('../../../public/examples/demos/patch.pes', import.meta.url);

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
// Gestalten and Prüfen are radio buttons inside their labels.
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();
const fabric = (s, name) => s.page.getByRole('group', { name: 'Für Stoff' }).getByRole('button', { name, exact: true });
const filter = (s, name) => s.page.getByRole('radio', { name }).first();
const verdict = (s) => s.page.locator('strong', { hasText: / auf / }).first();

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

/** Zooms the stage with the mouse wheel, one notch per `step` s, at the pointer. */
const wheelZoom = async (s, notches, step = 0.25) => {
  for (let i = 0; i < Math.abs(notches); i++) {
    await s.page.mouse.wheel(0, notches > 0 ? 100 : -100);
    await s.wait(step);
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

export default {
  title: 'Stickdatei prüfen',
  part: 7,
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
      say: '[warm] Bevor du eine fertige Stickdatei stickst, schau nach, ob sie auf deinem Stoff gut wird. Ich ziehe diesen Aufnäher ins Fenster: ein Stern und die Schrift Heat Stitch.',
      text: 'Bevor du eine fertige Stickdatei stickst, schau nach, ob sie auf deinem Stoff gut wird. Ich ziehe diesen Aufnäher ins Fenster: ein Stern und die Schrift Heat Stitch.',
      textEn: 'Before you stitch a finished embroidery file, check whether it will turn out well on your fabric. I drag this patch into the window: a star and the lettering Heat Stitch.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.4);
        await dragFileIn(s, [1915, 560], [960, 560]);
        await until(s, async () => (await btn(s, 'patch.pes').count()) > 0, 'patch.pes opens');
        await s.move(REST, 1.2);
        await s.wait(3.4);
      },
    },
    {
      say: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Die Bühne zeigt jetzt als Heatmap, wie viel Garn wo liegt. Dunkel heißt wenig, hell heißt viel.',
      text: 'Oben klickst du auf Prüfen, oder du drückst die Taste 2. Die Bühne zeigt jetzt als Heatmap, wie viel Garn wo liegt. Dunkel heißt wenig, hell heißt viel.',
      textEn: 'At the top you click Check, or you press the 2 key. The stage now shows as a heatmap how much thread lies where. Dark means little, bright means a lot.',
      run: async (s) => {
        const check = mode(s, /^Prüfen/);
        await s.move(check, 0.9);
        await s.label('Prüfen', check, 'below');
        await s.wait(0.6);
        s.keyCap('2');
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        s.keyCap(null);
        await until(s, async () => (await btn(s, /^Dichte /).count()) > 0, 'density check');
        await s.move([1500, 960], 1.0);
        await s.wait(3.4);
        await s.zoom([1190, 1048, 0, 0], 1.8);
        await s.label('Garnlänge', [1070, 1024, 250, 44], 'above');
        await s.move([1080, 1050], 0.9);
        await s.wait(0.6);
        await s.move([1300, 1050], 2.4);
        await s.wait(0.8);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Rechts oben antwortet die Ampel auf die Frage „Klappt das?“. Für Webware sagt sie gelb: Mit Vorsicht.',
      text: 'Rechts oben antwortet die Ampel auf die Frage „Klappt das?“. Für Webware sagt sie gelb: Mit Vorsicht.',
      textEn: 'At the top right, the traffic light answers the question “Will it work?”. For woven fabric it says yellow: With caution.',
      run: async (s) => {
        await s.zoom([1760, 150, 0, 0], 1.8);
        await s.move([1637, 100], 1.0);
        await s.label('Klappt das?', [1626, 72, 40, 56], 'left');
        await s.wait(2.4);
        await s.move(verdict(s), 0.8);
        await s.label('Mit Vorsicht', verdict(s), 'below');
        await s.wait(3.6);
        s.unlabel();
      },
    },
    {
      say: 'Darunter steht jeder Stoff mit seinem Urteil. Gelb heißt Vorsicht, rot heißt riskant. Ein Klick prüft für diesen Stoff. [concerned] Auf Strick wird es riskant, hier gibt es kritische Stellen. Mein Aufnäher kommt auf Webware, also zurück.',
      text: 'Darunter steht jeder Stoff mit seinem Urteil. Gelb heißt Vorsicht, rot heißt riskant. Ein Klick prüft für diesen Stoff. Auf Strick wird es riskant, hier gibt es kritische Stellen. Mein Aufnäher kommt auf Webware, also zurück.',
      textEn: 'Below, every fabric shows its verdict. Yellow means caution, red means risky. A click checks for that fabric. On knit it gets risky, there are critical spots here. My patch goes on woven fabric, so back again.',
      run: async (s) => {
        await s.zoom([1760, 200, 0, 0], 1.7);
        await s.move([1700, 140], 0.9);
        await s.wait(1.6);
        await s.move(fabric(s, 'Jeans'), 0.9);
        await s.label('Vorsicht', fabric(s, 'Jeans'), 'below');
        await s.wait(1.8);
        await s.move(fabric(s, 'Fleece'), 0.8);
        await s.label('riskant', fabric(s, 'Fleece'), 'below');
        await s.wait(1.6);
        s.unlabel();
        await s.click(fabric(s, 'Strick'), { move: 0.8, before: 0.9 });
        await until(s, async () => /Strick/.test(await verdict(s).innerText()), 'verdict for Strick');
        await s.move([1700, 104], 0.8);
        await s.label('Riskant auf Strick', verdict(s), 'below');
        s.zoomOut();
        await s.wait(6.4);
        s.unlabel();
        await s.click(fabric(s, 'Webware'), { move: 0.9, before: 1.2 });
        await until(s, async () => /Webware/.test(await verdict(s).innerText()), 'verdict for Webware');
        await s.move(REST, 1.0);
        await s.wait(0.6);
      },
    },
    {
      say: 'Unten im Abschnitt Heatmap blendest du den Stichplan ein. [curious] Jetzt siehst du, warum: Die Satinbuchstaben liegen auf der vollen Füllung, dort stapelt sich das Garn.',
      text: 'Unten im Abschnitt Heatmap blendest du den Stichplan ein. Jetzt siehst du, warum: Die Satinbuchstaben liegen auf der vollen Füllung, dort stapelt sich das Garn.',
      textEn: 'Further down, in the Heatmap section, you turn on the stitch plan. Now you see why: the satin letters lie on the full fill, and that is where the thread piles up.',
      run: async (s) => {
        await s.move([1760, 700], 0.8);
        const heading = s.page.getByRole('heading', { name: 'Heatmap' });
        // The Heatmap section near the top of the column, with room below for its settings.
        const top = await s.page.getByRole('complementary').evaluate((el) => el.getBoundingClientRect().top);
        await scrollAside(s, (await heading.boundingBox()).y - top - 300, 0.9);
        await s.click(heading, { move: 0.8, before: 0.3 });
        await s.wait(0.5);
        const plan = s.page.getByText('Stichplan einblenden', { exact: true }).first();
        await s.move(plan, 0.8);
        await s.label('Stichplan einblenden', plan, 'above');
        await s.wait(0.4);
        await s.click(null, { before: 0.3, after: 0.5 });
        s.unlabel();
        await s.move([1250, 560], 1.2);
        await s.zoom([640, 690, 0, 0], 1.6);
        await s.wait(4.0);
        s.zoomOut();
        await s.move([1760, 400], 1.0);
        await scrollAside(s, -3000, 0.9);
        await s.wait(0.3);
      },
    },
    {
      say: 'Die Zeile Dichte nennt die betroffene Fläche und die Zahl der Stellen. Ein Klick springt zur schlimmsten. Mit dem Mausrad zoome ich etwas heraus: Es ist der Querbalken im A.',
      text: 'Die Zeile Dichte nennt die betroffene Fläche und die Zahl der Stellen. Ein Klick springt zur schlimmsten. Mit dem Mausrad zoome ich etwas heraus: Es ist der Querbalken im A.',
      textEn: 'The Density row names the affected area and the number of spots. A click jumps to the worst one. With the mouse wheel I zoom out a little: it is the crossbar of the A.',
      run: async (s) => {
        const row = btn(s, /^Dichte /);
        await s.zoom([1760, 280, 0, 0], 1.8);
        await s.move(row, 0.9);
        await s.label('Dichte', row, 'below');
        await s.wait(3.4);
        s.unlabel();
        s.zoomOut();
        await s.click(null, { before: 0.4, after: 0.8 });
        await s.wait(2.2);
        await s.move([800, 470], 1.0);
        await wheelZoom(s, 6, 0.3);
        await s.wait(0.6);
        await s.label('Querbalken im A', [700, 500, 200, 60], 'above');
        await s.wait(2.2);
        s.unlabel();
      },
    },
    {
      say: 'Zeigst du auf eine Stelle, nennt der Hinweis ihren Prüfwert und die Grenzen für deinen Stoff. Unter Befunde steht jede Zone als Karte. Mit N gehst du sie der Reihe nach durch.',
      text: 'Zeigst du auf eine Stelle, nennt der Hinweis ihren Prüfwert und die Grenzen für deinen Stoff. Unter Befunde steht jede Zone als Karte. Mit N gehst du sie der Reihe nach durch.',
      textEn: 'Point at a spot, and the hint names its check value and the limits for your fabric. Under Findings, every zone is listed as a card. With N you go through them one by one.',
      run: async (s) => {
        await s.move([790, 560], 0.6);
        await s.wait(4.6);
        await s.move([1760, 600], 1.0);
        await s.zoom([1760, 560, 0, 0], 1.5);
        await s.label('Befunde', [1626, 384, 120, 20], 'above');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 0.9);
        // N zooms right onto the zone; a few notches out show where it sits.
        for (let i = 0; i < 2; i++) {
          await s.press('n', { label: 'N', show: 0.8 });
          await s.move([800, 560], 0.4);
          await wheelZoom(s, 5, 0.12);
          await s.move(REST, 0.4);
        }
      },
    },
    {
      say: 'Unter Unkritisch stehen die praxisüblichen Stellen, etwa ein Satin-Übergang. Sie zählen nicht zum Urteil.',
      text: 'Unter Unkritisch stehen die praxisüblichen Stellen, etwa ein Satin-Übergang. Sie zählen nicht zum Urteil.',
      textEn: 'Under Uncritical you find the common-practice spots, for example a satin transition. They do not count toward the verdict.',
      run: async (s) => {
        await s.zoom([1760, 560, 0, 0], 1.5);
        const easy = filter(s, /^Unkritisch/);
        await s.click(easy, { move: 1.0, before: 0.4 });
        await s.move([1760, 520], 0.8);
        await s.label('praxisüblich', [1640, 470, 240, 50], 'below');
        await s.wait(3.4);
        s.unlabel();
        await s.click(filter(s, /^Alle/), { move: 0.9, before: 0.4 });
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: 'Soll eine Stelle so bleiben, klickst du auf Quittieren. [satisfied] Dann zählt sie nicht mehr mit, und oben bei Prüfen steht eine offene Stelle weniger.',
      text: 'Soll eine Stelle so bleiben, klickst du auf Quittieren. Dann zählt sie nicht mehr mit, und oben bei Prüfen steht eine offene Stelle weniger.',
      textEn: 'If a spot should stay as it is, you click Acknowledge. Then it no longer counts, and up at Check there is one open spot less.',
      run: async (s) => {
        const ack = btn(s, 'Quittieren', true);
        await s.zoom([1760, 500, 0, 0], 1.6);
        await s.move(ack, 1.0);
        await s.label('Quittieren', ack, 'above');
        await s.wait(1.4);
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        s.zoomOut();
        await s.wait(0.8);
        const check = mode(s, /^Prüfen/);
        await s.zoom([1000, 24, 0, 0], 1.8);
        await s.move(check, 1.0);
        await s.label('9 offen', check, 'below');
        await s.wait(2.6);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Ein Doppelklick auf die Bühne zeigt wieder das ganze Stickmuster. [warm] So weißt du schon vor dem ersten Stich, worauf du achten musst. Viel Spaß beim Sticken!',
      text: 'Ein Doppelklick auf die Bühne zeigt wieder das ganze Stickmuster. So weißt du schon vor dem ersten Stich, worauf du achten musst. Viel Spaß beim Sticken!',
      textEn: 'A double click on the stage shows the whole design again. Now you know before the first stitch what to watch out for. Have fun embroidering!',
      run: async (s) => {
        await s.move([1300, 300], 1.0);
        await s.wait(0.3);
        await s.page.mouse.dblclick(1300, 300);
        await s.wait(0.4);
        await s.move(REST, 1.0);
        await s.wait(6.0);
      },
    },
  ],
};

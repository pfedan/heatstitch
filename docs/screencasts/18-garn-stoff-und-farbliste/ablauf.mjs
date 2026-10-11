// Teil 18: Garn, Stoff und Farbliste. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Die Katze (Weitere Beispiele) wird auf Madeira Polyneon und auf Strick eingestellt. „Auf Stoff
// abstimmen“ rechnet einige Sekunden; diese Zeit läuft ohne Bilder (das Video springt), danach
// werden alle Vorschläge übernommen und der Vergleich zeigt die kleinere kritische Fläche.

const btn = (s, name) => s.page.getByRole('button', { name }).first();
const card = (s) => s.page.locator('#inspector');
const tab = (s, name) => s.page.getByRole('tab', { name, exact: true });
const mode = (s, name) => s.page.locator('label', { has: s.page.getByRole('radio', { name }) }).first();

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

/** Rolls the card, eased over `sec`, so that `target` starts at `y` on the screen. */
const scrollCard = async (s, target, y, sec = 0.9) => {
  const el = await target.evaluateHandle((t) => {
    let n = t.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return n;
  });
  const from = await el.evaluate((e) => e.scrollTop);
  const box = await target.boundingBox();
  const to = Math.max(0, from + box.y - y);
  const n = Math.max(1, Math.round(sec * 30));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    await el.evaluate((node, v) => (node.scrollTop = v), from + (to - from) * e);
    await s.wait(1 / 30);
  }
};

/**
 * Waits for `ready` without frames: the page clock runs on in bigger steps, so a computation of
 * several seconds is a cut in the video. Outside the recorder (no installed clock) it just waits.
 */
const skipUntil = async (s, ready, what) => {
  for (let i = 0; i < 600; i++) {
    if (await ready()) return;
    try {
      await s.page.clock.runFor(200);
    } catch {
      /* no fake clock */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};

/** A key the viewer need not see. */
const quietKey = async (s, key) => {
  await s.page.keyboard.press(key);
  await s.wait(0.2);
};

// The red pullover of the cat, and where the pointer rests while the voice speaks.
const PULLOVER = [1000, 840];
const REST = [1480, 900];

export default {
  title: 'Garn, Stoff und Farbliste',
  part: 18,
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
      say: '[warm] Damit die Stickerei so wird wie auf dem Bildschirm, stellst du das Stickmuster auf deine Garne und deinen Stoff ein. Ich öffne unter Weitere Beispiele die Katze.',
      text: 'Damit die Stickerei so wird wie auf dem Bildschirm, stellst du das Stickmuster auf deine Garne und deinen Stoff ein. Ich öffne unter Weitere Beispiele die Katze.',
      textEn: 'So that the embroidery turns out the way it looks on screen, you set the design to your threads and your fabric. Under More examples I open the cat.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(8.4);
        const cat = btn(s, /^Katze/);
        await s.move(cat, 1.0);
        await s.label('Katze', cat, 'below');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        await until(s, async () => (await btn(s, /^cat-60mm/).count()) > 0, 'cat opens');
        await s.move(REST, 1.2);
        await s.wait(1.0);
      },
    },
    {
      say: 'Rechts in der Karte Stickmuster stehen unter Garne alle Farben. Unter Garnmarke wähle ich meine Marke, Madeira Polyneon. [curious] Darunter steht: Sieben Farben sind nicht von Madeira Polyneon.',
      text: 'Rechts in der Karte Stickmuster stehen unter Garne alle Farben. Unter Garnmarke wähle ich meine Marke, Madeira Polyneon. Darunter steht: Sieben Farben sind nicht von Madeira Polyneon.',
      textEn: 'On the right, in the Design card, Threads lists all colors. Under Thread brand I choose my brand, Madeira Polyneon. Below it says: seven colors are not from Madeira Polyneon.',
      run: async (s) => {
        await s.click(tab(s, 'Stickmuster'), { move: 1.0, before: 0.3, after: 0.4 });
        const head = card(s).getByText('Garne', { exact: true }).first();
        await s.move([1760, 500], 0.6);
        await scrollCard(s, head, 130, 1.2);
        await s.zoom([1760, 380, 0, 0], 1.6);
        await s.move(head, 0.8);
        await s.label('Garne', head, 'below');
        await s.wait(1.8);
        s.unlabel();
        const brand = card(s).getByText('Garnmarke', { exact: true }).first().locator('xpath=following::select[1]');
        await s.move(brand, 1.0);
        await s.label('Garnmarke', brand, 'above');
        await s.click(null, { before: 0.4, after: 0.2 });
        await brand.selectOption({ label: 'Madeira Polyneon' });
        await quietKey(s, 'Escape');
        s.unlabel();
        const note = card(s).getByText(/Farben sind nicht von Madeira Polyneon/).first();
        await s.move(note, 0.9);
        await s.wait(2.6);
      },
    },
    {
      say: 'Ein Klick auf „Auf Madeira Polyneon umstellen“, [pleased] und jede Farbe bekommt das nächste Garn dieser Marke, mit Nummer und Namen. Links in der Liste stehen die neuen Garne auch.',
      text: 'Ein Klick auf „Auf Madeira Polyneon umstellen“, und jede Farbe bekommt das nächste Garn dieser Marke, mit Nummer und Namen. Links in der Liste stehen die neuen Garne auch.',
      textEn: 'One click on “Switch to Madeira Polyneon”, and every color gets the closest thread of that brand, with number and name. On the left, the list shows the new threads too.',
      run: async (s) => {
        const sw = btn(s, /^Auf Madeira Polyneon umstellen/);
        await s.move(sw, 0.8);
        await s.label('Auf Madeira Polyneon umstellen', sw, 'above');
        await s.click(null, { before: 0.5, after: 0.5 });
        s.unlabel();
        const head = card(s).getByText('Garne', { exact: true }).first();
        await s.move(head, 1.0);
        await s.wait(2.6);
        s.zoomOut();
        await s.zoom([200, 330, 0, 0], 1.6);
        await s.move([200, 170], 1.0);
        await s.move([200, 560], 2.2);
        await s.wait(1.0);
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Auch ein einzelnes Objekt bekommt sein eigenes Garn. Ich klicke auf den Pullover und rechts auf sein Garn. Ich suche Red und nehme 1747, Very Red.',
      text: 'Auch ein einzelnes Objekt bekommt sein eigenes Garn. Ich klicke auf den Pullover und rechts auf sein Garn. Ich suche Red und nehme 1747, Very Red.',
      textEn: 'A single object can get its own thread, too. I click the pullover and, on the right, its thread. I search for Red and take 1747, Very Red.',
      run: async (s) => {
        await s.click(PULLOVER, { move: 1.2, before: 0.4, after: 0.6 });
        // The card stays on Stickmuster from before; the object's thread is on Objekt.
        if ((await tab(s, 'Objekt').getAttribute('aria-selected')) !== 'true') await s.click(tab(s, 'Objekt'), { move: 0.9, before: 0.2, after: 0.4 });
        const chip = s.page.getByRole('button', { name: /^Garn dieses Objekts wählen/ }).first();
        await until(s, async () => (await chip.count()) > 0, 'object card');
        // The card keeps its scroll from the Stickmuster tab; the thread sits under the name at the top.
        await scrollCard(s, chip, 140, 0.8);
        await s.zoom([1760, 200, 0, 0], 1.6);
        await s.click(chip, { move: 1.0, before: 0.3, after: 0.5 });
        const search = s.page.getByPlaceholder('Nummer oder Name');
        await s.click(search, { move: 0.6, before: 0.1, after: 0.1 });
        await s.type('Red', { perChar: 0.14 });
        const swatch = s.page.getByRole('button', { name: '1747 Very Red' }).first();
        await s.wait(0.6);
        await s.move(swatch, 0.9);
        await s.label('1747 Very Red', swatch, 'below');
        await s.click(null, { before: 0.5, after: 0.5 });
        s.unlabel();
        await quietKey(s, 'Escape');
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.2);
      },
    },
    {
      say: 'Unter Material wählst du den Stoff. Ich sticke auf ein T-Shirt, also Strick. [focused] Bereit zum Sticken rät jetzt zu einer Nadel mit Kugelspitze und zu Schneidevlies.',
      text: 'Unter Material wählst du den Stoff. Ich sticke auf ein T-Shirt, also Strick. Bereit zum Sticken rät jetzt zu einer Nadel mit Kugelspitze und zu Schneidevlies.',
      textEn: 'Under Material you choose the fabric. I am stitching on a T-shirt, so knit. Ready to stitch now recommends a ballpoint needle and cut-away stabilizer.',
      run: async (s) => {
        await quietKey(s, 'Escape');
        await s.click(tab(s, 'Stickmuster'), { move: 1.0, before: 0.3, after: 0.4 });
        const head = card(s).getByText('Material', { exact: true }).first();
        await s.move([1760, 500], 0.6);
        await scrollCard(s, head, 130, 1.0);
        await s.zoom([1760, 330, 0, 0], 1.6);
        const fabric = card(s).getByText('Stoff', { exact: true }).first().locator('xpath=following::select[1]');
        await s.move(fabric, 1.0);
        await s.label('Stoff', fabric, 'above');
        await s.click(null, { before: 0.4, after: 0.2 });
        await fabric.selectOption({ label: 'Strick, Jersey' });
        await quietKey(s, 'Escape');
        s.unlabel();
        await s.wait(1.4);
        const needle = card(s).getByText(/Kugelspitze/).first();
        await s.move(needle, 1.2);
        await s.label('Nadel', needle, 'left');
        await s.wait(1.4);
        s.unlabel();
        const vlies = card(s).getByText(/^Mittleres Schneidevlies/).first();
        await s.move(vlies, 0.8);
        await s.label('Vlies', vlies, 'left');
        await s.wait(1.6);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Und was sagt die Ampel? Oben klicke ich auf Prüfen. [concerned] Riskant auf Strick: Für den dehnbaren Stoff liegt an manchen Stellen zu viel Garn.',
      text: 'Und was sagt die Ampel? Oben klicke ich auf Prüfen. Riskant auf Strick: Für den dehnbaren Stoff liegt an manchen Stellen zu viel Garn.',
      textEn: 'And what does the traffic light say? At the top I click Check. Risky on knit: for the stretchy fabric there is too much thread in some places.',
      run: async (s) => {
        const check = mode(s, /^Prüfen/);
        await s.move(check, 1.2);
        await s.label('Prüfen', check, 'below');
        await s.click(null, { before: 0.4, after: 0.5 });
        s.unlabel();
        const verdict = s.page.getByText(/auf Strick$/).first();
        await until(s, async () => (await verdict.count()) > 0, 'verdict');
        await s.zoom([1760, 200, 0, 0], 1.6);
        await s.move(verdict, 1.0);
        await s.label('Riskant auf Strick', verdict, 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
        await s.move([980, 520], 1.2);
        await s.wait(1.6);
      },
    },
    {
      say: 'Unter Korrektur stimmt „Auf Stoff abstimmen“ die Einstellungen auf Strick ab. Nach ein paar Sekunden steht da, was besser passt. Ich klicke auf Alle auswählen und Ausgewählte übernehmen. [satisfied] Die kritische Fläche sinkt von 28 auf 19 Quadratmillimeter.',
      text: 'Unter Korrektur stimmt „Auf Stoff abstimmen“ die Einstellungen auf Strick ab. Nach ein paar Sekunden steht da, was besser passt. Ich klicke auf Alle auswählen und Ausgewählte übernehmen. Die kritische Fläche sinkt von 28 auf 19 Quadratmillimeter.',
      textEn: 'Under Correction, “Tune to fabric” tunes the settings to knit. After a few seconds it lists what suits better. I click Select all and Apply selected. The critical area drops from 28 to 19 square millimetres.',
      run: async (s) => {
        // The button in the Korrektur section; Material has one of the same name that comes first.
        const tune = s.page.locator('section', { hasText: 'Korrektur vorschlagen' }).getByRole('button', { name: 'Auf Stoff abstimmen' }).first();
        await s.move([1760, 500], 0.6);
        await scrollCard(s, tune, 260, 1.2);
        await s.zoom([1760, 300, 0, 0], 1.6);
        await s.move(tune, 1.0);
        await s.label('Auf Stoff abstimmen', tune, 'below');
        await s.click(null, { before: 0.5, after: 0.6 });
        s.unlabel();
        const head = s.page.getByText(/^Für Strick, Jersey pass/).first();
        await skipUntil(s, async () => (await head.count()) > 0, 'tune list');
        await scrollCard(s, head, 240, 0.8);
        await s.move(head, 1.0);
        await s.label('Vorschläge', head, 'below');
        await s.wait(2.0);
        s.unlabel();
        const all = btn(s, 'Alle auswählen');
        await scrollCard(s, all, 300, 0.8);
        await s.click(all, { move: 0.9, before: 0.4, after: 0.5 });
        const apply = btn(s, /^Ausgewählte übernehmen/);
        await scrollCard(s, apply, 520, 1.0);
        await s.move(apply, 0.8);
        await s.label('Ausgewählte übernehmen', apply, 'above');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        const crit = s.page.getByText('Kritische Fläche', { exact: true }).first();
        await skipUntil(s, async () => (await crit.count()) > 0 && (await crit.isVisible()), 'comparison');
        await scrollCard(s, crit, 420, 1.0);
        const row = crit.locator('xpath=ancestor::tr[1]');
        await s.move(row, 0.9);
        await s.label('28 → 19 mm²', row, 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Zum Schluss die Farbliste, in Gestalten unter Garne. Sie nennt jedes Garn in der Reihenfolge, in der die Maschine stickt, mit Stichen und Metern. [warm] Mit Drucken liegt sie neben der Maschine. Viel Spaß beim Sticken!',
      text: 'Zum Schluss die Farbliste, in Gestalten unter Garne. Sie nennt jedes Garn in der Reihenfolge, in der die Maschine stickt, mit Stichen und Metern. Mit Drucken liegt sie neben der Maschine. Viel Spaß beim Sticken!',
      textEn: 'Finally the color list, in Design under Threads. It names every thread in the order the machine stitches, with stitches and metres. With Print it lies next to the machine. Have fun embroidering!',
      run: async (s) => {
        await s.page.evaluate(() => document.activeElement?.blur());
        const design = mode(s, /^Gestalten/);
        await s.click(design, { move: 1.0, before: 0.3, after: 0.5 });
        await s.click(tab(s, 'Stickmuster'), { move: 1.0, before: 0.3, after: 0.4 });
        const list = btn(s, /^Farbliste/);
        await s.move([1760, 500], 0.6);
        await scrollCard(s, list, 520, 1.0);
        await s.move(list, 0.8);
        await s.label('Farbliste', list, 'above');
        await s.click(null, { before: 0.4, after: 0.5 });
        s.unlabel();
        const dlg = s.page.getByRole('dialog').last();
        await until(s, async () => (await dlg.getByText('Farbliste', { exact: true }).count()) > 0, 'color list');
        await s.move([960, 520], 1.0);
        await s.move([960, 760], 2.0);
        await s.wait(0.6);
        const print = dlg.getByRole('button', { name: 'Drucken' });
        await s.move(print, 1.0);
        await s.label('Drucken', print, 'above');
        await s.wait(3.0);
        s.unlabel();
        await s.wait(1.0);
      },
    },
  ],
};

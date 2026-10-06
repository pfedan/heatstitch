// Teil 2: Schrift. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit englischer
// Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die Szenenlänge.
// `text` und `textEn` sind die Untertitel, ohne Regie.

const away = [1480, 200]; // a quiet spot on the canvas, outside the hoop

// Shorter moves and pauses where many steps share one sentence.
let pace = 1;

/** Drags a range slider of the lettering card to a value, then nudges it there exactly. */
const slide = async (s, label, value, sec = 1.2) => {
  const input = s.page.locator('#lettering-body label', { hasText: label }).locator('input[type=range]');
  const b = await s.box(input);
  const min = Number(await input.getAttribute('min'));
  const max = Number(await input.getAttribute('max'));
  const step = Number(await input.getAttribute('step'));
  const at = (v) => [b.x + 8 + ((v - min) / (max - min)) * (b.width - 16), b.y + b.height / 2];
  await s.drag([at(Number(await input.inputValue())), at(value)], { sec });
  for (let i = 0; i < 20; i++) {
    const v = Number(await input.inputValue());
    if (Math.abs(v - value) < step / 2) break;
    await input.press(v < value ? 'ArrowRight' : 'ArrowLeft');
  }
};

/** Opens the font list and picks a font, scrolling the list gently until it shows. */
const pickFont = async (s, id, { pauseAt, step = 40 } = {}) => {
  await s.click('.font-current', { move: 0.9 * pace });
  await s.wait(1.2 * pace);
  const list = s.page.locator('.font-list');
  const row = s.page.locator(`.font-row[data-font=${id}]`);
  await s.move(list, 0.7 * pace);
  for (let i = 0; i < 60; i++) {
    const lb = await s.box(list);
    const rb = await s.box(row);
    if (pauseAt) {
      const pb = await s.box(s.page.locator(`.font-row[data-font=${pauseAt}]`));
      if (pb.y + pb.height < lb.y + lb.height - 10) {
        await s.label('ohne Ä', s.page.locator(`.font-row[data-font=${pauseAt}] .font-tags`), 'left');
        await s.wait(2.6 * pace);
        s.unlabel();
        pauseAt = null;
      }
    }
    if (!pauseAt && rb.y + rb.height < lb.y + lb.height - 10) break;
    await s.page.mouse.wheel(0, step);
    await s.wait(0.07 * pace);
  }
  await s.wait(0.6 * pace);
  await s.click(row, { move: 0.7 * pace, before: 0.4 * pace });
};

const setHeight = async (s, mm) => {
  const h = s.page.locator('.lettering-height');
  await s.click(h, { move: 0.8 * pace });
  await s.page.keyboard.press('Control+a');
  await s.wait(0.3 * pace);
  await s.type(mm, { perChar: 0.25 * pace });
  await s.press('Enter', { show: 0.9 * pace });
};

const pickThread = async (s, name) => {
  await s.click('.lettering-color', { move: 0.8 * pace });
  await s.wait(1.0 * pace);
  await s.click(`.color-pop .pick[title*="${name}"]`, { move: 0.8 * pace, before: 0.4 * pace });
  await s.wait(0.6 * pace);
};

export default {
  title: 'Schrift',
  part: 2,
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
      say: '[warm, inviting] In diesem Video stickst du ein Etikett für Selbstgenähtes: „Mit Liebe genäht“ im Bogen, darunter ein Name.',
      text: 'In diesem Video stickst du ein Etikett für Selbstgenähtes: „Mit Liebe genäht“ im Bogen, darunter ein Name.',
      textEn: 'In this video you embroider a label for things you have sewn: “Made with love” in an arc, with a name underneath.',
      run: async (s) => {
        await s.move([960, 600], 0.1);
        await s.wait(4.5);
        await s.move('#new-design', 2.0);
      },
    },
    {
      say: 'Klick links auf „Neu“ und dann über der Leinwand auf „Text“. Der Text ist schon markiert, du tippst einfach los.',
      text: 'Klick links auf „Neu“ und dann über der Leinwand auf „Text“. Der Text ist schon markiert, du tippst einfach los.',
      textEn: 'Click “New” on the left and then “Text” above the canvas. The text is already selected, so just start typing.',
      run: async (s) => {
        await s.wait(0.4);
        await s.click(null);
        await s.wait(1.2);
        await s.label('Text', '#lettering-new', 'below');
        await s.click('#lettering-new', { move: 1.0 });
        await s.wait(1.0);
        s.unlabel();
        await s.move([1300, 760], 0.9);
        await s.type('MIT LIEBE GENÄHT', { perChar: 0.13 });
        await s.wait(0.8);
      },
    },
    {
      say: '[curious] Rot heißt hier: zu breit für den Stickrahmen. Das lösen wir gleich mit Schrift und Höhe.',
      text: 'Rot heißt hier: zu breit für den Stickrahmen. Das lösen wir gleich mit Schrift und Höhe.',
      textEn: 'Red means: too wide for the hoop. We will fix that in a moment with the font and the height.',
      run: async (s) => {
        const size = s.page.locator('.lettering-size');
        await s.zoom(size, 1.6);
        await s.move(size, 1.0);
        await s.wait(4.5);
        s.zoomOut();
      },
    },
    {
      say: 'Ein Klick auf die Schrift öffnet die Liste, und jede Schrift zeigt gleich deinen Text. [focused] Grau heißt: Hier fehlt ein Buchstabe, zum Beispiel das Ä. Rechts steht, für welche Höhe die Schrift gemacht ist. Ich nehme Excalibur.',
      text: 'Ein Klick auf die Schrift öffnet die Liste, und jede Schrift zeigt gleich deinen Text. Grau heißt: Hier fehlt ein Buchstabe, zum Beispiel das Ä. Rechts steht, für welche Höhe die Schrift gemacht ist. Ich nehme Excalibur.',
      textEn: 'A click on the font opens the list, and every font shows your text right away. Grey means a letter is missing, the Ä for example. On the right it says which height the font is made for. I will take Excalibur.',
      run: async (s) => {
        await s.label('Schrift', '.font-current', 'left');
        await pickFont(s, 'excalibur_KOR', { pauseAt: 'manga_impact' });
        s.unlabel();
        await s.wait(0.6);
      },
    },
    {
      say: 'Die Höhe gilt für die Großbuchstaben. Neun Millimeter, [delighted] und schon passt alles in den Rahmen. Der grüne Streifen unter dem Regler zeigt, wo die Schrift gut aussieht.',
      text: 'Die Höhe gilt für die Großbuchstaben. Neun Millimeter, und schon passt alles in den Rahmen. Der grüne Streifen unter dem Regler zeigt, wo die Schrift gut aussieht.',
      textEn: 'The height is that of the capital letters. Nine millimetres, and it all fits the hoop. The green strip under the slider shows where the font looks good.',
      run: async (s) => {
        await s.zoom('.lettering-height', 1.5);
        await s.label('Höhe', '.lettering-height', 'left');
        await setHeight(s, '9');
        s.unlabel();
        await s.wait(1.6);
        await s.move('.band-track', 1.0);
        await s.label('gute Höhe', '.band-track', 'below');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: '[enthusiastic] Jetzt kommt der Bogen: Form „Bogen oben“. Mit dem Radius bestimmst du, wie stark er sich krümmt.',
      text: 'Jetzt kommt der Bogen: Form „Bogen oben“. Mit dem Radius bestimmst du, wie stark er sich krümmt.',
      textEn: 'Now for the arc: shape “Arc on top”. The radius sets how strongly it bends.',
      run: async (s) => {
        const arc = 'button[title="Bogen oben"]';
        await s.label('Bogen', arc, 'below');
        await s.click(arc, { move: 1.0 });
        await s.wait(1.2);
        s.unlabel();
        await slide(s, 'Radius', 45, 1.6);
        await s.wait(1.0);
      },
    },
    {
      say: 'Unter „Mehr“ bekommen die Buchstaben mit etwas mehr Abstand Luft. Dazu ein dunkles Blau.',
      text: 'Unter „Mehr“ bekommen die Buchstaben mit etwas mehr Abstand Luft. Dazu ein dunkles Blau.',
      textEn: 'Under “More”, a little more letter spacing gives the letters some air. And a dark blue with it.',
      run: async (s) => {
        await s.click('#lettering-body summary', { move: 0.9 });
        await s.wait(0.6);
        const spacing = s.page.locator('#lettering-body label', { hasText: 'Buchstabenabstand' });
        await s.label('Buchstabenabstand', spacing, 'left');
        await slide(s, 'Buchstabenabstand', 0.5, 1.0);
        s.unlabel();
        await pickThread(s, 'Prussian Blue');
      },
    },
    {
      say: 'Ein zweiter Klick auf „Text“ setzt den nächsten Schriftzug genau darunter. Für den Namen nehme ich eine Schreibschrift, Pacificlo, zwanzig Millimeter hoch, in Rosa.',
      text: 'Ein zweiter Klick auf „Text“ setzt den nächsten Schriftzug genau darunter. Für den Namen nehme ich eine Schreibschrift, Pacificlo, zwanzig Millimeter hoch, in Rosa.',
      textEn: 'A second click on “Text” puts the next lettering right underneath. For the name I take a script font, Pacificlo, twenty millimetres high, in pink.',
      run: async (s) => {
        pace = 0.6;
        await s.click(away, { move: 0.6, after: 0.2 });
        await s.click('#lettering-new', { move: 0.7, after: 0.2 });
        await s.wait(0.3);
        await s.move([1300, 820], 0.5);
        await s.type('Frieda', { perChar: 0.1 });
        await s.wait(0.2);
        await pickFont(s, 'pacificlo', { step: 240 });
        await s.label('Pacificlo', '.font-current', 'left');
        await setHeight(s, '20');
        s.unlabel();
        await pickThread(s, 'Deep Rose');
        await s.click(away, { move: 0.6 });
        pace = 1;
      },
    },
    {
      say: '[delighted] Das Schöne: Ein Schriftzug bleibt Text. Doppelklick darauf, und aus Frieda wird Emma. Schrift, Garn und Platz bleiben.',
      text: 'Das Schöne: Ein Schriftzug bleibt Text. Doppelklick darauf, und aus Frieda wird Emma. Schrift, Garn und Platz bleiben.',
      textEn: 'The nice part: a lettering stays text. Double-click it, and Frieda becomes Emma. Font, thread and place stay.',
      run: async (s) => {
        await s.wait(0.3);
        // The middle of the name, on the stem of the first e, hits a stitch.
        const target = [1000, 870];
        await s.move(target, 1.0);
        await s.label('Doppelklick', [target[0], target[1] + 60, 0, 0], 'below');
        await s.wait(0.4);
        await s.page.mouse.dblclick(target[0], target[1]);
        await s.wait(0.8);
        s.unlabel();
        const focused = await s.page.evaluate(() => document.activeElement?.tagName);
        if (focused !== 'TEXTAREA') throw new Error('double-click did not reach the lettering text');
        await s.page.keyboard.press('Control+a');
        await s.move([1300, 860], 0.8);
        await s.type('Emma', { perChar: 0.2 });
        await s.wait(1.4);
      },
    },
    {
      say: 'Mit der Leertaste siehst du, wie die Maschine stickt: erst den blauen Bogen, dann den Namen.',
      text: 'Mit der Leertaste siehst du, wie die Maschine stickt: erst den blauen Bogen, dann den Namen.',
      textEn: 'The space bar shows you how the machine stitches: first the blue arc, then the name.',
      run: async (s) => {
        await s.click(away, { move: 0.8 });
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.page.keyboard.press('Escape');
        await s.page.keyboard.press('Escape');
        // Fit, so the whole label is in view (the name reaches below the canvas otherwise).
        await s.click('text=Einpassen', { move: 0.8 });
        await s.move([1480, 860], 0.6);
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.5);
      },
    },
    {
      say: '[proud, warm] Speichern geht links wie bei jedem Stickmuster. Fertig ist dein Etikett.',
      text: 'Speichern geht links wie bei jedem Stickmuster. Fertig ist dein Etikett.',
      textEn: 'You save on the left, like any design. Your label is done.',
      run: async (s) => {
        await s.click(s.page.locator('label.check', { hasText: 'Realistische Fäden' }), { move: 1.2 });
        await s.move([1290, 860], 1.0);
        await s.zoom([960, 560, 0, 0], 1.35);
        await s.wait(4.5);
        s.zoomOut();
      },
    },
  ],
};

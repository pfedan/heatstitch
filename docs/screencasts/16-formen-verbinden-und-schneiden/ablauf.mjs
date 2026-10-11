// Teil 16: Formen verbinden und schneiden. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Ein leeres Stickmuster (Stickrahmen 100 × 100 mm, Bühne 235 %): drei Kreise werden eine Wolke,
// ein Stern ein Loch darin, eine Kontur legt sich drumherum, und zwei Linien darunter werden
// verbunden. Die Punkte gelten für 1920 × 1080.

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
const actions = (s) => s.page.getByRole('toolbar', { name: 'Werkzeug-Optionen' });
const act = (s, name) => actions(s).getByRole('button', { name, exact: true });
const tool = (s, name) => s.page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name, exact: true });

/** A key the viewer needs not see (leaving the shape after drawing). */
const quietKey = async (s, key) => {
  await s.page.keyboard.press(key);
  await s.wait(0.3);
};

// Three overlapping circles, corner to corner with the option Kreis: the cloud.
const CIRCLES = [
  [[780, 520], [1020, 760]],
  [[930, 440], [1170, 680]],
  [[1080, 520], [1320, 760]],
];
// A five-pointed star in the middle of the cloud, clicked corner by corner.
const STAR = (() => {
  const c = [1050, 610];
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 40 : 95;
    pts.push([Math.round(c[0] + r * Math.cos(a)), Math.round(c[1] + r * Math.sin(a))]);
  }
  return pts;
})();
const CLOUD = [860, 650];
// The diamond grip of the contour sits on its right edge; dragged outwards, the gap grows.
const GRIP = [1337, 639];
// Two gently bent lines under the cloud with a gap between them.
const LINE_A = [[700, 900], [830, 880], [960, 900]];
const LINE_B = [[1140, 900], [1270, 880], [1400, 900]];
const REST = [1500, 300];

export default {
  title: 'Formen verbinden und schneiden',
  part: 16,
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
      say: '[warm] Aus einfachen Formen werden neue. Du fasst Formen zusammen, schneidest eine aus der anderen, legst eine Kontur herum und verbindest Pfade. Ich fange leer an.',
      text: 'Aus einfachen Formen werden neue. Du fasst Formen zusammen, schneidest eine aus der anderen, legst eine Kontur herum und verbindest Pfade. Ich fange leer an.',
      textEn: 'Simple shapes become new ones. You combine shapes, cut one out of another, lay a contour around them and join paths. I start empty.',
      run: async (s) => {
        const empty = btn(s, /^Leer anfangen/);
        await s.move([960, 300], 0.1);
        await s.wait(7.6);
        await s.move(empty, 1.2);
        await s.label('Leer anfangen', empty, 'left');
        await s.wait(1.2);
        await s.click(null, { before: 0.2, after: 0.3 });
        s.unlabel();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Links in der Werkzeugleiste nehme ich die Ellipse, oben wähle ich „Kreis“. Dann ziehe ich drei Kreise, die sich überlappen: eine Wolke.',
      text: 'Links in der Werkzeugleiste nehme ich die Ellipse, oben wähle ich „Kreis“. Dann ziehe ich drei Kreise, die sich überlappen: eine Wolke.',
      textEn: 'In the toolbar on the left I take the ellipse, and at the top I choose “Circle”. Then I drag three overlapping circles: a cloud.',
      run: async (s) => {
        const ellipse = tool(s, 'Ellipse');
        await s.zoom([24, 200, 0, 0], 1.6);
        await s.move(ellipse, 1.0);
        await s.label('Ellipse', ellipse, 'right');
        await s.click(null, { before: 0.6, after: 0.3 });
        s.unlabel();
        s.zoomOut();
        const round = btn(s, 'Kreis');
        await s.move(round, 1.0);
        await s.label('Kreis', round, 'below');
        await s.click(null, { before: 0.4, after: 0.4 });
        s.unlabel();
        for (const [i, c] of CIRCLES.entries()) {
          if (i > 0) {
            await quietKey(s, 'Escape');
            await s.click(ellipse, { move: 0.7, before: 0.1, after: 0.2 });
          }
          await s.drag(c, { sec: 1.2 });
          await s.wait(0.4);
        }
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.move(REST, 0.9);
      },
    },
    {
      say: 'Mit Strg+A wähle ich alle drei. In der Aktionsleiste unter dem Breadcrumb steht jetzt Zusammenfassen. [pleased] Aus drei Kreisen wird eine Fläche mit einem Umriss.',
      text: 'Mit Strg+A wähle ich alle drei. In der Aktionsleiste unter dem Breadcrumb steht jetzt Zusammenfassen. Aus drei Kreisen wird eine Fläche mit einem Umriss.',
      textEn: 'With Ctrl+A I select all three. The action bar below the breadcrumb now offers Combine. Three circles become one area with one outline.',
      run: async (s) => {
        await s.press('Control+a', { label: 'Strg+A', show: 1.2 });
        const combine = act(s, 'Zu einem Objekt zusammenfassen');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(combine, 1.0);
        await s.label('Zusammenfassen', combine, 'below');
        await s.click(null, { before: 2.6, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.zoom([1050, 600, 0, 0], 1.3);
        await s.wait(3.0);
        s.zoomOut();
      },
    },
    {
      say: 'Für ein Loch zeichne ich mit dem Pfad einen Stern: Jeder Klick setzt eine Ecke, ein Klick auf den Anfang schließt ihn. Mit Strg+A wähle ich beide und klicke auf Ausschneiden. Die obere Form wird aus der unteren geschnitten.',
      text: 'Für ein Loch zeichne ich mit dem Pfad einen Stern: Jeder Klick setzt eine Ecke, ein Klick auf den Anfang schließt ihn. Mit Strg+A wähle ich beide und klicke auf Ausschneiden. Die obere Form wird aus der unteren geschnitten.',
      textEn: 'For a hole I draw a star with the path: each click sets a corner, a click on the start closes it. With Ctrl+A I select both and click Cut out. The upper shape is cut out of the lower one.',
      run: async (s) => {
        await quietKey(s, 'Escape');
        const path = tool(s, 'Pfad');
        await s.move(path, 1.0);
        await s.label('Pfad', path, 'right');
        await s.click(null, { before: 0.4, after: 0.3 });
        s.unlabel();
        await s.zoom([1050, 610, 0, 0], 1.6);
        for (const p of STAR) await s.click(p, { move: 0.3, before: 0.05, after: 0.1 });
        await s.click(STAR[0], { move: 0.4, before: 0.1, after: 0.6 });
        s.zoomOut();
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.move(REST, 0.8);
        await s.press('Control+a', { label: 'Strg+A', show: 1.0 });
        const cut = act(s, 'Obere Form ausschneiden');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(cut, 0.9);
        await s.label('Ausschneiden', cut, 'below');
        await s.click(null, { before: 0.8, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await quietKey(s, 'Escape');
        await s.move(REST, 0.9);
        await s.zoom([1050, 610, 0, 0], 1.5);
        await s.wait(2.4);
        s.zoomOut();
      },
    },
    {
      say: 'Jetzt ein Rand: Ich wähle die Wolke und klicke auf Kontur. Ein Steppstich läuft im Abstand drumherum, auch innen im Stern. Den Abstand ziehst du an der Raute, oder du tippst ihn rechts ein.',
      text: 'Jetzt ein Rand: Ich wähle die Wolke und klicke auf Kontur. Ein Steppstich läuft im Abstand drumherum, auch innen im Stern. Den Abstand ziehst du an der Raute, oder du tippst ihn rechts ein.',
      textEn: 'Now an edge: I select the cloud and click Contour. A running stitch goes around it at a distance, inside the star too. You drag the distance at the diamond, or type it on the right.',
      run: async (s) => {
        await s.click(CLOUD, { move: 1.0, before: 0.3, after: 0.5 });
        const contour = act(s, 'Kontur drumherum');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(contour, 0.9);
        await s.label('Kontur', contour, 'below');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move([1420, 560], 1.0);
        await s.wait(3.2);
        await s.zoom([1250, 640, 0, 0], 1.6);
        await s.move(GRIP, 0.9);
        await s.label('Raute', [GRIP[0] - 8, GRIP[1] - 8, 16, 16], 'right');
        await s.wait(0.8);
        s.unlabel();
        await s.drag([GRIP, [GRIP[0] + 9, GRIP[1]]], { sec: 1.0 });
        await s.move([GRIP[0] + 80, GRIP[1] + 60], 0.6);
        s.zoomOut();
        const gap = s.page.getByRole('region', { name: 'Objekt' }).getByLabel('Abstand', { exact: true }).first();
        await s.zoom([1760, 260, 0, 0], 1.6);
        await s.move(gap, 1.0);
        await s.label('Abstand', gap, 'below');
        await s.wait(1.8);
        s.unlabel();
        s.zoomOut();
        await quietKey(s, 'Escape');
        await s.move(REST, 0.8);
      },
    },
    {
      say: 'Unter die Wolke kommen zwei Linien, wieder mit dem Pfad; Enter beendet jede. Mit Umschalt und Ziehen wähle ich beide und fasse sie zusammen: Zwei Linien sind jetzt ein Objekt.',
      text: 'Unter die Wolke kommen zwei Linien, wieder mit dem Pfad; Enter beendet jede. Mit Umschalt und Ziehen wähle ich beide und fasse sie zusammen: Zwei Linien sind jetzt ein Objekt.',
      textEn: 'Two lines go under the cloud, again with the path; Enter finishes each one. With Shift and drag I select both and combine them: two lines are now one object.',
      run: async (s) => {
        const path = tool(s, 'Pfad');
        for (const line of [LINE_A, LINE_B]) {
          await s.click(path, { move: 0.8, before: 0.1, after: 0.2 });
          for (const p of line) await s.click(p, { move: 0.4, before: 0.05, after: 0.1 });
          await s.press('Enter', { show: 0.6 });
          await quietKey(s, 'Escape');
          await quietKey(s, 'Escape');
        }
        s.keyCap('Umschalt');
        await s.drag([[670, 835], [1430, 940]], { sec: 1.2, hold: ['Shift'] });
        s.keyCap(null);
        await s.wait(0.4);
        const combine = act(s, 'Zu einem Objekt zusammenfassen');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(combine, 0.9);
        await s.label('Zusammenfassen', combine, 'below');
        await s.click(null, { before: 0.5, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move([1450, 800], 0.8);
        await s.wait(1.6);
      },
    },
    {
      say: 'Mit Enter öffne ich seine Form. Ich klicke ein Ende an, und Verbinden, oder Strg+J, schließt die Lücke mit einem geraden Stück. Umgekehrt teilt Pfad hier teilen einen Pfad am gewählten Knoten.',
      text: 'Mit Enter öffne ich seine Form. Ich klicke ein Ende an, und Verbinden, oder Strg+J, schließt die Lücke mit einem geraden Stück. Umgekehrt teilt Pfad hier teilen einen Pfad am gewählten Knoten.',
      textEn: 'With Enter I open its shape. I click one end, and Join, or Ctrl+J, closes the gap with a straight piece. The other way round, Split path here splits a path at the selected node.',
      run: async (s) => {
        await s.press('Enter', { show: 1.0 });
        await s.zoom([1050, 880, 0, 0], 1.6);
        await s.click(LINE_A[2], { move: 1.0, before: 0.3, after: 0.6 });
        await s.label('Ende', [LINE_A[2][0] - 8, LINE_A[2][1] - 8, 16, 16], 'below');
        await s.wait(1.0);
        s.unlabel();
        s.zoomOut();
        const join = act(s, 'Verbinden');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(join, 0.9);
        await s.label('Verbinden', join, 'below');
        await s.wait(0.6);
        s.unlabel();
        s.zoomOut();
        await s.move([1050, 960], 0.8);
        await s.press('Control+j', { label: 'Strg+J', show: 1.4 });
        await s.zoom([1050, 880, 0, 0], 1.6);
        await s.wait(1.4);
        await s.click(LINE_B[1], { move: 0.9, before: 0.3, after: 0.4 });
        s.zoomOut();
        const split = act(s, 'Pfad hier teilen');
        await s.zoom([680, 110, 0, 0], 1.8);
        await s.move(split, 0.9);
        await s.label('Pfad hier teilen', split, 'below');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        await s.move([1450, 800], 0.8);
      },
    },
    {
      say: 'Fertig beendet die Form. Zum Schluss schalte ich unten rechts im Ansicht-Menü Realistische Fäden ein. [warm] Viel Spaß beim Gestalten!',
      text: 'Fertig beendet die Form. Zum Schluss schalte ich unten rechts im Ansicht-Menü Realistische Fäden ein. Viel Spaß beim Gestalten!',
      textEn: 'Done finishes the shape. Finally, at the bottom right in the view menu, I turn on Realistic threads. Have fun designing!',
      run: async (s) => {
        const done = act(s, 'Fertig');
        await s.click(done, { move: 1.0, before: 0.4, after: 0.4 });
        await quietKey(s, 'Escape');
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1430, 800, 0, 0], 1.4);
        await s.move(eye, 1.0);
        await s.click(null, { before: 0.4, after: 0.4 });
        const real = s.page.getByRole('checkbox', { name: 'Realistische Fäden' });
        await s.move(real, 0.8);
        await s.label('Realistische Fäden', real, 'above');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        await quietKey(s, 'Escape');
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.zoom([1050, 680, 0, 0], 1.25);
        await s.wait(3.6);
        s.zoomOut();
      },
    },
  ],
};

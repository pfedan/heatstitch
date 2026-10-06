// Teil 1: Ein neues Stickmuster. Szenen wie in vorlage.md; der Sprechtext jeder Szene liegt
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.

const circle = [[750, 300], [1150, 700]];
const wave = [[690, 560], [820, 500], [950, 580], [1080, 500], [1210, 560]];

export default {
  title: 'Ein neues Stickmuster',
  part: 1,
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
      say: '[warm, inviting] In diesem Video stickst du dein erstes eigenes Muster: einen runden Aufnäher mit einer Welle. Dafür brauchst du nur die Maus und zwei Minuten.',
      text: 'In diesem Video stickst du dein erstes eigenes Muster: einen runden Aufnäher mit einer Welle. Dafür brauchst du nur die Maus und zwei Minuten.',
      textEn: "In this video you embroider your very first design of your own: a round patch with a wave. All you need is the mouse and two minutes.",
      run: async (s) => {
        await s.move([960, 600], 0.1);
        await s.wait(6);
        await s.move('#new-design', 2.2);
      },
    },
    {
      say: 'Klick links auf „Neu“. Es entsteht ein leeres Stickmuster. Der gestrichelte Rahmen ist dein Stickrahmen, hier hundert mal hundert Millimeter.',
      text: 'Klick links auf „Neu“. Es entsteht ein leeres Stickmuster. Der gestrichelte Rahmen ist dein Stickrahmen, hier hundert mal hundert Millimeter.',
      textEn: "Click “New” on the left. An empty design appears. The dashed frame is your hoop, here one hundred by one hundred millimetres.",
      run: async (s) => {
        await s.wait(0.6);
        await s.click(null);
        await s.wait(2.2);
        await s.move([960, 600], 1.0);
        await s.label('Stickrahmen', [950, 150, 0, 0], 'below');
        await s.wait(3.2);
        s.unlabel();
        await s.move('#hoop', 1.0);
        await s.label('Stickrahmen', '#hoop', 'right');
        await s.wait(2.5);
        s.unlabel();
      },
    },
    {
      say: 'Links auf der Leinwand liegen die Zeichenwerkzeuge. [focused] Nimm die Ellipse und zieh mit gedrückter Umschalttaste einen Kreis auf. [short pause] [delighted] Sobald du loslässt, ist er schon gestickt: als Füllung, passend zu deinem Stoff.',
      text: 'Links auf der Leinwand liegen die Zeichenwerkzeuge. Nimm die Ellipse und zieh mit gedrückter Umschalttaste einen Kreis auf. Sobald du loslässt, ist er schon gestickt: als Füllung, passend zu deinem Stoff.',
      textEn: "The drawing tools are on the left of the canvas. Take the ellipse and drag out a circle while holding Shift. As soon as you let go, it is already stitched: as a fill, suited to your fabric.",
      run: async (s) => {
        await s.move('[data-draw=rect]', 1.2);
        await s.move('[data-draw=free]', 1.0);
        await s.click('[data-draw=ellipse]', { move: 0.7 });
        await s.wait(0.8);
        s.keyCap('Umschalt');
        await s.drag(circle, { sec: 2.4, hold: ['Shift'] });
        s.keyCap(null);
        await s.move([1280, 760], 0.8);
        await s.wait(0.6);
        await s.label('Füllung', [750, 300, 400, 400], 'right');
        await s.wait(4);
        s.unlabel();
      },
    },
    {
      say: 'Rechts siehst du, wie groß er ist. [casual] Tipp einfach sechzig Millimeter ein, die Höhe geht mit.',
      text: 'Rechts siehst du, wie groß er ist. Tipp einfach sechzig Millimeter ein, die Höhe geht mit.',
      textEn: "On the right you see how big it is. Just type sixty millimetres, the height follows.",
      run: async (s) => {
        const width = s.page.getByLabel('Breite in mm');
        await s.zoom(width, 1.6);
        await s.label('Größe', width, 'below');
        await s.move(width, 1.0);
        await s.click(null, { before: 0.4, after: 0.2 });
        await s.page.keyboard.press('Control+a');
        await s.wait(0.6);
        await s.type('60', { perChar: 0.25 });
        await s.press('Enter', { show: 1.0 });
        s.unlabel();
        await s.wait(0.6);
        s.zoomOut();
      },
    },
    {
      say: 'Ein Klick auf das Farbfeld öffnet die Garne. Ich nehme ein helles Blau.',
      text: 'Ein Klick auf das Farbfeld öffnet die Garne. Ich nehme ein helles Blau.',
      textEn: "A click on the colour swatch opens the threads. I'll take a light blue.",
      run: async (s) => {
        await s.click('.mini-sw.thread-sw', { move: 0.9 });
        await s.wait(1.6);
        await s.move('button.pick[title="Blue"]', 0.6);
        await s.click('button.pick[title="Cornflower Blue"]', { move: 0.5, before: 0.4 });
        await s.move([1280, 800], 0.9);
      },
    },
    {
      say: '[focused] Jetzt die Welle. Mit dem Zeichenstift setzt ein Klick eine Ecke, Ziehen macht eine Rundung. Enter beendet die Linie. Eine Linie wird zuerst im Steppstich gestickt.',
      text: 'Jetzt die Welle. Mit dem Zeichenstift setzt ein Klick eine Ecke, Ziehen macht eine Rundung. Enter beendet die Linie. Eine Linie wird zuerst im Steppstich gestickt.',
      textEn: "Now the wave. With the pen, a click sets a corner and dragging makes a curve. Enter finishes the line. A line is stitched as a running stitch at first.",
      run: async (s) => {
        await s.click('[data-draw=pen]', { move: 0.9 });
        await s.wait(0.6);
        await s.click(wave[0], { move: 1.0, after: 0.5 });
        for (const [x, y] of wave.slice(1)) {
          await s.move([x, y], 0.6);
          await s.wait(0.15);
          await s.page.mouse.down();
          await s.move([x + 50, y], 0.45);
          await s.page.mouse.up();
          await s.wait(0.25);
        }
        await s.move([1180, 700], 0.6);
        await s.press('Enter', { show: 1.2 });
        await s.label('Steppstich', [690, 500, 520, 80], 'below');
        await s.wait(2.6);
        s.unlabel();
      },
    },
    {
      say: '[enthusiastic] Für eine kräftige Welle stellst du die Art auf Satin, ziehst die Breite auf drei Millimeter und gibst ihr weißes Garn.',
      text: 'Für eine kräftige Welle stellst du die Art auf Satin, ziehst die Breite auf drei Millimeter und gibst ihr weißes Garn.',
      textEn: "For a bold wave, set the type to satin, drag the width to three millimetres and give it white thread.",
      run: async (s) => {
        const satin = s.page.getByText('Satin', { exact: true }).last();
        await s.zoom(satin, 1.45);
        await s.click(satin, { move: 0.9 });
        await s.label('Satin', satin, 'above');
        await s.wait(0.6);
        const slider = s.page.locator('label.stitch-field', { hasText: 'Breite' }).locator('input[type=range]');
        const b = await s.box(slider);
        const at = (v) => [b.x + 8 + ((v - 0.8) / (6 - 0.8)) * (b.width - 16), b.y + b.height / 2];
        await s.drag([at(2), at(3)], { sec: 1.0 });
        // The thumb lands within a step; the arrow keys make it exactly 3,0 mm.
        for (let i = 0; i < 6; i++) {
          const v = Number(await slider.inputValue());
          if (Math.abs(v - 3) < 0.05) break;
          await slider.press(v < 3 ? 'ArrowRight' : 'ArrowLeft');
        }
        s.unlabel();
        await s.click('.mini-sw.thread-sw', { move: 0.8 });
        await s.click('button.pick[title="White"]', { move: 0.8, before: 0.4 });
        await s.move([1280, 820], 0.8);
        s.zoomOut();
      },
    },
    {
      say: '[curious] Mit der Leertaste siehst du, wie die Maschine stickt: erst den blauen Kreis, dann die Welle.',
      text: 'Mit der Leertaste siehst du, wie die Maschine stickt: erst den blauen Kreis, dann die Welle.',
      textEn: "The space bar shows you how the machine stitches: first the blue circle, then the wave.",
      run: async (s) => {
        await s.click([1500, 860], { move: 0.8 });
        // The width slider of scene 7 still has the focus and would swallow the space bar; the
        // two Escapes let go of the wave, so the playback is not covered by its frame.
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.page.keyboard.press('Escape');
        await s.page.keyboard.press('Escape');
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.5);
      },
    },
    {
      say: 'Unter Anzeige zeigt „Realistische Fäden“ dein Muster so, wie es auf dem Stoff aussehen wird. [impressed] Schön, oder?',
      text: 'Unter Anzeige zeigt „Realistische Fäden“ dein Muster so, wie es auf dem Stoff aussehen wird. Schön, oder?',
      textEn: "Under Display, “Realistic threads” shows your design the way it will look on the fabric. Nice, isn't it?",
      run: async (s) => {
        await s.click(s.page.locator('label.check', { hasText: 'Realistische Fäden' }), { move: 1.2 });
        await s.move([1290, 860], 1.0);
        await s.zoom([950, 500, 0, 0], 1.35);
        await s.wait(5.5);
        s.zoomOut();
      },
    },
    {
      say: 'Zum Schluss wählst du links das Format deiner Maschine und speicherst. [short pause] [proud, warm] Fertig ist dein erstes Stickmuster.',
      text: 'Zum Schluss wählst du links das Format deiner Maschine und speicherst. Fertig ist dein erstes Stickmuster.',
      textEn: "Finally, choose your machine's format on the left and save. Your first design is done.",
      run: async (s) => {
        await s.zoom('#save-format', 1.5);
        await s.move('#save-format', 1.0);
        await s.wait(1.4);
        await s.label('Speichern', '#save-file', 'right');
        await s.click('#save-file', { move: 0.9, before: 0.5 });
        await s.wait(1.6);
        s.unlabel();
        s.zoomOut();
        await s.move([1280, 860], 1.2);
      },
    },
  ],
};

// Teil 11: Füllungen. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`, mit
// englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Fast alles geschieht am grünen Kreis oben links im Formen-Benchmark, herangezoomt und mit
// Realistischen Fäden. Die Karte Objekt ist länger als der Bildschirm; der Ablauf rollt sie
// weich zu dem Abschnitt, um den es geht.

const card = (s) => s.page.locator('#inspector');
const tile = (s, name) => card(s).getByRole('radio', { name, exact: true }).first();
const group = (s, name) => card(s).getByRole('tab', { name, exact: true });
/** The slider of a setting in the Objekt card, found by its label text. */
const slider = (s, name) => card(s).locator('label', { hasText: name }).getByRole('slider').first();
const setting = (s, name) => card(s).locator('label', { hasText: name }).first();
const eye = (s) => s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
const inView = (s, text) => s.page.locator('#view-pop').getByText(text, { exact: true }).first();

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/** Rolls the Objekt card, eased over `sec`, so that `target` starts at `y` on the screen. */
const scrollCard = async (s, target, y, sec = 0.9) => {
  const el = card(s);
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

/** Where a slider's thumb sits for `value`. */
const thumbAt = async (s, sl, value) => {
  const b = await sl.boundingBox();
  const [min, max] = await sl.evaluate((e) => [Number(e.min), Number(e.max)]);
  // The thumb (16 px) travels the track minus its own width.
  return [b.x + 8 + ((b.width - 16) * (value - min)) / (max - min), b.y + b.height / 2];
};

/** Wheel steps over `at`, a few frames apart, so the stage zooms in smoothly. */
const wheelZoom = async (s, at, steps, delta = -100) => {
  await s.move(at, 0.6);
  for (let i = 0; i < steps; i++) {
    await s.page.mouse.wheel(0, delta);
    await s.wait(0.12);
  }
};

// Over the stage, off the shapes; the pointer rests here while the voice speaks.
const REST = [1500, 1010];
// The green circle at the start, and its centre once the stage is moved.
const CIRCLE = [630, 210];
const CENTRE = [950, 530];

export default {
  title: 'Füllungen',
  part: 11,
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
      say: '[warm] Eine Füllung deckt eine Fläche mit Reihen von Stichen. Wie die Reihen laufen, wie dicht sie liegen und was sie hält, stellst du rechts in der Karte Objekt ein. Ich öffne unter Weitere Beispiele den Formen-Benchmark.',
      text: 'Eine Füllung deckt eine Fläche mit Reihen von Stichen. Wie die Reihen laufen, wie dicht sie liegen und was sie hält, stellst du rechts in der Karte Objekt ein. Ich öffne unter Weitere Beispiele den Formen-Benchmark.',
      textEn: 'A fill covers an area with rows of stitches. How the rows run, how close they lie and what holds them, you set on the right in the Object card. Under More examples I open the shape benchmark.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(10.4);
        const bench = s.page.getByRole('button', { name: /^Formen-Benchmark/ }).first();
        await s.move(bench, 1.2);
        await s.label('Formen-Benchmark', bench, 'below');
        await s.wait(1.2);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await until(s, async () => (await s.page.getByRole('button', { name: 'shapes-benchmark' }).count()) > 0, 'benchmark opens');
        await s.move(REST, 1.2);
        await s.wait(1.4);
      },
    },
    {
      say: 'Ich klicke auf den grünen Kreis und zoome mit dem Mausrad heran. Im Ansicht-Menü schalte ich Realistische Fäden ein. So siehst du jede Änderung, wie sie gestickt aussieht.',
      text: 'Ich klicke auf den grünen Kreis und zoome mit dem Mausrad heran. Im Ansicht-Menü schalte ich Realistische Fäden ein. So siehst du jede Änderung, wie sie gestickt aussieht.',
      textEn: 'I click the green circle and zoom in with the mouse wheel. In the View menu I turn on Realistic threads. That way you see every change as it will look stitched.',
      run: async (s) => {
        await s.click(CIRCLE, { move: 1.0, before: 0.3, after: 0.4 });
        // Off the shapes, a drag moves the stage; the circle comes to the middle.
        await s.drag([[770, 390], [1090, 710]], { sec: 1.0 });
        await wheelZoom(s, CENTRE, 6);
        await s.wait(0.4);
        await s.zoom([1420, 900, 0, 0], 1.6);
        await s.click(eye(s), { move: 1.0, before: 0.3, after: 0.4 });
        await s.zoom([1430, 520, 0, 0], 1.7);
        const real = inView(s, 'Realistische Fäden');
        await s.move(real, 0.8);
        await s.label('Realistische Fäden', real, 'above');
        await s.click(null, { before: 0.4, after: 0.5 });
        s.unlabel();
        await s.press('Escape', { show: 0 });
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(2.0);
      },
    },
    {
      say: 'Unter Stichart steht Füllung, darunter das Muster. Deckend heißt: Der Stoff ist ganz bedeckt. Tatami legt gerade Reihen. [curious] Zeigst du auf ein anderes Muster, zeigt die Bühne es schon vorab. Für runde Formen nehme ich die Spirale.',
      text: 'Unter Stichart steht Füllung, darunter das Muster. Deckend heißt: Der Stoff ist ganz bedeckt. Tatami legt gerade Reihen. Zeigst du auf ein anderes Muster, zeigt die Bühne es schon vorab. Für runde Formen nehme ich die Spirale.',
      textEn: 'Under Stitch type it says Fill, below that the pattern. Covering means the fabric is fully covered. Tatami lays straight rows. Point at another pattern and the stage shows it in advance. For round shapes I take the spiral.',
      run: async (s) => {
        await s.zoom([1760, 640, 0, 0], 1.6);
        const fill = card(s).getByRole('radio', { name: 'Füllung', exact: true }).first();
        await s.move(fill, 1.0);
        await s.label('Füllung', fill, 'below');
        await s.wait(2.0);
        await s.move(group(s, 'Deckend'), 0.8);
        await s.label('Deckend', group(s, 'Deckend'), 'above');
        await s.wait(2.6);
        await s.move(tile(s, 'Tatami'), 0.8);
        await s.label('Tatami', tile(s, 'Tatami'), 'left');
        await s.wait(2.0);
        s.unlabel();
        s.zoomOut();
        await s.move(tile(s, 'Wirbel'), 1.0);
        await s.wait(1.8);
        await s.move(tile(s, 'Maserung'), 0.8);
        await s.wait(1.8);
        await s.move(tile(s, 'Spirale'), 0.9);
        await s.wait(0.6);
        await s.label('Spirale', tile(s, 'Spirale'), 'left');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        await s.move(REST, 1.0);
        await s.wait(1.6);
      },
    },
    {
      say: 'Unter Offen zieht eine Linie ein Muster, und der Stoff scheint durch. Echo legt Linien im gleichen Abstand zum Rand, wie beim Quilten. [delighted] Leicht und schnell gestickt. Ich bleibe aber bei Deckend und nehme wieder Tatami.',
      text: 'Unter Offen zieht eine Linie ein Muster, und der Stoff scheint durch. Echo legt Linien im gleichen Abstand zum Rand, wie beim Quilten. Leicht und schnell gestickt. Ich bleibe aber bei Deckend und nehme wieder Tatami.',
      textEn: 'Under Open, a single line draws a pattern and the fabric shows through. Echo lays lines at the same distance from the edge, as in quilting. Light and quick to stitch. But I stay with Covering and take Tatami again.',
      run: async (s) => {
        await s.zoom([1760, 640, 0, 0], 1.6);
        await s.click(group(s, 'Offen'), { move: 1.0, before: 0.3, after: 0.4 });
        await s.label('Offen', group(s, 'Offen'), 'above');
        await s.wait(1.6);
        s.unlabel();
        await s.move(tile(s, 'Echo'), 0.9);
        await s.label('Echo', tile(s, 'Echo'), 'left');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(4.2);
        await s.zoom([1760, 640, 0, 0], 1.6);
        await s.click(group(s, 'Deckend'), { move: 1.0, before: 0.3, after: 0.4 });
        await s.click(tile(s, 'Tatami'), { move: 0.8, before: 0.3, after: 0.4 });
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Unter Gestaltung stellst du Abstand, Winkel und Stichlänge ein. Ich drehe die Reihen auf 90 Grad. Unter Prägung zeichnen die Einstiche ein Muster in die Fläche. [enthusiastic] Mit Herzen siehst du sie im Licht.',
      text: 'Unter Gestaltung stellst du Abstand, Winkel und Stichlänge ein. Ich drehe die Reihen auf 90 Grad. Unter Prägung zeichnen die Einstiche ein Muster in die Fläche. Mit Herzen siehst du sie im Licht.',
      textEn: 'Under Design you set spacing, angle and stitch length. I turn the rows to 90 degrees. Under Embossing the needle points draw a pattern into the area. With hearts you see them in the light.',
      run: async (s) => {
        const heading = card(s).getByText('Gestaltung', { exact: true }).first();
        await s.move([1760, 600], 0.8);
        await scrollCard(s, heading, 130);
        await s.zoom([1760, 330, 0, 0], 1.6);
        await s.label('Gestaltung', heading, 'below');
        await s.wait(2.6);
        s.unlabel();
        const angle = slider(s, 'Winkel');
        await s.label('Winkel', setting(s, 'Winkel').getByText('Winkel', { exact: true }), 'above');
        await s.drag([await thumbAt(s, angle, 45), await thumbAt(s, angle, 90)], { sec: 1.2 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.4);
        await s.zoom([1760, 500, 0, 0], 1.6);
        const herzen = tile(s, 'Herzen');
        await s.move(herzen, 1.0);
        await s.label('Prägung', card(s).getByText('Prägung', { exact: true }).first(), 'above');
        await s.wait(2.2);
        s.unlabel();
        await s.label('Herzen', herzen, 'below');
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(2.4);
      },
    },
    {
      say: 'Unter Umrandung bekommt die Füllung eine Linie um den Rand, nach ihr gestickt. Eine Satinkante deckt den Rand sauber ab.',
      text: 'Unter Umrandung bekommt die Füllung eine Linie um den Rand, nach ihr gestickt. Eine Satinkante deckt den Rand sauber ab.',
      textEn: 'Under Border the fill gets a line around its edge, stitched after it. A satin edge covers the edge neatly.',
      run: async (s) => {
        const heading = card(s).getByText('Umrandung', { exact: true }).first();
        await s.move([1760, 600], 0.6);
        await scrollCard(s, heading, 330);
        await s.zoom([1760, 420, 0, 0], 1.6);
        await s.label('Umrandung', heading, 'above');
        await s.wait(2.0);
        s.unlabel();
        const satin = card(s).getByRole('radio', { name: 'Satin', exact: true }).nth(1);
        await s.move(satin, 0.9);
        await s.label('Satin', satin, 'below');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(2.0);
      },
    },
    {
      say: 'Unter Stoff und Halt steht, was der Stickerei Halt gibt. Die Unterlage näht vorher lockere Stiche auf den Stoff; Kreuz legt zwei Lagen, für dehnbare Stoffe. [focused] Wo Auto steht, wählt heatstitch den Wert selbst, passend zu Stoff und Form. Ziehst du am Regler, gilt dein eigener Wert. Ein Klick auf den Punkt daneben holt Auto zurück.',
      text: 'Unter Stoff und Halt steht, was der Stickerei Halt gibt. Die Unterlage näht vorher lockere Stiche auf den Stoff; Kreuz legt zwei Lagen, für dehnbare Stoffe. Wo Auto steht, wählt heatstitch den Wert selbst, passend zu Stoff und Form. Ziehst du am Regler, gilt dein eigener Wert. Ein Klick auf den Punkt daneben holt Auto zurück.',
      textEn: 'Under Fabric and hold is what gives the embroidery its hold. The underlay first sews loose stitches onto the fabric; Cross lays two layers, for stretchy fabrics. Where it says Auto, heatstitch picks the value itself, to suit fabric and shape. Drag the slider and your own value applies. A click on the dot next to it brings Auto back.',
      run: async (s) => {
        const heading = card(s).getByText('Stoff und Halt', { exact: true }).first();
        await s.move([1760, 600], 0.6);
        await scrollCard(s, heading, 130);
        await s.zoom([1760, 380, 0, 0], 1.6);
        await s.label('Stoff und Halt', heading, 'below');
        await s.wait(2.4);
        s.unlabel();
        const cross = card(s).getByRole('radio', { name: 'Kreuz', exact: true }).first();
        await s.move(cross, 0.9);
        await s.label('Unterlage', card(s).getByText('Unterlage', { exact: true }).first(), 'above');
        await s.wait(2.4);
        s.unlabel();
        await s.label('Kreuz', cross, 'below');
        await s.click(null, { before: 0.3, after: 0.4 });
        await s.wait(1.6);
        s.unlabel();
        const edge = setting(s, 'Abstand zum Rand');
        // The card keeps its place; should it ever move, this brings the setting back.
        if (Math.abs((await edge.boundingBox()).y - 400) > 200) await scrollCard(s, edge, 400);
        const auto = edge.getByText('Auto', { exact: true });
        await s.move(auto, 0.9);
        await s.label('Auto', auto, 'above');
        await s.wait(3.6);
        s.unlabel();
        const sl = slider(s, 'Abstand zum Rand');
        const now = Number(await sl.evaluate((e) => e.value));
        await s.drag([await thumbAt(s, sl, now), await thumbAt(s, sl, now + 1.2)], { sec: 1.0 });
        await s.wait(1.6);
        const dot = edge.getByRole('button', { name: /^Eigener Wert/ });
        await s.move(dot, 0.8);
        await s.label('Eigener Wert', dot, 'left');
        await s.wait(1.4);
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        await s.label('Auto', auto, 'above');
        await s.wait(1.4);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Mit der Taste X zerteilst du eine Füllung. Ich ziehe eine Linie quer durch den Kreis. Jetzt sind es zwei Teile, jeder mit eigener Richtung. Ich drehe die rechte Hälfte, [delighted] und schon fängt jede Hälfte das Licht anders.',
      text: 'Mit der Taste X zerteilst du eine Füllung. Ich ziehe eine Linie quer durch den Kreis. Jetzt sind es zwei Teile, jeder mit eigener Richtung. Ich drehe die rechte Hälfte, und schon fängt jede Hälfte das Licht anders.',
      textEn: 'With the X key you split a fill. I drag a line right through the circle. Now there are two parts, each with its own direction. I turn the right half, and each half catches the light differently.',
      run: async (s) => {
        await s.move([950, 150], 1.0);
        await s.press('x', { label: 'X', show: 1.4 });
        await s.drag([[955, 170], [940, 420], [945, 660], [960, 895]], { sec: 0.6 });
        await s.wait(3.4);
        await s.press('Escape', { show: 0 });
        await s.click([1110, 520], { move: 1.0, before: 0.3, after: 0.4 });
        const heading = card(s).getByText('Gestaltung', { exact: true }).first();
        await s.move([1760, 600], 0.6);
        await scrollCard(s, heading, 130);
        await s.zoom([1760, 330, 0, 0], 1.6);
        const angle = slider(s, 'Winkel');
        await s.label('Winkel', setting(s, 'Winkel').getByText('Winkel', { exact: true }), 'above');
        const now = Number(await angle.evaluate((e) => e.value));
        await s.drag([await thumbAt(s, angle, now), await thumbAt(s, angle, 150)], { sec: 1.2 });
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(2.4);
      },
    },
    {
      say: 'Mit F siehst du wieder das ganze Stickmuster. Für das Blatt nehme ich Leitlinien: Taste G, dann ziehe ich eine geschwungene Linie über die Fläche. [enthusiastic] Die Reihen folgen ihr wie die Adern eines Blatts. Fertig schließt das Werkzeug.',
      text: 'Mit F siehst du wieder das ganze Stickmuster. Für das Blatt nehme ich Leitlinien: Taste G, dann ziehe ich eine geschwungene Linie über die Fläche. Die Reihen folgen ihr wie die Adern eines Blatts. Fertig schließt das Werkzeug.',
      textEn: 'With F you see the whole design again. For the leaf I use guide lines: the G key, then I drag a curved line across the area. The rows follow it like the veins of a leaf. Done closes the tool.',
      run: async (s) => {
        await s.press('Escape', { show: 0 });
        // The angle slider still holds the keys; F and G belong to the stage.
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('f', { label: 'F', show: 1.4 });
        await s.wait(0.6);
        await s.click([1330, 520], { move: 1.2, before: 0.3, after: 0.4 });
        await s.press('g', { label: 'G', show: 1.4 });
        await s.drag([[1200, 650], [1235, 560], [1300, 520], [1345, 455], [1420, 425]], { sec: 0.5 });
        await s.move([1500, 700], 0.8);
        await s.wait(3.6);
        const done = s.page.getByRole('button', { name: 'Fertig', exact: true }).first();
        await s.move(done, 1.2);
        await s.label('Fertig', done, 'right');
        await s.click(null, { before: 0.3, after: 0.4 });
        s.unlabel();
        await s.move(REST, 1.2);
      },
    },
    {
      say: '[warm] Muster, Gestaltung, Umrandung und Halt: So wird aus jeder Fläche die Füllung, die du dir vorstellst. Und jede Änderung nimmst du mit Strg+Z zurück.',
      text: 'Muster, Gestaltung, Umrandung und Halt: So wird aus jeder Fläche die Füllung, die du dir vorstellst. Und jede Änderung nimmst du mit Strg+Z zurück.',
      textEn: 'Pattern, design, border and hold: that is how every area becomes exactly the fill you have in mind. And you can undo every change with Ctrl+Z.',
      run: async (s) => {
        await s.press('Escape', { show: 0 });
        await s.move([900, 600], 2.4);
        await s.move([1200, 400], 2.4);
        await s.move(REST, 1.6);
        await s.wait(2.0);
      },
    },
  ],
};

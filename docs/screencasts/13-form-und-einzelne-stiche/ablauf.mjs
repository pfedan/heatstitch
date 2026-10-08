// Teil 13: Form und einzelne Stiche. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Alles geschieht an der linken Pfote der Katze („Füllung 15“). Die Punkte auf der Bühne gelten
// für 1920 × 1080 und die Katze, wie „Weitere Beispiele“ sie öffnet: Die Form zoomt die Bühne
// auf die Pfote, und Knoten und Einstiche liegen danach immer an derselben Stelle.

const btn = (s, name, exact = false) => s.page.getByRole('button', { name, exact }).first();
const crumb = (s) => s.page.getByRole('navigation', { name: 'Wo du bearbeitest' });
const options = (s) => s.page.getByRole('toolbar', { name: /Optionen/ });
const card = (s) => s.page.getByRole('region', { name: 'Objekt' });

/** Waits in frames until `ready` holds. */
const until = async (s, ready, what) => {
  for (let i = 0; i < 900; i++) {
    if (await ready()) return;
    await s.wait(0.1);
  }
  throw new Error(`timed out: ${what}`);
};

/** A double click at the pointer, with the click ring of the first click. */
const doubleClick = async (s, target, { move = 0.9 } = {}) => {
  await s.click(target, { move, before: 0.3, after: 0 });
  await s.page.mouse.down({ clickCount: 2 });
  await s.page.mouse.up({ clickCount: 2 });
};

const PAW = [600, 880];
// In the form of the paw (zoomed to 1.311 %): the node of the small loop, then after
// Vereinfachen a round node on the lower right edge, and in the stitches one needle point.
const LOOP = [940, 283];
const CORNER = [871, 457];
const ROUND = [719, 424];
const EDGE = [1097, 727];
const POINT = [1088, 613];
const ON_STITCH = [1050, 700];
// Beside the paw, so the stage shows no stitch readout next to the pointer.
const REST = [1500, 860];

export default {
  title: 'Form und einzelne Stiche',
  part: 13,
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
      say: '[warm] Manchmal stimmt an einem Stickmuster nur ein kleines Detail nicht. Dann änderst du die Form eines Objekts oder sogar einzelne Stiche. Ich öffne die Katze.',
      text: 'Manchmal stimmt an einem Stickmuster nur ein kleines Detail nicht. Dann änderst du die Form eines Objekts oder sogar einzelne Stiche. Ich öffne die Katze.',
      textEn: 'Sometimes just one small detail of a design is not right. Then you change the shape of an object, or even single stitches. I open the cat.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(5.4);
        const cat = btn(s, /^Katze/);
        await s.click(cat, { move: 1.2, before: 0.4, after: 0.4 });
        await until(s, async () => (await btn(s, 'cat-60mm.pes').count()) > 0, 'cat opens');
        await s.move(REST, 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Ich klicke die Pfote an. Oben links auf der Bühne steht der Breadcrumb. Er nennt das Objekt und die Ebene, auf der du arbeitest: Objekte, Form oder Stiche.',
      text: 'Ich klicke die Pfote an. Oben links auf der Bühne steht der Breadcrumb. Er nennt das Objekt und die Ebene, auf der du arbeitest: Objekte, Form oder Stiche.',
      textEn: 'I click the paw. At the top left of the stage is the breadcrumb. It names the object and the level you work on: Objects, Shape or Stitches.',
      run: async (s) => {
        await s.click(PAW, { move: 1.0, before: 0.3, after: 0.6 });
        const level = crumb(s).getByRole('button');
        await s.zoom([520, 140, 0, 0], 1.8);
        await s.move(level, 1.0);
        await s.label('Breadcrumb', crumb(s), 'below');
        await s.wait(2.4);
        await s.click(null, { before: 0.2, after: 0.4 });
        s.unlabel();
        await s.wait(4.2);
        await s.press('Escape', { show: 0 });
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Ein Doppelklick öffnet die Form. Jetzt siehst du den Umriss mit seinen Knoten. Quadrate sind Ecken, Kreise sind runde Knoten.',
      text: 'Ein Doppelklick öffnet die Form. Jetzt siehst du den Umriss mit seinen Knoten. Quadrate sind Ecken, Kreise sind runde Knoten.',
      textEn: 'A double click opens the shape. Now you see the outline with its nodes. Squares are corners, circles are round nodes.',
      run: async (s) => {
        await doubleClick(s, PAW);
        await until(s, async () => (await options(s).getByText(/Knoten/).count()) > 0, 'shape opens');
        await s.move([1480, 560], 1.0);
        await s.wait(1.6);
        await s.zoom([800, 440, 0, 0], 1.6);
        await s.move([CORNER[0] + 30, CORNER[1] + 30], 1.0);
        await s.label('Ecke', [CORNER[0] - 8, CORNER[1] - 8, 16, 16], 'right');
        await s.wait(2.0);
        await s.move([ROUND[0] - 30, ROUND[1] + 30], 0.8);
        await s.label('rund', [ROUND[0] - 8, ROUND[1] - 8, 16, 16], 'left');
        await s.wait(2.0);
        s.unlabel();
        s.zoomOut();
        await s.move([1480, 560], 0.8);
      },
    },
    {
      say: '[curious] Hier hat die Erkennung eine kleine Schlaufe gemacht. Ich klicke den Knoten an und drücke Entfernen. [satisfied] Weg ist sie, und die Pfote wird gleich neu gestickt.',
      text: 'Hier hat die Erkennung eine kleine Schlaufe gemacht. Ich klicke den Knoten an und drücke Entfernen. Weg ist sie, und die Pfote wird gleich neu gestickt.',
      textEn: 'Here the detection made a small loop. I click the node and press Delete. It is gone, and the paw is stitched anew right away.',
      run: async (s) => {
        await s.zoom([LOOP[0] - 20, LOOP[1] + 20, 0, 0], 1.8);
        await s.move([LOOP[0] + 60, LOOP[1] + 60], 1.0);
        await s.label('Schlaufe', [LOOP[0] - 40, LOOP[1] - 20, 50, 60], 'left');
        await s.wait(2.2);
        s.unlabel();
        await s.click(LOOP, { move: 0.8, before: 0.3, after: 0.6 });
        await s.press('Delete', { label: 'Entf', show: 1.4 });
        await s.move([LOOP[0] + 80, LOOP[1] + 80], 0.8);
        await s.wait(2.4);
        s.zoomOut();
        await s.move([1480, 560], 1.0);
      },
    },
    {
      say: 'Aus Stichen erkannte Formen haben oft mehr Knoten als nötig. Vereinfachen in der Leiste über der Bühne nimmt welche weg, ohne die Form sichtbar zu ändern. Aus 32 werden 23 Knoten.',
      text: 'Aus Stichen erkannte Formen haben oft mehr Knoten als nötig. Vereinfachen in der Leiste über der Bühne nimmt welche weg, ohne die Form sichtbar zu ändern. Aus 32 werden 23 Knoten.',
      textEn: 'Shapes detected from stitches often have more nodes than they need. Simplify in the bar above the stage takes some away without visibly changing the shape. 32 nodes become 23.',
      run: async (s) => {
        const simplify = btn(s, 'Vereinfachen', true);
        await s.zoom([700, 160, 0, 0], 1.8);
        await s.move(options(s).getByText(/Knoten/).first(), 1.0);
        await s.label('32 Knoten', options(s).getByText(/Knoten/).first(), 'below');
        await s.wait(2.6);
        s.unlabel();
        await s.move(simplify, 0.8);
        await s.label('Vereinfachen', simplify, 'below');
        await s.wait(2.4);
        await s.click(null, { before: 0.2, after: 0.6 });
        s.unlabel();
        await s.label('23 Knoten', options(s).getByText(/Knoten/).first(), 'below');
        await s.wait(1.6);
        s.unlabel();
        s.zoomOut();
        await s.move([1480, 560], 1.0);
      },
    },
    {
      say: 'Einen Knoten ziehst du einfach mit der Maus. Ich mache die Pfote unten etwas runder. Beim Loslassen stickt heatstitch sie mit ihren Einstellungen neu.',
      text: 'Einen Knoten ziehst du einfach mit der Maus. Ich mache die Pfote unten etwas runder. Beim Loslassen stickt heatstitch sie mit ihren Einstellungen neu.',
      textEn: 'You simply drag a node with the mouse. I make the paw a little rounder at the bottom. When you let go, heatstitch stitches it anew with its settings.',
      run: async (s) => {
        await s.zoom([EDGE[0], EDGE[1] - 40, 0, 0], 1.5);
        await s.wait(1.4);
        await s.drag([EDGE, [EDGE[0] + 40, EDGE[1] + 22]], { sec: 1.4 });
        await s.move([EDGE[0] + 160, EDGE[1] + 90], 0.8);
        await s.wait(2.4);
        s.zoomOut();
        await s.move([1480, 560], 1.0);
      },
    },
    {
      say: 'Mit Enter gehst du eine Ebene tiefer, zu den Stichen. Jeder kleine Punkt ist ein Einstich, also eine Stelle, an der die Nadel in den Stoff geht.',
      text: 'Mit Enter gehst du eine Ebene tiefer, zu den Stichen. Jeder kleine Punkt ist ein Einstich, also eine Stelle, an der die Nadel in den Stoff geht.',
      textEn: 'With Enter you go one level deeper, to the stitches. Every small dot is a needle point, a spot where the needle goes into the fabric.',
      run: async (s) => {
        await s.press('Enter', { show: 1.2 });
        await until(s, async () => (await options(s).getByRole('button', { name: 'Ausdünnen' }).count()) > 0, 'stitches open');
        await s.zoom([520, 140, 0, 0], 1.8);
        await s.label('Stiche', crumb(s), 'below');
        await s.wait(1.8);
        s.unlabel();
        s.zoomOut();
        await s.wait(0.6);
        await s.zoom([POINT[0], POINT[1] + 20, 0, 0], 1.8);
        await s.move([POINT[0] + 70, POINT[1] + 90], 1.2);
        await s.label('Einstich', [POINT[0] - 6, POINT[1] - 6, 12, 12], 'above');
        await s.wait(2.6);
        s.unlabel();
      },
    },
    {
      say: 'Einen Einstich ziehst du an eine andere Stelle. Das kleine Etikett zeigt dabei, wie lang die beiden Stiche daran werden.',
      text: 'Einen Einstich ziehst du an eine andere Stelle. Das kleine Etikett zeigt dabei, wie lang die beiden Stiche daran werden.',
      textEn: 'You drag a needle point to another spot. The small tag shows how long the two stitches at it become.',
      run: async (s) => {
        await s.drag([POINT, [POINT[0] + 12, POINT[1] + 20], [POINT[0] + 22, POINT[1] + 36]], { sec: 1.6 });
        await s.wait(2.6);
      },
    },
    {
      say: 'Ein Doppelklick auf einen Stich setzt dort einen neuen Einstich. Mit Entfernen löschst du den gewählten wieder.',
      text: 'Ein Doppelklick auf einen Stich setzt dort einen neuen Einstich. Mit Entfernen löschst du den gewählten wieder.',
      textEn: 'A double click on a stitch sets a new needle point there. With Delete you remove the selected one again.',
      run: async (s) => {
        await doubleClick(s, ON_STITCH);
        await s.wait(2.4);
        await s.press('Delete', { label: 'Entf', show: 1.4 });
        await s.wait(1.6);
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Ist eine Stelle zu dicht, wählst du mit Strg+A alle Einstiche und klickst auf Ausdünnen. Bei 25 Prozent nimmt heatstitch jeden vierten Einstich heraus.',
      text: 'Ist eine Stelle zu dicht, wählst du mit Strg+A alle Einstiche und klickst auf Ausdünnen. Bei 25 Prozent nimmt heatstitch jeden vierten Einstich heraus.',
      textEn: 'If a spot is too dense, select all needle points with Ctrl+A and click Thin out. At 25 percent, heatstitch takes out every fourth needle point.',
      run: async (s) => {
        await s.press('Control+a', { label: 'Strg+A', show: 1.4 });
        const thin = options(s).getByRole('button', { name: 'Ausdünnen' });
        const quarter = options(s).getByRole('radio', { name: '25 %' });
        await s.zoom([760, 160, 0, 0], 1.8);
        await s.move(thin, 1.0);
        await s.label('Ausdünnen', thin, 'below');
        await s.wait(1.6);
        s.unlabel();
        await s.click(quarter, { move: 0.7, before: 0.3, after: 0.5 });
        await s.click(thin, { move: 0.7, before: 0.3, after: 0.6 });
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(1.4);
      },
    },
    {
      say: 'Rechts zählt die Karte deine Änderungen von Hand. Escape bringt dich zurück zu den Objekten. Und links in der Werkzeugleiste öffnet Stiche von Hand, Taste E, die Stiche jedes Objekts direkt. [warm] So wird jedes Detail genau so, wie du es willst.',
      text: 'Rechts zählt die Karte deine Änderungen von Hand. Escape bringt dich zurück zu den Objekten. Und links in der Werkzeugleiste öffnet Stiche von Hand, Taste E, die Stiche jedes Objekts direkt. So wird jedes Detail genau so, wie du es willst.',
      textEn: 'On the right, the card counts your changes by hand. Esc takes you back to the objects. And on the left in the toolbar, Stitches by hand, key E, opens the stitches of any object directly. That way every detail turns out exactly as you want it.',
      run: async (s) => {
        const hand = card(s).getByText(/Änderung(en)? von Hand/).first();
        await s.zoom([1760, 260, 0, 0], 1.8);
        await s.move(hand, 1.2);
        await s.label('Änderungen von Hand', hand, 'below');
        await s.wait(2.6);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 0.8);
        await s.press('Escape', { label: 'Esc', show: 1.4 });
        await s.wait(0.6);
        const tool = s.page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name: 'Stiche von Hand bearbeiten' });
        await s.zoom([200, 360, 0, 0], 1.6);
        await s.move(tool, 1.2);
        await s.label('Stiche von Hand', tool, 'right');
        s.keyCap('E');
        await s.wait(4.2);
        s.keyCap(null);
        s.unlabel();
        s.zoomOut();
        await s.move(REST, 1.0);
        await s.wait(3.0);
      },
    },
  ],
};

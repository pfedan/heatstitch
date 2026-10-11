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
// A hollow dot halfway along the lower right curve; dragged out it becomes a new node.
const HOLLOW = [1079, 847];
const POINT = [1088, 613];
const ON_STITCH = [1050, 700];
// The last needle point ("Ende") at the tip of the upper toe, and three clicks for a small claw.
const END = [1232, 151];
const CLAW = [[1318, 96], [1250, 162], [1330, 146]];
// Beside the paw, so the stage shows no stitch readout next to the pointer.
const REST = [1500, 860];

export default {
  title: 'Form und einzelne Stiche',
  part: 13,
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
      say: 'Darunter liegt die Aktionsleiste mit Form bearbeiten. Schneller geht ein Doppelklick. Jetzt siehst du den Umriss mit seinen Knoten. Quadrate sind Ecken, Kreise sind runde Knoten.',
      text: 'Darunter liegt die Aktionsleiste mit Form bearbeiten. Schneller geht ein Doppelklick. Jetzt siehst du den Umriss mit seinen Knoten. Quadrate sind Ecken, Kreise sind runde Knoten.',
      textEn: 'Below it is the action bar with Edit shape. A double click is quicker. Now you see the outline with its nodes. Squares are corners, circles are round nodes.',
      run: async (s) => {
        const edit = btn(s, 'Form bearbeiten', true);
        await s.zoom([620, 140, 0, 0], 1.8);
        await s.move(edit, 1.0);
        await s.label('Form bearbeiten', edit, 'below');
        await s.wait(2.4);
        s.unlabel();
        s.zoomOut();
        await doubleClick(s, PAW, { move: 1.0 });
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
      say: 'Erkannte Formen haben oft mehr Knoten als nötig. Das Symbol Vereinfachen nimmt welche weg, ohne die Form sichtbar zu ändern. Aus 32 werden 23 Knoten.',
      text: 'Erkannte Formen haben oft mehr Knoten als nötig. Das Symbol Vereinfachen nimmt welche weg, ohne die Form sichtbar zu ändern. Aus 32 werden 23 Knoten.',
      textEn: 'Detected shapes often have more nodes than they need. The Simplify icon takes some away without visibly changing the shape. 32 nodes become 23.',
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
      say: 'Knoten ziehst du einfach mit der Maus. Ziehst du einen der hohlen Punkte dazwischen, entsteht dort ein neuer Knoten. So mache ich die Pfote unten etwas runder.',
      text: 'Knoten ziehst du einfach mit der Maus. Ziehst du einen der hohlen Punkte dazwischen, entsteht dort ein neuer Knoten. So mache ich die Pfote unten etwas runder.',
      textEn: 'You simply drag nodes with the mouse. Drag one of the hollow dots between them, and a new node appears there. That way I make the paw a little rounder at the bottom.',
      run: async (s) => {
        await s.zoom([HOLLOW[0] + 20, HOLLOW[1] - 40, 0, 0], 1.6);
        await s.move([HOLLOW[0] + 90, HOLLOW[1] - 70], 1.0);
        await s.wait(1.2);
        await s.label('hohler Punkt', [HOLLOW[0] - 6, HOLLOW[1] - 6, 12, 12], 'left');
        await s.wait(2.4);
        s.unlabel();
        await s.drag([HOLLOW, [HOLLOW[0] + 51, HOLLOW[1] + 33]], { sec: 1.6 });
        await s.move([HOLLOW[0] + 170, HOLLOW[1] - 40], 0.8);
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
      say: 'Ich wähle einen Einstich. Pfeile zeigen, wie der Faden läuft. Ziehst du ihn, zeigt das Etikett, wie lang die beiden Stiche daran werden.',
      text: 'Ich wähle einen Einstich. Pfeile zeigen, wie der Faden läuft. Ziehst du ihn, zeigt das Etikett, wie lang die beiden Stiche daran werden.',
      textEn: 'I select a needle point. Arrows show how the thread runs. Drag it, and the tag shows how long the two stitches at it become.',
      run: async (s) => {
        await s.click(POINT, { move: 0.8, before: 0.3, after: 0.4 });
        await s.move([POINT[0] + 60, POINT[1] + 110], 0.8);
        await s.wait(2.4);
        await s.move(POINT, 0.6);
        await s.drag([POINT, [POINT[0] + 12, POINT[1] + 20], [POINT[0] + 22, POINT[1] + 36]], { sec: 1.6 });
        await s.wait(2.6);
        s.zoomOut();
      },
    },
    {
      say: 'Oben endet der Faden, dort steht Ende. Ich wähle den letzten Einstich und drücke W für Weitersticken. Jeder Klick hängt nun einen Einstich an. Enter beendet.',
      text: 'Oben endet der Faden, dort steht Ende. Ich wähle den letzten Einstich und drücke W für Weitersticken. Jeder Klick hängt nun einen Einstich an. Enter beendet.',
      textEn: 'At the top the thread ends; it says End there. I select the last needle point and press W to continue stitching. Each click now adds a needle point. Enter finishes.',
      run: async (s) => {
        await s.zoom([END[0] + 20, END[1] + 40, 0, 0], 1.8);
        await s.move([END[0] + 70, END[1] + 90], 1.0);
        await s.wait(1.8);
        await s.click(END, { move: 0.8, before: 0.3, after: 0.6 });
        await s.press('w', { label: 'W', show: 1.4 });
        await s.wait(1.0);
        for (const p of CLAW) await s.click(p, { move: 0.7, before: 0.2, after: 0.5 });
        await s.move([END[0] + 120, END[1] + 110], 0.6);
        await s.press('Enter', { show: 1.2 });
        await s.wait(1.0);
        s.zoomOut();
      },
    },
    {
      say: 'Ein Doppelklick auf einen Stich setzt einen neuen Einstich. Entfernen löscht ihn wieder.',
      text: 'Ein Doppelklick auf einen Stich setzt einen neuen Einstich. Entfernen löscht ihn wieder.',
      textEn: 'A double click on a stitch sets a new needle point. Delete removes it again.',
      run: async (s) => {
        await s.zoom([ON_STITCH[0], ON_STITCH[1] - 20, 0, 0], 1.8);
        await doubleClick(s, ON_STITCH);
        await s.wait(1.8);
        await s.press('Delete', { label: 'Entf', show: 1.4 });
        await s.wait(1.0);
        s.zoomOut();
        await s.move(REST, 1.0);
      },
    },
    {
      say: 'Ist eine Stelle zu dicht, wählst du mit Strg+A alle Einstiche und klickst auf Ausdünnen. Bei 25 Prozent legt heatstitch die Reihen gleichmäßig weiter auseinander.',
      text: 'Ist eine Stelle zu dicht, wählst du mit Strg+A alle Einstiche und klickst auf Ausdünnen. Bei 25 Prozent legt heatstitch die Reihen gleichmäßig weiter auseinander.',
      textEn: 'If a spot is too dense, select all needle points with Ctrl+A and click Thin out. At 25 percent, heatstitch spreads the rows evenly further apart.',
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
      say: 'Rechts zählt die Karte deine Änderungen von Hand. Escape bringt dich zurück zu den Objekten. Links in der Werkzeugleiste öffnet Stiche von Hand, Taste E, die Stiche jedes Objekts direkt. [warm, proud] So wird jedes Detail genau so, wie du es willst.',
      text: 'Rechts zählt die Karte deine Änderungen von Hand. Escape bringt dich zurück zu den Objekten. Links in der Werkzeugleiste öffnet Stiche von Hand, Taste E, die Stiche jedes Objekts direkt. So wird jedes Detail genau so, wie du es willst.',
      textEn: 'On the right, the card counts your changes by hand. Esc takes you back to the objects. On the left in the toolbar, Stitches by hand, key E, opens the stitches of any object directly. That way every detail turns out exactly as you want it.',
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

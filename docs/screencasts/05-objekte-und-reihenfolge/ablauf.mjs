// Teil 5: Objekte und Reihenfolge. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`,
// mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Die Kirschen öffnen bei 1920 × 1080 immer gleich eingepasst (496 %); die Punkte auf der Bühne
// (Blatt, Kopie, Kirschen) sind darauf abgestimmt.
import fs from 'node:fs';

const SVG = new URL('./material/kirschen.svg', import.meta.url);

const list = (s) => s.page.locator('aside').first();
const colorRow = (s, name) => list(s).getByRole('listitem').filter({ hasText: name });
const objectRow = (s, name) => list(s).getByRole('button', { name: new RegExp(`^${name} \\d`) });

// Points on the stage, in CSS px of the 1920 x 1080 page.
const LEAF = [1180, 165];
// The copy lies 2 mm below and right of the leaf; this point is on the copy only, so a right
// click there hits the copy and not the leaf under it. Mirrored, the copy keeps its middle.
const COPY = [1240, 262];
// Dragged there, the copy's tip meets the stems and its top edge snaps to the leaf's.
const COPY_TO = [744, 225];
// The middle of the moved copy.
const COPY_AT = [700, 160];
const CHERRIES = [540, 650, 830, 380];
const ALL = [450, 70, 980, 960];

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app. The browser cannot show a drag from the file manager; the card stands in for
 * it, and the page gets the same dragenter, dragover and drop events with the real file.
 */
const dragFileIn = async (s, from, to) => {
  const text = fs.readFileSync(SVG, 'utf8');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ text, x, y }) => {
      const file = new File([text], 'kirschen.svg', { type: 'image/svg+xml' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid #e6e1ea';
      const name = document.createElement('span');
      name.textContent = 'kirschen.svg';
      card.append(img, name);
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
    { text, x: from[0], y: from[1] },
  );
  await s.move(to, 1.6);
  await s.wait(0.5);
  await s.page.evaluate(([x, y]) => window.__dropFile(x, y), to);
};

/** A key the viewer needs not see (closing a menu, leaving a field). */
const quietKey = async (s, key) => {
  await s.page.keyboard.press(key);
  await s.wait(0.3);
};

/** Opens the object menu with a right click and picks `item`, with a label on it. */
const menuPick = async (s, at, item, { label = item, look = 1.2 } = {}) => {
  await s.click(at, { move: 0.9, before: 0.3, after: 0.5, button: 'right' });
  const entry = s.page.getByRole('menu', { name: 'Objektaktionen' }).getByRole('menuitem', { name: item });
  await s.wait(look);
  await s.move(entry, 0.8);
  await s.label(label, entry, 'right');
  await s.click(null, { before: 0.6, after: 0.3 });
  s.unlabel();
};

export default {
  title: 'Objekte und Reihenfolge',
  part: 5,
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
      say: '[warm] Ein Stickmuster besteht aus Objekten, und ihre Reihenfolge entscheidet, was oben liegt. Ich ziehe diese Kirschen als SVG einfach auf die Startseite.',
      text: 'Ein Stickmuster besteht aus Objekten, und ihre Reihenfolge entscheidet, was oben liegt. Ich ziehe diese Kirschen als SVG einfach auf die Startseite.',
      textEn: 'An embroidery design is made of objects, and their order decides what ends up on top. I simply drag these cherries, an SVG, onto the start page.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.6);
        await dragFileIn(s, [1915, 640], [975, 600]);
        await s.wait(1.0);
        await s.move([975, 560], 0.8);
        await s.wait(1.0);
      },
    },
    {
      say: 'Links unter Farben und Objekte steht alles in der Reihenfolge, in der die Maschine stickt, von oben nach unten. Jede Farbe ist ein Garn. Ein Klick auf den Pfeil zeigt ihre Objekte, hier die beiden Kirschen.',
      text: 'Links unter Farben und Objekte steht alles in der Reihenfolge, in der die Maschine stickt, von oben nach unten. Jede Farbe ist ein Garn. Ein Klick auf den Pfeil zeigt ihre Objekte, hier die beiden Kirschen.',
      textEn: 'On the left, under Colors and objects, everything is listed in the order the machine stitches it, from top to bottom. Each color is one thread. A click on the arrow shows its objects, here the two cherries.',
      run: async (s) => {
        const heading = s.page.getByRole('heading', { name: 'Farben und Objekte' });
        await s.zoom([200, 330, 0, 0], 1.7);
        await s.move(heading, 1.0);
        await s.label('Farben und Objekte', heading, 'right');
        await s.wait(1.6);
        s.unlabel();
        for (const name of ['Dark Olive', 'Leaf Green', 'White', 'Red']) {
          await s.move(colorRow(s, name).locator('.layer-name'), 0.7);
          await s.wait(0.5);
        }
        await s.wait(1.4);
        const chev = colorRow(s, 'Red').getByRole('button', { name: /zeigen$/ });
        await s.click(chev, { move: 0.7, before: 0.4, after: 0.6 });
        // Stage and list together, so the cherry lights up where the pointer points.
        await s.zoom([640, 520, 0, 0], 1.15);
        await s.move(objectRow(s, 'Füllung 1').last(), 0.8);
        await s.wait(1.4);
        await s.move(objectRow(s, 'Füllung 2').last(), 0.6);
        await s.wait(1.4);
        s.zoomOut();
        await s.move([700, 560], 0.9);
      },
    },
    {
      say: 'Unten rechts im Ansicht-Menü schalte ich Realistische Fäden ein. [curious] Aber wo sind die weißen Glanzlichter? Weiß wird vor Rot gestickt, also deckt das Rot sie zu.',
      text: 'Unten rechts im Ansicht-Menü schalte ich Realistische Fäden ein. Aber wo sind die weißen Glanzlichter? Weiß wird vor Rot gestickt, also deckt das Rot sie zu.',
      textEn: 'At the bottom right, in the view menu, I turn on Realistic threads. But where are the white highlights? White is stitched before red, so the red covers them.',
      run: async (s) => {
        const eye = s.page.getByRole('toolbar', { name: 'Ansicht' }).getByRole('button').first();
        await s.zoom([1430, 800, 0, 0], 1.4);
        await s.move(eye, 1.0);
        await s.label('Ansicht-Menü', eye, 'above');
        await s.click(null, { before: 0.6, after: 0.4 });
        s.unlabel();
        const real = s.page.getByRole('checkbox', { name: 'Realistische Fäden' });
        await s.move(real, 0.9);
        await s.label('Realistische Fäden', real, 'above');
        await s.click(null, { before: 0.5, after: 0.5 });
        s.unlabel();
        await quietKey(s, 'Escape');
        s.zoomOut();
        await s.move([960, 420], 1.0);
        await s.zoom(CHERRIES, 1.5);
        await s.wait(1.0);
        // Where the highlights should be.
        await s.move([712, 760], 1.0);
        await s.wait(0.8);
        await s.move([1180, 778], 0.9);
        await s.wait(2.2);
        s.zoomOut();
        await s.wait(0.6);
      },
    },
    {
      say: 'Die Reihenfolge änderst du per Ziehen. Ich ziehe White unter Red. [delighted] Schon liegen die Glanzlichter obenauf. Darunter steht, dass Weiß jetzt das Rot teilweise abdeckt. Genau das wollen wir.',
      text: 'Die Reihenfolge änderst du per Ziehen. Ich ziehe White unter Red. Schon liegen die Glanzlichter obenauf. Darunter steht, dass Weiß jetzt das Rot teilweise abdeckt. Genau das wollen wir.',
      textEn: 'You change the order by dragging. I drag White below Red. Right away the highlights lie on top. Below, it says that white now partly covers the red. That is exactly what we want.',
      run: async (s) => {
        const white = colorRow(s, 'White').locator('.layer-name');
        await s.zoom([200, 400, 0, 0], 1.6);
        await s.move(white, 1.0);
        await s.label('White', white, 'right');
        await s.wait(1.4);
        s.unlabel();
        const from = await s.point(white);
        const last = await s.box(objectRow(s, 'Füllung 2').last());
        await s.drag([[from.x, from.y], [from.x, last.y + last.height - 4]], { sec: 1.4 });
        // The dropped colour stays selected and dims the rest; without a selection the whole
        // design shows.
        await s.page.evaluate(() => document.activeElement?.blur());
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.zoom([640, 520, 0, 0], 1.15);
        await s.move([712, 760], 1.0);
        await s.wait(1.6);
        const note = list(s).getByRole('status').filter({ hasText: 'Trotzdem so übernommen' });
        await s.move(note, 1.0);
        await s.wait(3.0);
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: 'Über der Liste steht ein Hinweis: Zwei Füllungen liegen teilweise unter anderen und würden dort doppelt gestickt. Ein Klick auf Aussparen, und das Rot lässt unter den Glanzlichtern Platz. [pleased] So wird die Stickerei nicht unnötig dick.',
      text: 'Über der Liste steht ein Hinweis: Zwei Füllungen liegen teilweise unter anderen und würden dort doppelt gestickt. Ein Klick auf Aussparen, und das Rot lässt unter den Glanzlichtern Platz. So wird die Stickerei nicht unnötig dick.',
      textEn: 'Above the list there is a hint: two fills lie partly under others and would be stitched twice there. A click on Knock out, and the red leaves room under the highlights. That way the embroidery does not get needlessly thick.',
      run: async (s) => {
        const hint = list(s).getByRole('status').filter({ hasText: 'doppelt gestickt' });
        const knock = hint.getByRole('button', { name: 'Aussparen' });
        await s.zoom([200, 200, 0, 0], 1.7);
        await s.move(hint.getByRole('paragraph'), 1.0);
        await s.wait(4.6);
        await s.move(knock, 0.8);
        await s.label('Aussparen', knock, 'below');
        await s.click(null, { before: 0.8, after: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move([712, 700], 1.0);
        await s.zoom(CHERRIES, 1.5);
        await s.wait(3.6);
        s.zoomOut();
        await s.wait(0.4);
      },
    },
    {
      say: 'Jetzt ein zweites Blatt. Ein Rechtsklick auf das Blatt öffnet ein Menü mit allem, was du mit einem Objekt tun kannst. Ich wähle Duplizieren. Die Kopie liegt fast genau auf dem Original.',
      text: 'Jetzt ein zweites Blatt. Ein Rechtsklick auf das Blatt öffnet ein Menü mit allem, was du mit einem Objekt tun kannst. Ich wähle Duplizieren. Die Kopie liegt fast genau auf dem Original.',
      textEn: 'Now a second leaf. A right click on the leaf opens a menu with everything you can do with an object. I choose Duplicate. The copy lies almost exactly on the original.',
      run: async (s) => {
        // Nothing selected after knocking out: the first Escape leaves the shape, the second the selection.
        await s.page.evaluate(() => document.activeElement?.blur());
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.wait(1.0);
        await menuPick(s, LEAF, 'Duplizieren', { look: 3.2 });
        await s.move([COPY[0] + 60, COPY[1] + 140], 0.9);
        await s.zoom([1200, 190, 0, 0], 1.6);
        await s.wait(2.6);
        s.zoomOut();
      },
    },
    {
      say: 'Noch ein Rechtsklick, Waagrecht spiegeln. Dann ziehe ich die Kopie nach links. Einrasten ist an: [focused] Eine Linie zeigt, wann das Blatt genau auf der Höhe des anderen sitzt.',
      text: 'Noch ein Rechtsklick, Waagrecht spiegeln. Dann ziehe ich die Kopie nach links. Einrasten ist an: Eine Linie zeigt, wann das Blatt genau auf der Höhe des anderen sitzt.',
      textEn: 'Another right click, Flip horizontally. Then I drag the copy to the left. Snap is on: a line shows when the leaf sits exactly at the height of the other one.',
      run: async (s) => {
        await menuPick(s, COPY, 'Waagrecht spiegeln', { look: 0.6 });
        await s.wait(1.0);
        const snap = s.page.getByText('Einrasten', { exact: true });
        await s.move(snap, 0.9);
        await s.label('Einrasten', snap, 'below');
        await s.wait(1.4);
        s.unlabel();
        await s.drag([COPY, [COPY[0] - 280, COPY[1] - 20], COPY_TO], { sec: 1.4 });
        await s.wait(1.6);
      },
    },
    {
      say: 'Das neue Blatt bekommt ein dunkleres Grün. Rechtsklick, Garn wählen, Deep Green. Nur dieses Objekt wechselt das Garn. In der Liste steht es jetzt als eigene Farbe.',
      text: 'Das neue Blatt bekommt ein dunkleres Grün. Rechtsklick, Garn wählen, Deep Green. Nur dieses Objekt wechselt das Garn. In der Liste steht es jetzt als eigene Farbe.',
      textEn: 'The new leaf gets a darker green. Right click, Choose thread, Deep Green. Only this object changes its thread. In the list it now has a color of its own.',
      run: async (s) => {
        await s.wait(0.8);
        await menuPick(s, COPY_AT, 'Garn wählen …', { label: 'Garn wählen', look: 0.6 });
        await s.wait(0.8);
        const pick = s.page.getByRole('dialog', { name: 'Garn dieses Objekts wählen' }).getByRole('button', { name: '808 Deep Green' });
        await s.click(pick, { move: 1.0, before: 0.5, after: 0.5 });
        await s.page.evaluate(() => document.activeElement?.blur());
        await quietKey(s, 'Escape');
        await quietKey(s, 'Escape');
        await s.move([700, 300], 0.8);
        await s.wait(1.6);
        const row = colorRow(s, 'Deep Green').locator('.layer-name');
        await s.zoom([200, 330, 0, 0], 1.6);
        await s.move(row, 1.0);
        await s.label('Deep Green', row, 'right');
        await s.wait(3.0);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: '[proud, warm] Fertig sind die Kirschen, mit zwei Blättern und Glanzlichtern obenauf. Mit der Leertaste siehst du, wie die Maschine alles in dieser Reihenfolge stickt. [warm] Viel Spaß beim Sticken!',
      text: 'Fertig sind die Kirschen, mit zwei Blättern und Glanzlichtern obenauf. Mit der Leertaste siehst du, wie die Maschine alles in dieser Reihenfolge stickt. Viel Spaß beim Sticken!',
      textEn: 'The cherries are done, with two leaves and the highlights on top. The space bar shows you how the machine stitches everything in this order. Have fun embroidering!',
      run: async (s) => {
        await s.move([420, 560], 1.0);
        await s.zoom(ALL, 1.05);
        await s.wait(2.4);
        await s.press('Home', { label: 'Pos1', show: 0.4 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(6.0);
        s.zoomOut();
        await s.wait(0.6);
      },
    },
  ],
};

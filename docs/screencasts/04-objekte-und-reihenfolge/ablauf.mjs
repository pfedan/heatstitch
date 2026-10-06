// Teil 4: Objekte und Reihenfolge. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`,
// mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
import { fileURLToPath } from 'node:url';

const svg = fileURLToPath(new URL('./material/kirschen.svg', import.meta.url));
const away = [1480, 600]; // a quiet spot on the canvas, beside the cherries

// Places on the canvas after opening, fitting and one wheel step out (1920 x 1080).
const leaf = [1115, 245];
const leafCopy = [1146, 278]; // the copy lies 2 mm right of and below the leaf
const leftCherry = [740, 830];

const row = (s, name) => s.page.locator('.layer', { hasText: name }).first();

export default {
  title: 'Objekte und Reihenfolge',
  part: 4,
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
      say: '[warm, inviting] Ein Stickmuster besteht aus Objekten. In diesem Video bringst du sie in die richtige Reihenfolge, kopierst, spiegelst und färbst sie, an einem Kirschenpaar.',
      text: 'Ein Stickmuster besteht aus Objekten. In diesem Video bringst du sie in die richtige Reihenfolge, kopierst, spiegelst und färbst sie, an einem Kirschenpaar.',
      textEn: 'A design is made of objects. In this video you put them in the right order, copy, mirror and colour them, on a pair of cherries.',
      run: async (s) => {
        await s.move([960, 600], 0.1);
        await s.wait(5.5);
        await s.move('#dropzone', 2.0);
      },
    },
    {
      say: 'Ich öffne meine Zeichnung als SVG. Aus jeder Form wird ein Objekt, gestickt in der Reihenfolge, in der die Datei sie malt.',
      text: 'Ich öffne meine Zeichnung als SVG. Aus jeder Form wird ein Objekt, gestickt in der Reihenfolge, in der die Datei sie malt.',
      textEn: 'I open my drawing as an SVG. Every shape becomes an object, stitched in the order in which the file paints them.',
      run: async (s) => {
        await s.label('SVG', '#dropzone', 'below');
        const chooser = s.page.waitForEvent('filechooser');
        await s.click('#dropzone', { move: 0.4 });
        await (await chooser).setFiles(svg);
        await s.wait(1.2);
        s.unlabel();
        await s.click('text=Einpassen', { move: 0.9 });
        await s.move([950, 560], 0.8);
        await s.page.mouse.wheel(0, 120);
        await s.wait(1.5);
      },
    },
    {
      say: 'Rechts stehen die Farben, oben die erste, unten die letzte. Der Pfeil klappt eine Farbe auf und zeigt ihre Objekte. [focused] Im Feld Objekt steht, als wievieltes es gestickt wird und auf wie vielen anderen es liegt.',
      text: 'Rechts stehen die Farben, oben die erste, unten die letzte. Der Pfeil klappt eine Farbe auf und zeigt ihre Objekte. Im Feld Objekt steht, als wievieltes es gestickt wird und auf wie vielen anderen es liegt.',
      textEn: 'On the right are the colours, the first at the top, the last at the bottom. The arrow opens a colour and shows its objects. The Object panel tells you at which place it is stitched and how many others it lies on.',
      run: async (s) => {
        await s.zoom('#layers-panel', 1.4);
        await s.label('Farben', row(s, 'Dark Olive'), 'left');
        await s.move(row(s, 'Dark Olive'), 1.0);
        await s.move(row(s, 'White'), 1.6);
        s.unlabel();
        await s.wait(0.6);
        await s.click(row(s, 'Red').locator('.chev'), { move: 0.9 });
        await s.wait(0.8);
        await s.click(s.page.locator('.layer.object', { hasText: 'Füllung 1' }).last(), { move: 0.8 });
        s.zoomOut();
        await s.wait(0.8);
        const lage = s.page.locator('#object-body dl.stats dd').last();
        await s.zoom(lage, 1.5);
        await s.move(lage, 1.0);
        await s.label('Lage', lage, 'left');
        await s.wait(3.2);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: '[curious] Die Kirsche liegt auf zwei Objekten, dem Stiel und dem Glanzpunkt. Weiß kommt nämlich vor Rot dran. Ich ziehe Weiß in der Liste unter Rot, [delighted] und da sind die Glanzpunkte. Was später gestickt wird, liegt oben.',
      text: 'Die Kirsche liegt auf zwei Objekten, dem Stiel und dem Glanzpunkt. Weiß kommt nämlich vor Rot dran. Ich ziehe Weiß in der Liste unter Rot, und da sind die Glanzpunkte. Was später gestickt wird, liegt oben.',
      textEn: 'The cherry lies on two objects, the stem and the highlight. That is because white comes before red. I drag white below red in the list, and there are the highlights. What is stitched later lies on top.',
      run: async (s) => {
        await s.move(leftCherry, 1.2);
        await s.wait(3.0);
        await s.page.keyboard.press('Escape');
        await s.wait(0.4);
        await s.click(row(s, 'Red').locator('.chev'), { move: 1.0 });
        await s.wait(0.5);
        const from = await s.box(row(s, 'White'));
        const to = await s.box(row(s, 'Red'));
        const x = from.x + 110;
        await s.label('ziehen', row(s, 'White'), 'left');
        await s.drag([[x, from.y + from.height / 2], [x, to.y + to.height * 0.85]], { sec: 1.2 });
        s.unlabel();
        await s.wait(0.8);
        await s.move([740, 740], 1.0);
        await s.wait(1.2);
        await s.move([1120, 750], 0.8);
        await s.wait(1.5);
      },
    },
    {
      say: 'Die Karte darüber bietet an, die Kirschen unter den Glanzpunkten auszusparen. Dann liegt dort kein doppeltes Garn.',
      text: 'Die Karte darüber bietet an, die Kirschen unter den Glanzpunkten auszusparen. Dann liegt dort kein doppeltes Garn.',
      textEn: 'The card above offers to leave out the cherries under the highlights. Then there is no double thread there.',
      run: async (s) => {
        const button = s.page.locator('button', { hasText: 'Aussparen' }).first();
        await s.zoom(button, 1.4);
        await s.label('Aussparen', button, 'below');
        await s.move(button, 1.0);
        await s.wait(2.4);
        await s.click(button, { move: 0.2 });
        await s.wait(1.0);
        s.unlabel();
        s.zoomOut();
        await s.click(away, { move: 1.0 });
      },
    },
    {
      say: '[enthusiastic] Jetzt bekommt das Blatt einen Partner. Ein Rechtsklick öffnet ein kleines Menü: Duplizieren. Dieselben Knöpfe stehen auch im Feld Objekt. Ich spiegle die Kopie waagrecht.',
      text: 'Jetzt bekommt das Blatt einen Partner. Ein Rechtsklick öffnet ein kleines Menü: Duplizieren. Dieselben Knöpfe stehen auch im Feld Objekt. Ich spiegle die Kopie waagrecht.',
      textEn: 'Now the leaf gets a partner. A right click opens a small menu: Duplicate. The same buttons are in the Object panel too. I mirror the copy horizontally.',
      run: async (s) => {
        await s.move(leaf, 1.4);
        await s.label('Rechtsklick', [leaf[0], leaf[1] + 30, 0, 0], 'below');
        await s.wait(0.6);
        await s.page.mouse.click(leaf[0], leaf[1], { button: 'right' });
        await s.wait(0.6);
        s.unlabel();
        const dup = s.page.locator('.object-menu button', { hasText: 'Duplizieren' });
        await s.move(dup, 0.8);
        await s.wait(0.6);
        await s.click(dup, { move: 0.1 });
        await s.wait(1.4);
        const mirror = s.page.locator('#object-body button[title^="Waagrecht"]').first();
        await s.zoom(mirror, 1.4);
        await s.label('Spiegeln', mirror, 'below');
        await s.click(mirror, { move: 1.2, before: 0.6 });
        await s.wait(1.2);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Dann ziehe ich sie nach links. Die feine Linie zeigt: Sie rastet genau am ersten Blatt ein.',
      text: 'Dann ziehe ich sie nach links. Die feine Linie zeigt: Sie rastet genau am ersten Blatt ein.',
      textEn: 'Then I drag it to the left. The thin line shows it snaps exactly onto the first leaf.',
      run: async (s) => {
        const to = [leafCopy[0] - 398, leafCopy[1] - 30];
        await s.move(leafCopy, 0.8);
        await s.wait(0.2);
        await s.page.mouse.down();
        await s.move([to[0] + 40, to[1] - 4], 1.6);
        await s.move(to, 0.5);
        await s.wait(2.0);
        await s.page.mouse.up();
        await s.wait(0.6);
      },
    },
    {
      say: 'Das zweite Blatt bekommt ein dunkleres Grün. Klick aufs Farbquadrat, Garn wählen. Es wird gleich nach dem ersten Blatt gestickt.',
      text: 'Das zweite Blatt bekommt ein dunkleres Grün. Klick aufs Farbquadrat, Garn wählen. Es wird gleich nach dem ersten Blatt gestickt.',
      textEn: 'The second leaf gets a darker green. Click the colour square, choose a thread. It is stitched right after the first leaf.',
      run: async (s) => {
        const sw = '#object-body .thread-sw';
        await s.label('Garn', sw, 'below');
        await s.click(sw, { move: 1.0 });
        await s.wait(0.8);
        s.unlabel();
        await s.click('.color-pop .pick[title*="Emerald Green"]', { move: 1.0, before: 0.5 });
        await s.wait(1.0);
        await s.click(away, { move: 0.8 });
        await s.move(row(s, 'Emerald Green'), 1.0);
        await s.wait(1.6);
      },
    },
    {
      say: 'Mit der Leertaste siehst du die Reihenfolge: Stiele, Blätter, Kirschen und ganz zum Schluss die Glanzpunkte.',
      text: 'Mit der Leertaste siehst du die Reihenfolge: Stiele, Blätter, Kirschen und ganz zum Schluss die Glanzpunkte.',
      textEn: 'The space bar shows you the order: stems, leaves, cherries and, last of all, the highlights.',
      run: async (s) => {
        await s.move(away, 0.8);
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(5.0);
      },
    },
    {
      say: '[proud, warm] Mit Realistischen Fäden siehst du, wie es auf dem Stoff wirkt. Fertig ist dein Kirschenpaar.',
      text: 'Mit Realistischen Fäden siehst du, wie es auf dem Stoff wirkt. Fertig ist dein Kirschenpaar.',
      textEn: 'Realistic threads show you how it looks on the fabric. Your pair of cherries is done.',
      run: async (s) => {
        await s.click(s.page.locator('label.check', { hasText: 'Realistische Fäden' }), { move: 1.2 });
        await s.move(away, 0.8);
        // The checkbox keeps the focus and would swallow the key.
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('h', { label: 'H', show: 0.8 });
        await s.zoom([940, 560, 0, 0], 1.3);
        await s.wait(4.0);
        s.zoomOut();
      },
    },
  ],
};

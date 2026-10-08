// Teil 4: Vom SVG zum Stickmuster. Szenen wie in vorlage.md; der Sprechtext jeder Szene
// (`say`, mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt
// die Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.
//
// Bild umwandeln und Vorschlagen rechnen in Echtzeit (Worker, Vorschlagen auf der ganzen Kontur
// einige Sekunden). Die Szenen warten deshalb in kurzen s.wait-Schritten auf das Ergebnis, damit
// weiter Bilder entstehen und es auch ohne Bilder (Teile) klappt.
import fs from 'node:fs';

const SVG = new URL('./material/katze-im-karton.svg', import.meta.url);

const btn = (s, name) => s.page.getByRole('button', { name }).first();
const colorCard = (s) => s.page.getByRole('complementary').filter({ has: s.page.getByRole('heading', { name: 'Farben', exact: true }) });

/** Waits in frames until `ready` holds (and no image worker is busy). */
const settle = async (s, ready = async () => true, min = 0.4) => {
  await s.wait(min);
  for (let i = 0; i < 1200; i++) {
    if (!(await s.page.locator('.image-status.busy').count()) && (await ready())) return;
    await s.wait(0.1);
  }
  throw new Error('did not settle');
};

/**
 * Shows a file card that the pointer carries in from the right edge of the window and drops
 * onto the app (see Teil 3): the page gets dragenter, dragover and drop with the real file.
 */
const dragFileIn = async (s, from, to) => {
  const text = fs.readFileSync(SVG, 'utf8');
  await s.move(from, 0.7);
  await s.page.evaluate(
    ({ text, x, y }) => {
      const file = new File([text], 'katze-im-karton.svg', { type: 'image/svg+xml' });
      const card = document.createElement('div');
      card.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;' +
        'padding:8px 18px 8px 8px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 16px Inter,system-ui,sans-serif;color:#1d1a22;white-space:nowrap';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid #e6e1ea';
      const name = document.createElement('span');
      name.textContent = 'katze-im-karton.svg';
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

// The realistic view takes its light from the pointer's side of the stage: up left the threads
// shine. The pointer rests there in Gestalten, off the motif, so no stitch readout shows.
const REST = [420, 140];
// Where box flaps and rim meet in the middle of the box, as the design opens (fitted).
const BOX_MIDDLE = [1022, 650];

export default {
  title: 'Vom SVG zum Stickmuster',
  part: 4,
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
      say: '[warm] Hast du eine Grafik als SVG, etwa aus einem Zeichenprogramm, macht heatstitch daraus besonders saubere Stiche. Auf der Startseite geht es wieder über „Bild umwandeln“.',
      text: 'Hast du eine Grafik als SVG, etwa aus einem Zeichenprogramm, macht heatstitch daraus besonders saubere Stiche. Auf der Startseite geht es wieder über „Bild umwandeln“.',
      textEn: 'If you have a graphic as SVG, say from a drawing program, heatstitch makes especially clean stitches from it. On the start page, again use “Convert image”.',
      run: async (s) => {
        await s.move([960, 300], 0.1);
        await s.wait(4.6);
        const start = btn(s, /^Bild umwandeln/);
        await s.move(start, 1.0);
        await s.label('Bild umwandeln', start, 'above');
        await s.wait(1.2);
        await s.click(null, { before: 0.3, after: 0.6 });
        s.unlabel();
        await s.wait(0.8);
      },
    },
    {
      say: 'Ich ziehe diese Katze im Karton ins Fenster. Links steht, was heatstitch gelesen hat: eine SVG mit acht Farben, hundert Millimeter breit.',
      text: 'Ich ziehe diese Katze im Karton ins Fenster. Links steht, was heatstitch gelesen hat: eine SVG mit acht Farben, hundert Millimeter breit.',
      textEn: 'I drag this cat in a box into the window. On the left you see what heatstitch has read: an SVG with eight colors, a hundred millimeters wide.',
      run: async (s) => {
        await dragFileIn(s, [1912, 760], [1110, 560]);
        const info = s.page.getByText(/^katze-im-karton, SVG mit/);
        await settle(s, async () => (await info.count()) > 0);
        await s.move([1250, 640], 1.0);
        await s.wait(0.8);
        await s.zoom([150, 380, 0, 0], 1.8);
        await s.move(info, 1.0);
        await s.label('SVG mit 8 Farben', info, 'below');
        await s.wait(1.8);
        s.unlabel();
        const width = s.page.getByText('Breite (mm)');
        await s.move(width, 0.8);
        await s.label('100 mm', width, 'right');
        await s.wait(1.8);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Im zweiten Schritt muss heatstitch nichts raten. Jede Farbe der Datei wird ein Garn. Und die schwarzen Konturen sind Linien mit einer Breite: Je nach Breite werden sie Steppstich oder Satin.',
      text: 'Im zweiten Schritt muss heatstitch nichts raten. Jede Farbe der Datei wird ein Garn. Und die schwarzen Konturen sind Linien mit einer Breite: Je nach Breite werden sie Steppstich oder Satin.',
      textEn: 'In the second step, heatstitch has nothing to guess. Every color of the file becomes a thread. And the black outlines are lines with a width: depending on the width they become running stitch or satin.',
      run: async (s) => {
        const next = btn(s, 'Weiter');
        await s.move(next, 1.0);
        await s.label('Weiter', next, 'above');
        await s.click(null, { before: 0.3 });
        s.unlabel();
        await settle(s, async () => (await colorCard(s).getByRole('listitem').count()) > 0);
        const about = s.page.getByText(/^Farben und Formen kommen direkt aus der SVG/);
        await s.zoom([150, 140, 0, 0], 1.9);
        await s.move(about, 1.0);
        await s.wait(1.6);
        s.zoomOut();
        await s.zoom([1760, 260, 0, 0], 1.7);
        await s.move([1720, 260], 1.0);
        await s.label('Farben', colorCard(s).getByRole('heading', { name: 'Farben', exact: true }), 'above');
        await s.wait(1.6);
        s.unlabel();
        const black = colorCard(s).getByRole('listitem').filter({ hasText: 'Black' }).first();
        await s.move(black, 0.8);
        await s.label('Konturen', black, 'left');
        await s.wait(2.2);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Im dritten Schritt siehst du es: Die Konturen sind Satinsäulen, die der Linie folgen. [pleased] Mit „Übernehmen“ wird daraus ein Stickmuster.',
      text: 'Im dritten Schritt siehst du es: Die Konturen sind Satinsäulen, die der Linie folgen. Mit „Übernehmen“ wird daraus ein Stickmuster.',
      textEn: 'In the third step you can see it: the outlines are satin columns that follow the line. “Apply” turns it into an embroidery design.',
      run: async (s) => {
        const next = btn(s, 'Weiter');
        await s.move(next, 1.0);
        await s.click(null, { before: 0.3 });
        await settle(s, async () => (await s.page.getByRole('heading', { name: 'Ergebnis' }).count()) > 0);
        await s.move([520, 200], 1.0);
        await s.zoom([700, 300, 0, 0], 2.4);
        await s.wait(2.0);
        s.zoomOut();
        await s.zoom([640, 660, 0, 0], 2.4);
        await s.wait(1.8);
        s.zoomOut();
        const apply = btn(s, 'Übernehmen');
        await s.move(apply, 1.0);
        await s.label('Übernehmen', apply, 'above');
        await s.click(null, { before: 0.4 });
        s.unlabel();
        await btn(s, /^katze-im-karton/).waitFor();
        await s.wait(0.6);
        await s.move(REST, 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Links unter Farben und Objekte klappe ich Black auf. Satin 1 ist die ganze Kontur: Alle Linien, die sich berühren, sind ein Satin.',
      text: 'Links unter Farben und Objekte klappe ich Black auf. Satin 1 ist die ganze Kontur: Alle Linien, die sich berühren, sind ein Satin.',
      textEn: 'On the left under Colors and objects I expand Black. Satin 1 is the whole outline: all lines that touch are one satin.',
      run: async (s) => {
        const row = s.page.locator('li.color-row', { hasText: 'Black' }).first();
        await s.move(row.locator('.layer-name'), 1.2);
        await s.label('Black', row.locator('.layer-name'), 'right');
        await s.wait(0.6);
        await s.click(row.locator('button.chev'), { move: 0.5 });
        s.unlabel();
        const satin = s.page.getByText('Satin 1', { exact: true });
        await s.move(satin, 0.8);
        await s.label('Satin 1', satin, 'right');
        await s.click(null, { before: 0.4, after: 0.6 });
        s.unlabel();
        await s.move(REST, 1.2);
        await s.wait(2.6);
      },
    },
    {
      say: 'Mit der Taste R öffnest du das Werkzeug Richtung. Hier liegt jeder Satin in Abschnitten seiner Fläche, so wie er gerade gestickt wird.',
      text: 'Mit der Taste R öffnest du das Werkzeug Richtung. Hier liegt jeder Satin in Abschnitten seiner Fläche, so wie er gerade gestickt wird.',
      textEn: 'The R key opens the Direction tool. Here every satin lies in sections of its area, just as it is stitched right now.',
      run: async (s) => {
        await s.press('r', { label: 'R' });
        await btn(s, 'Leeren').waitFor();
        await s.wait(0.6);
        const bar = s.page.getByText('Richtung', { exact: true }).first();
        await s.zoom([700, 114, 0, 0], 1.8);
        await s.move(bar, 1.0);
        await s.label('Richtung', bar, 'below');
        await s.wait(1.8);
        s.unlabel();
        s.zoomOut();
        await s.move([1500, 300], 1.0);
        await s.zoom(BOX_MIDDLE, 2.0);
        await s.wait(3.0);
        s.zoomOut();
      },
    },
    {
      say: '„Leeren“ nimmt alle Trennlinien und Querlinien weg. So fängst du neu an.',
      text: '„Leeren“ nimmt alle Trennlinien und Querlinien weg. So fängst du neu an.',
      textEn: '“Clear” removes all cut lines and rungs. That is how you start over.',
      run: async (s) => {
        const clear = btn(s, 'Leeren');
        await s.zoom([700, 114, 0, 0], 1.8);
        await s.move(clear, 1.0);
        await s.label('Leeren', clear, 'below');
        await s.click(null, { before: 0.4 });
        s.unlabel();
        s.zoomOut();
        await s.move([1500, 300], 1.0);
        await s.zoom(BOX_MIDDLE, 2.0);
        await s.wait(2.4);
        s.zoomOut();
      },
    },
    {
      say: '[curious] Und jetzt der Zauberstab: „Vorschlagen“ zerlegt die Kontur so, wie man es von Hand tun würde. Trennlinien teilen sie in Abschnitte, Querlinien legen die Stichrichtung fest. An Kreuzungen läuft die geradeste Linie durch, an spitzen Ecken wird auf Gehrung geschnitten.',
      text: 'Und jetzt der Zauberstab: „Vorschlagen“ zerlegt die Kontur so, wie man es von Hand tun würde. Trennlinien teilen sie in Abschnitte, Querlinien legen die Stichrichtung fest. An Kreuzungen läuft die geradeste Linie durch, an spitzen Ecken wird auf Gehrung geschnitten.',
      textEn: 'And now the magic wand: “Suggest” splits the outline the way you would by hand. Cut lines divide it into sections, rungs set the stitch direction. At crossings the straightest line runs through, at sharp corners it is cut on the miter.',
      run: async (s) => {
        const suggest = btn(s, 'Vorschlagen');
        await s.zoom([700, 114, 0, 0], 1.8);
        await s.move(suggest, 1.0);
        await s.label('Vorschlagen', suggest, 'below');
        await s.click(null, { before: 0.4 });
        s.unlabel();
        // Vorschlagen holds the page for a few seconds; the status names the result when done.
        await settle(s, async () => (await s.page.getByText(/^Vorschlag gestickt/).count()) > 0);
        s.zoomOut();
        await s.move([1500, 300], 1.0);
        await s.wait(1.6);
        await s.zoom(BOX_MIDDLE, 2.6);
        await s.wait(5.0);
        s.zoomOut();
      },
    },
    {
      say: 'An jedem Abschnitt steht seine Nummer in der Reihenfolge, ein Pfeil für die Richtung und eine Schere für einen Garnschnitt davor. Ein Klick auf den Pfeil dreht die Richtung um.',
      text: 'An jedem Abschnitt steht seine Nummer in der Reihenfolge, ein Pfeil für die Richtung und eine Schere für einen Garnschnitt davor. Ein Klick auf den Pfeil dreht die Richtung um.',
      textEn: 'Each section shows its number in the order, an arrow for the direction and scissors for a thread trim before it. A click on the arrow reverses the direction.',
      run: async (s) => {
        await s.zoom(BOX_MIDDLE, 2.6);
        await s.move(BOX_MIDDLE, 1.0);
        await s.wait(6.0);
        s.zoomOut();
      },
    },
    {
      say: 'Mit „Fertig“ wird der Satin so neu gestickt. In den realistischen Fäden siehst du die sauberen Säulen. [warm] Viel Spaß beim Sticken!',
      text: 'Mit „Fertig“ wird der Satin so neu gestickt. In den realistischen Fäden siehst du die sauberen Säulen. Viel Spaß beim Sticken!',
      textEn: '“Done” stitches the satin anew this way. In the realistic threads you see the clean columns. Have fun embroidering!',
      run: async (s) => {
        const done = btn(s, 'Fertig');
        await s.move(done, 1.0);
        await s.label('Fertig', done, 'below');
        await s.click(null, { before: 0.4 });
        s.unlabel();
        await s.move(REST, 1.2);
        await s.zoom([1022, 560, 0, 0], 1.6);
        await s.wait(3.0);
        s.zoomOut();
        await s.page.evaluate(() => document.activeElement?.blur());
        await s.press('Home', { label: 'Pos1', show: 0.3 });
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.wait(6.0);
      },
    },
  ],
};

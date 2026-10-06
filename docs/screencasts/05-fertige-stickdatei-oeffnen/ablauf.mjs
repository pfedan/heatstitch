// Teil 5: Fertige Stickdatei öffnen. Szenen wie in vorlage.md; der Sprechtext jeder Szene (`say`,
// mit englischer Regie) wird mit tools/screencast/tts.mjs vertont, seine Länge bestimmt die
// Szenenlänge. `text` und `textEn` sind die Untertitel, ohne Regie.

const away = [1480, 230]; // a quiet spot on the canvas, inside the hoop but off the cat

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The browser in the container cannot show a file dragged in from the desktop. A small file card
 * follows the pointer instead, the page gets the same drag events as from a real drop, and the
 * file is the built-in cat under the name a user would have.
 */
const dropFile = async (s, from, to, sec = 1.6) => {
  await s.page.evaluate(([x, y]) => {
    const c = document.createElement('div');
    c.id = 'screencast-file';
    c.innerHTML =
      '<div style="width:46px;height:56px;background:#fff;border:1px solid #bbb;border-radius:4px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;' +
      'font:600 11px Inter,sans-serif;color:#c2185b;padding-bottom:6px;box-sizing:border-box">PES</div>' +
      '<div style="font:13px Inter,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:2px 6px;' +
      'border-radius:4px;margin-top:4px">katze.pes</div>';
    Object.assign(c.style, {
      position: 'fixed', left: `${x - 23}px`, top: `${y - 20}px`, zIndex: 9999, display: 'flex',
      flexDirection: 'column', alignItems: 'center', pointerEvents: 'none',
    });
    document.body.append(c);
  }, from);
  await s.move(from, 0.6);
  await s.wait(0.4);
  const n = Math.round(sec * 30);
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    const p = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    await s.page.evaluate(([x, y]) => {
      const c = document.getElementById('screencast-file');
      c.style.left = `${x - 23}px`;
      c.style.top = `${y - 20}px`;
    }, p);
    // The field lights up once the file is over the page's left column.
    if (i === Math.round(n * 0.55)) await s.page.evaluate(() => window.dispatchEvent(new DragEvent('dragenter')));
    await s.move(p, 1 / 30);
  }
  await s.wait(0.5);
  await s.page.evaluate(async () => {
    const blob = await (await fetch('examples/cat-60mm.pes')).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'katze.pes'));
    document.getElementById('screencast-file').remove();
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt }));
  });
};

/** Glides the pointer along the player slider to a share of its length, dragging the knob. */
const slideTo = async (s, from, to, sec = 1.2) => {
  const b = await s.box('#player-pos');
  const at = (f) => [b.x + 8 + f * (b.width - 16), b.y + b.height / 2];
  await s.drag([at(from), at(to)], { sec });
};

const blur = (s) => s.page.evaluate(() => document.activeElement?.blur());

export default {
  title: 'Fertige Stickdatei öffnen',
  part: 5,
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
      say: '[warm, inviting] Du hast eine fertige Stickdatei, gekauft oder geschenkt, und willst sie nachbessern? Der erste Schritt: Öffne sie und schau genau hin, wie sie gestickt wird. Genau das zeigt dieses Video.',
      text: 'Du hast eine fertige Stickdatei, gekauft oder geschenkt, und willst sie nachbessern? Der erste Schritt: Öffne sie und schau genau hin, wie sie gestickt wird. Genau das zeigt dieses Video.',
      textEn: 'You have a finished embroidery file, bought or given to you, and want to improve it? The first step: open it and look closely at how it is stitched. That is what this video shows.',
      run: async (s) => {
        await s.move([960, 600], 0.1);
        await s.wait(6.5);
        await s.move([760, 420], 1.8);
      },
    },
    {
      say: 'Zieh die Datei einfach links in das Feld Dateien. Das geht mit PES, DST und den anderen gängigen Formaten. [short pause] Deine Datei bleibt dabei auf deinem Gerät. Ohne eigene Datei probierst du es mit „Beispiel laden“.',
      text: 'Zieh die Datei einfach links in das Feld Dateien. Das geht mit PES, DST und den anderen gängigen Formaten. Deine Datei bleibt dabei auf deinem Gerät. Ohne eigene Datei probierst du es mit „Beispiel laden“.',
      textEn: 'Simply drag the file into the Files field on the left. That works with PES, DST and the other common formats. Your file stays on your device. Without a file of your own, try “Load example”.',
      run: async (s) => {
        await s.wait(0.3);
        await s.label('ziehen', [150, 143, 0, 0], 'right');
        await dropFile(s, [760, 420], [160, 150], 1.8);
        s.unlabel();
        await s.wait(1.6);
        await s.move([600, 500], 0.8);
        await s.wait(4.0);
        const local = s.page.locator('[data-i18n="files.privacy"]:visible');
        await s.move(local, 0.8);
        await s.label('bleibt bei dir', local, 'right');
        await s.wait(4.0);
        s.unlabel();
        await s.wait(1.5);
        await s.move('#load-example', 1.0);
        await s.label('Beispiel laden', '#load-example', 'right');
        await s.wait(4.0);
        s.unlabel();
      },
    },
    {
      say: '[curious] Die Datei verrät sogar, für welchen Stickrahmen sie gemacht ist. Ein Klick auf den Vorschlag, und der Rahmen liegt um das Motiv.',
      text: 'Die Datei verrät sogar, für welchen Stickrahmen sie gemacht ist. Ein Klick auf den Vorschlag, und der Rahmen liegt um das Motiv.',
      textEn: 'The file even tells you which hoop it was made for. One click on the suggestion, and the hoop sits around the design.',
      run: async (s) => {
        const pick = s.page.getByText('100 × 100 mm wählen');
        await s.zoom(pick, 1.6);
        await s.label('Stickrahmen', s.page.getByText('Stickrahmen', { exact: true }), 'right');
        await s.move(pick, 1.0);
        await s.wait(2.4);
        await s.click(pick, { move: 0.3, before: 0.3 });
        s.unlabel();
        s.zoomOut();
        await s.move([950, 600], 1.0);
        await s.wait(1.0);
      },
    },
    {
      say: 'Der Bildschirm hat drei Spalten. Links steht alles zur Datei: Stickrahmen, Speichern und wie die Stiche aussehen. In der Mitte liegt dein Stickmuster auf der Leinwand. Rechts stehen die Farben in der Reihenfolge, in der sie gestickt werden, und darunter die Sprünge.',
      text: 'Der Bildschirm hat drei Spalten. Links steht alles zur Datei: Stickrahmen, Speichern und wie die Stiche aussehen. In der Mitte liegt dein Stickmuster auf der Leinwand. Rechts stehen die Farben in der Reihenfolge, in der sie gestickt werden, und darunter die Sprünge.',
      textEn: 'The screen has three columns. On the left is everything about the file: hoop, saving and how the stitches look. In the middle your design lies on the canvas. On the right are the colours in the order they are stitched, and below them the jumps.',
      run: async (s) => {
        await s.wait(0.8);
        await s.move([150, 420], 1.0);
        await s.label('Datei', [12, 60, 276, 440], 'right');
        await s.wait(1.0);
        await s.move([150, 345], 0.6);
        await s.wait(0.6);
        await s.move([150, 444], 0.6);
        await s.wait(0.6);
        await s.move([150, 790], 0.8);
        await s.wait(1.4);
        s.unlabel();
        await s.move([950, 560], 1.0);
        await s.label('Leinwand', [700, 320, 500, 490], 'below');
        await s.wait(2.6);
        s.unlabel();
        await s.move([1760, 300], 1.0);
        await s.label('Farben', [1614, 68, 294, 450], 'left');
        await s.wait(3.6);
        await s.move([1760, 780], 0.8);
        await s.label('Sprünge', [1614, 540, 294, 520], 'left');
        await s.wait(2.4);
        s.unlabel();
      },
    },
    {
      say: 'Mit dem Mausrad zoomst du hinein. [focused] Zeigst du auf einen Stich, steht daneben, der wievielte es ist, welche Stichart und wie lang. Ziehen verschiebt das Bild, „Einpassen“ zeigt wieder alles.',
      text: 'Mit dem Mausrad zoomst du hinein. Zeigst du auf einen Stich, steht daneben, der wievielte es ist, welche Stichart und wie lang. Ziehen verschiebt das Bild, „Einpassen“ zeigt wieder alles.',
      textEn: 'Zoom in with the mouse wheel. Point at a stitch and it says which number it is, what stitch type and how long. Dragging moves the picture, “Fit” shows everything again.',
      run: async (s) => {
        await s.move([930, 470], 0.9);
        await s.label('Mausrad', [930, 470, 0, 0], 'below');
        for (let i = 0; i < 6; i++) {
          await s.page.mouse.wheel(0, -100);
          await s.wait(0.18);
        }
        s.unlabel();
        await s.wait(0.6);
        await s.move([900, 480], 0.8);
        await s.wait(4.2);
        await s.drag([[1460, 200], [1300, 300]], { sec: 1.0 });
        await s.wait(0.6);
        await s.label('Einpassen', '#fit', 'below');
        await s.click('#fit', { move: 1.0 });
        await blur(s);
        await s.wait(0.6);
        s.unlabel();
      },
    },
    {
      say: '[enthusiastic] Und jetzt das Schönste: Mit der Leertaste stickt die Maschine vor deinen Augen, Farbe für Farbe. Erst Creme, dann Orange, Gold und das rote Strickzeug.',
      text: 'Und jetzt das Schönste: Mit der Leertaste stickt die Maschine vor deinen Augen, Farbe für Farbe. Erst Creme, dann Orange, Gold und das rote Strickzeug.',
      textEn: 'And now the best part: with the space bar the machine stitches before your eyes, colour by colour. First cream, then orange, gold and the red knitting.',
      run: async (s) => {
        await s.click(away, { move: 0.8 });
        await blur(s);
        await s.press(' ', { label: 'Leertaste', show: 1.0 });
        await s.move([1250, 820], 2.0);
      },
    },
    {
      say: 'Unten steht, beim wievielten Stich du bist und wie lange die Maschine bis hierher braucht. Den Regler ziehst du einfach hin und her. Die Knöpfe außen springen von Farbe zu Farbe.',
      text: 'Unten steht, beim wievielten Stich du bist und wie lange die Maschine bis hierher braucht. Den Regler ziehst du einfach hin und her. Die Knöpfe außen springen von Farbe zu Farbe.',
      textEn: 'At the bottom you see which stitch you are at and how long the machine takes to get here. Just drag the slider back and forth. The buttons on the outside jump from colour to colour.',
      run: async (s) => {
        await s.press(' ', { label: 'Leertaste', show: 0.6 });
        const status = s.page.locator('text=/Stich [0-9.]+ \\//');
        await s.zoom([950, 1050, 0, 0], 1.6);
        await s.move(status, 1.0);
        await s.label('Stich und Zeit', status, 'above');
        await s.wait(2.6);
        s.unlabel();
        const knob = Number(await s.page.locator('#player-pos').inputValue()) / Number(await s.page.locator('#player-pos').getAttribute('max'));
        await s.label('Regler', '#player-pos', 'above');
        await slideTo(s, knob, 0.1, 1.2);
        await slideTo(s, 0.1, 0.3, 1.2);
        s.unlabel();
        await blur(s);
        await s.wait(0.4);
        const next = '[data-play=block-next]';
        await s.label('nächste Farbe', next, 'above');
        await s.click(next, { move: 0.9 });
        await s.wait(0.5);
        await s.click(next, { move: 0.1 });
        await blur(s);
        await s.wait(0.8);
        s.unlabel();
        s.zoomOut();
      },
    },
    {
      say: 'Zeigst du rechts auf eine Farbe, tritt der Rest zurück, [delighted] und du siehst genau, was in Dunkelbraun gestickt wird. Mit dem Auge blendest du eine Farbe aus, mit „Alle zeigen“ ist sie wieder da.',
      text: 'Zeigst du rechts auf eine Farbe, tritt der Rest zurück, und du siehst genau, was in Dunkelbraun gestickt wird. Mit dem Auge blendest du eine Farbe aus, mit „Alle zeigen“ ist sie wieder da.',
      textEn: 'Point at a colour on the right and the rest steps back, so you see exactly what is stitched in dark brown. The eye hides a colour, and “Show all” brings it back.',
      run: async (s) => {
        // The whole design first, so every colour is there to point at.
        const b = await s.box('#player-pos');
        await s.click([b.x + b.width - 4, b.y + b.height / 2], { move: 0.7, before: 0.1, after: 0.3 });
        await blur(s);
        const row = s.page.getByText('6. Dunkelbraun');
        await s.move(row, 1.0);
        await s.label('zeigen', row, 'left');
        await s.wait(3.4);
        s.unlabel();
        const eye = s.page.locator('button.eye').nth(5);
        await s.label('Auge', eye, 'left');
        await s.click(eye, { move: 0.6 });
        await s.move([1250, 560], 0.7);
        s.unlabel();
        await s.wait(2.4);
        await s.click(s.page.getByText('Alle zeigen'), { move: 1.0 });
        await s.move([1250, 560], 0.8);
        await s.wait(0.6);
      },
    },
    {
      say: '[proud, warm] Mit Realistischen Fäden siehst du schon vorher, wie die Katze auf dem Stoff wirkt. So kennst du deine Datei, bevor du etwas an ihr änderst.',
      text: 'Mit Realistischen Fäden siehst du schon vorher, wie die Katze auf dem Stoff wirkt. So kennst du deine Datei, bevor du etwas an ihr änderst.',
      textEn: 'With realistic threads you see beforehand how the cat looks on the fabric. That way you know your file before you change anything in it.',
      run: async (s) => {
        await s.click(s.page.locator('label.check', { hasText: 'Realistische Fäden' }), { move: 1.2 });
        await blur(s);
        await s.move([1250, 860], 0.9);
        await s.press('h', { label: 'H', show: 0.8 });
        await s.zoom([950, 560, 0, 0], 1.35);
        await s.wait(4.0);
        s.zoomOut();
      },
    },
  ],
};

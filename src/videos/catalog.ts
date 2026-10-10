/**
 * The tutorial videos, in one place: the guide's cards, the links beside its sections, the video
 * page and the player's "next part" all come from here (src/build/videoHtml.ts writes the HTML).
 * A finished video goes in the guide: add it here, with its card picture (see
 * docs/screencasts/konzept.md, "Hilfeseite").
 *
 * Video, poster, subtitles and files to follow along lie flat in the R2 bucket under the video's
 * key: `<key>.mp4`, `<key>.jpg`, `<key>.de.vtt`, `<key>-<file>`. The card picture, the stage of
 * the poster cut to 4:3 (tools/screencast/karte.py), lies with the site: `guide/videos/<key>.webp`.
 */

export type Lang = 'de' | 'en';
type Text = Record<Lang, string>;

export const VIDEO_BASE = 'https://media.heatstitch.app/videos/';

export type GroupId = 'start' | 'design' | 'file' | 'detail';

export interface Group {
  id: GroupId;
  title: Text;
  /** One line under the heading on the video page: what the group is for. */
  lead: Text;
}

export interface Video {
  key: string;
  part: number;
  title: Text;
  /** m:ss, as the player shows it. */
  length: string;
  group: GroupId;
  /** What you can do afterwards, one sentence for the video page. */
  goal: Text;
  /** Files the video works with, to follow along (on R2 as `<key>-<file>`). */
  files: string[];
}

export const GROUPS: Group[] = [
  {
    id: 'start',
    title: { de: 'Zum Einstieg', en: 'Getting started' },
    lead: { de: 'Wo was liegt, in drei Minuten. Die anderen Videos setzen es nicht voraus.', en: 'Where everything is, in three minutes. The other videos do not depend on it.' },
  },
  {
    id: 'design',
    title: { de: 'Selbst gestalten', en: 'Make your own' },
    lead: { de: 'Vom leeren Stickrahmen, aus Schrift oder aus einem Bild zum eigenen Stickmuster.', en: 'From an empty hoop, from lettering or from a picture to a design of your own.' },
  },
  {
    id: 'file',
    title: { de: 'Stickdatei ansehen und verbessern', en: 'View and improve an embroidery file' },
    lead: { de: 'Eine fertige Datei öffnen, prüfen, beheben und für die Maschine speichern.', en: 'Open a finished file, check it, fix it and save it for your machine.' },
  },
  {
    id: 'detail',
    title: { de: 'Feinschliff', en: 'Fine-tuning' },
    lead: { de: 'Füllungen, Satin, Linien, Formen und einzelne Stiche, genau so, wie du sie willst.', en: 'Fills, satin, lines, shapes and single stitches, exactly the way you want them.' },
  },
];

export const VIDEOS: Video[] = [
  {
    key: '00-oberflaeche',
    part: 0,
    title: { de: 'Die heatstitch Oberfläche', en: 'The heatstitch interface' },
    length: '2:58',
    group: 'start',
    goal: { de: 'Du weißt, wo was liegt: Kopfleiste, Werkzeuge, Farben und Objekte, Bühne, Karten und Player.', en: 'You know where everything is: header, tools, colors and objects, stage, cards and player.' },
    files: ['cat-60mm.pes'],
  },
  {
    key: '01-neues-stickmuster',
    part: 1,
    title: { de: 'Ein neues Stickmuster', en: 'A new embroidery design' },
    length: '2:27',
    group: 'design',
    goal: { de: 'Du stickst dein erstes eigenes Muster, einen runden Aufnäher mit einer Welle, vom leeren Stickrahmen bis zur PES-Datei.', en: 'You make your first design of your own, a round patch with a wave, from the empty hoop to the PES file.' },
    files: [],
  },
  {
    key: '02-schrift',
    part: 2,
    title: { de: 'Schrift', en: 'Lettering' },
    length: '2:30',
    group: 'design',
    goal: { de: 'Du setzt einen Namen in Stickschrift, im Bogen und in deiner Garnfarbe, und änderst ihn später jederzeit.', en: 'You set a name in an embroidery font, on an arc and in your thread color, and change it any time later.' },
    files: [],
  },
  {
    key: '03-vom-bild-zum-stickmuster',
    part: 3,
    title: { de: 'Vom Bild zum Stickmuster', en: 'From a picture to a design' },
    length: '2:43',
    group: 'design',
    goal: { de: 'Du machst aus einem Foto oder einer Grafik ein Stickmuster: Farben wählen, Flächen aufräumen, Stil festlegen.', en: 'You turn a photo or a graphic into a design: pick the colors, tidy the areas, choose a style.' },
    files: ['fliegenpilz.jpg'],
  },
  {
    key: '05-objekte-und-reihenfolge',
    part: 5,
    title: { de: 'Objekte und Reihenfolge', en: 'Objects and sequence' },
    length: '2:31',
    group: 'design',
    goal: { de: 'Du bringst Objekte in die richtige Reihenfolge, sparst Überlappungen aus und duplizierst und spiegelst sie.', en: 'You put objects in the right order, knock out overlaps, and duplicate and mirror them.' },
    files: ['kirschen.svg'],
  },
  {
    key: '06-fertige-stickdatei-oeffnen',
    part: 6,
    title: { de: 'Fertige Stickdatei öffnen', en: 'Opening a finished embroidery file' },
    length: '2:38',
    group: 'file',
    goal: { de: 'Du öffnest eine fertige Stickdatei, wählst den Stickrahmen und siehst zu, wie die Maschine sie stickt.', en: 'You open a finished embroidery file, choose the hoop and watch how the machine sews it.' },
    files: ['katze.pes'],
  },
  {
    key: '07-stickdatei-pruefen',
    part: 7,
    title: { de: 'Stickdatei prüfen', en: 'Checking an embroidery file' },
    length: '2:27',
    group: 'file',
    goal: { de: 'Du siehst vor dem ersten Stich, ob eine Datei auf deinem Stoff gut wird und wo nicht.', en: 'Before the first stitch, you see whether a file works on your fabric and where it does not.' },
    files: ['patch.pes'],
  },
  {
    key: '08-beheben-und-vergleichen',
    part: 8,
    title: { de: 'Beheben und vergleichen', en: 'Fixing and comparing' },
    length: '2:19',
    group: 'file',
    goal: { de: 'Du lässt zu dichte Stellen beheben, vergleichst mit dem Original und nimmst die Korrektur bei Bedarf zurück.', en: 'You let spots that are too dense be fixed, compare with the original and undo the correction if you like.' },
    files: ['patch.pes'],
  },
  {
    key: '09-spruenge-und-schnitte',
    part: 9,
    title: { de: 'Sprünge und Schnitte', en: 'Jumps and trims' },
    length: '2:07',
    group: 'file',
    goal: { de: 'Du sorgst dafür, dass lange Sprünge geschnitten werden, und kürzt die Wege mit einer besseren Reihenfolge.', en: 'You make sure long jumps are trimmed and shorten the travel with a better order.' },
    files: ['konfetti.pes'],
  },
  {
    key: '10-vorschau-und-speichern',
    part: 10,
    title: { de: 'Vorschau und Speichern', en: 'Preview and saving' },
    length: '2:40',
    group: 'file',
    goal: { de: 'Du siehst dein Stickmuster wie echt auf dem Stoff, legst Vlies und Nadel bereit und speicherst für deine Maschine.', en: 'You see your design as if real on the fabric, get stabilizer and needle ready and save for your machine.' },
    files: ['aufnaeher-67.dst'],
  },
  {
    key: '11-fuellungen',
    part: 11,
    title: { de: 'Füllungen', en: 'Fills' },
    length: '3:05',
    group: 'detail',
    goal: { de: 'Du stellst Muster, Umrandung und Halt einer Füllung ein, zerteilst sie und lenkst ihre Reihen mit Leitlinien.', en: 'You set the pattern, border and hold of a fill, split it and steer its rows with guide lines.' },
    files: ['shapes-benchmark.svg'],
  },
  {
    key: '12-satin-und-linien',
    part: 12,
    title: { de: 'Satin und Linien', en: 'Satin and lines' },
    length: '2:58',
    group: 'detail',
    goal: { de: 'Du machst aus einer Füllung glänzenden Satin und gibst Linien Fransen, Wiederholung, Echo und Schatten.', en: 'You turn a fill into shiny satin and give lines fringe, repeats, echo and shadow.' },
    files: ['abzeichen.svg'],
  },
  {
    key: '13-form-und-einzelne-stiche',
    part: 13,
    title: { de: 'Form und einzelne Stiche', en: 'Shape and single stitches' },
    length: '2:38',
    group: 'detail',
    goal: { de: 'Du änderst die Form eines Objekts an seinen Knoten und setzt, verschiebst und dünnst einzelne Stiche aus.', en: "You change an object's shape at its nodes and add, move and thin out single stitches." },
    files: ['cat-60mm.pes'],
  },
];

/** The card picture, relative to the site's base. */
export const cardPath = (key: string): string => `guide/videos/${key}.webp`;

export const videoByKey = (key: string): Video | undefined => VIDEOS.find((v) => v.key === key);

/** Seconds of an m:ss length. */
export const seconds = (length: string): number => {
  const [m, s] = length.split(':').map(Number);
  return m * 60 + s;
};

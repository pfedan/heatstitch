/** Texts of the narrow layouts (tablet and phone) of the new interface. English mirrors German. */
export const de = {
  'responsive.group': 'Fenster',
  'responsive.objects': 'Farben und Objekte',
  'responsive.objects.toggle': 'Farben und Objekte ein/aus',
  'responsive.inspector': 'Eigenschaften',
  'responsive.inspector.toggle': 'Eigenschaften ein/aus',
  'responsive.inspector.check': 'Befunde',
  'responsive.close': 'Schließen',
  'responsive.sheet': 'Ziehen oder tippen: größer oder kleiner',
  'responsive.tools': 'Werkzeuge',
  'responsive.more': 'Weitere Optionen',
} as const;

export const en: Record<keyof typeof de, string> = {
  'responsive.group': 'Window',
  'responsive.objects': 'Colors and objects',
  'responsive.objects.toggle': 'Colors and objects on/off',
  'responsive.inspector': 'Properties',
  'responsive.inspector.toggle': 'Properties on/off',
  'responsive.inspector.check': 'Findings',
  'responsive.close': 'Close',
  'responsive.sheet': 'Drag or tap: larger or smaller',
  'responsive.tools': 'Tools',
  'responsive.more': 'More options',
};

/** Texts of the measuring tool and the scale bar on the stage. English mirrors German. */
export const de = {
  'measure.tool': 'Messen',
  'measure.tool.hint': 'Abstand zwischen zwei Punkten in mm messen',
  'measure.how': 'Ziehen oder zwei Punkte klicken · Umschalt: in 15°-Schritten · Alt: ohne Einrasten',
  'measure.how.touch': 'Ziehen oder zwei Punkte antippen',
  'measure.next': 'Zweiten Punkt klicken',
  'measure.next.touch': 'Zweiten Punkt antippen',
  'measure.result': 'Breite {dx} mm · Höhe {dy} mm · Winkel {a}°',
  'measure.result.short': '{dx} × {dy} mm · {a}°',
  'measure.clear': 'Messung löschen',
  'measure.scale.label': 'Maßstab: ein Abschnitt sind {v} mm',
  'measure.scale.show': 'Maßstab',
  'measure.scale.hint': 'Maßstab unten auf der Bühne zeigen',
  'measure.cmd.scale': 'Maßstab ein oder aus',
} as const;

export const en: Record<keyof typeof de, string> = {
  'measure.tool': 'Measure',
  'measure.tool.hint': 'Measure the distance between two points in mm',
  'measure.how': 'Drag or click two points · Shift: in 15° steps · Alt: no snapping',
  'measure.how.touch': 'Drag or tap two points',
  'measure.next': 'Click the second point',
  'measure.next.touch': 'Tap the second point',
  'measure.result': 'Width {dx} mm · Height {dy} mm · Angle {a}°',
  'measure.result.short': '{dx} × {dy} mm · {a}°',
  'measure.clear': 'Clear measurement',
  'measure.scale.label': 'Scale: one part is {v} mm',
  'measure.scale.show': 'Scale bar',
  'measure.scale.hint': 'Show a scale bar at the foot of the stage',
  'measure.cmd.scale': 'Scale bar on or off',
};

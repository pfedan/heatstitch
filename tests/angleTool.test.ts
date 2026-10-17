import { describe, expect, it } from 'vitest';
import { AngleTool, lineAngle } from '../src/ui/angleTool';

/** The tool over fills at `value` (NaN: automatic), with what it shows and takes over. */
function setup(value = NaN, turn: 180 | 360 = 180, has = true) {
  const log: { shown: number[]; taken: number[]; restored: number[] } = { shown: [], taken: [], restored: [] };
  let now = value;
  const tool = new AngleTool({
    current: () => (has ? { value: now, turn } : null),
    set: (a, final) => {
      now = a;
      (final ? log.taken : log.shown).push(a);
    },
    restore: (was) => {
      now = was;
      log.restored.push(was);
    },
    redraw: () => {},
  });
  return { tool, log, now: () => now };
}

describe('angle drawn on the area', () => {
  it('reads a line as the rows do: clockwise on screen, half a turn for rows, whole for a direction', () => {
    expect(lineAngle([0, 0], [10, 0], 180)).toBe(0);
    expect(lineAngle([0, 0], [10, 10], 180)).toBe(45);
    expect(lineAngle([0, 0], [0, 10], 180)).toBe(90);
    expect(lineAngle([0, 0], [-10, 10], 180)).toBe(135);
    // Drawn the other way round it is the same rows.
    expect(lineAngle([10, 10], [0, 0], 180)).toBe(45);
    expect(lineAngle([10, 0], [0, 0], 180)).toBe(0);
    // A direction (figures of a motif fill) keeps which way it points.
    expect(lineAngle([10, 10], [0, 0], 360)).toBe(225);
    expect(lineAngle([0, 0], [10, -10], 360)).toBe(315);
  });

  it('shows the rows while dragging and takes them over once, when let go, which ends the tool', () => {
    const { tool, log, now } = setup(30);
    expect(tool.start()).toBe(true);
    tool.down(0, 0, 10);
    tool.dragTo(10, 0);
    tool.dragTo(10, 10);
    tool.dragTo(10, 10.01);
    expect(log.shown).toEqual([0, 45]);
    expect(log.taken).toEqual([]);
    tool.up();
    expect(log.taken).toEqual([45]);
    expect(now()).toBe(45);
    expect(tool.active).toBe(false);
  });

  it('holds the line to steps of 15 degrees with Shift', () => {
    const { tool, log } = setup();
    tool.start();
    tool.down(0, 0, 10);
    tool.dragTo(10, 3.5, true);
    tool.up();
    expect(log.taken).toEqual([15]);
  });

  it('puts the angle back on Esc during the drag (also automatic) and stays on for another line', () => {
    const { tool, log, now } = setup(NaN);
    tool.start();
    tool.down(0, 0, 10);
    tool.dragTo(0, 10);
    expect(now()).toBe(90);
    tool.cancel();
    expect(log.restored).toEqual([NaN]);
    expect(Number.isNaN(now())).toBe(true);
    expect(log.taken).toEqual([]);
    expect(tool.active).toBe(true);
    // Let go after Esc: nothing is taken over.
    tool.up();
    expect(log.taken).toEqual([]);
  });

  it('takes nothing over for a click: a line needs a length to point', () => {
    const { tool, log } = setup(30);
    tool.start();
    tool.down(0, 0, 10);
    tool.dragTo(0.2, 0.1);
    tool.up();
    expect(log.shown).toEqual([]);
    expect(log.taken).toEqual([]);
    expect(tool.active).toBe(true);
  });

  it('does not start without fills that have an angle', () => {
    const { tool } = setup(30, 180, false);
    expect(tool.start()).toBe(false);
    expect(tool.active).toBe(false);
  });
});

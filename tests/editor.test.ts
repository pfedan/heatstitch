import { describe, expect, it } from 'vitest';
import { STITCH, type Pattern } from '../src/model/pattern';
import { Editor } from '../src/ui/editor';
import { Shape } from './helpers/shapes';

/** An editor on a mutable "file" that records commits like the file list's undo stack. */
function setup(p: Pattern) {
  const state = { pattern: p, commits: [] as Pattern[] };
  const editor = new Editor({
    pattern: () => state.pattern,
    commit: (q) => {
      state.commits.push(state.pattern);
      state.pattern = q;
    },
    redraw: () => {},
    changed: () => {},
  });
  editor.setActive(true);
  return { state, editor };
}

const SCALE = 20; // px per mm, zoomed in far enough to pick penetrations

describe('stitch editor', () => {
  it('picks, drags and commits one undo step', () => {
    const { state, editor } = setup(new Shape().to(0, 0).to(5, 0).to(10, 0).build());
    expect(editor.down(5.1, 0.1, 0, 0, false, SCALE)).toBe('move');
    expect([...editor.selection]).toEqual([1]);
    editor.dragTo(5.6, 1.1, 10, 20);
    expect(editor.preview?.x[1]).toBe(55);
    editor.up();
    expect(state.commits).toHaveLength(1);
    expect([state.pattern.x[1], state.pattern.y[1]]).toEqual([55, 10]);
  });

  it('does not pick when zoomed out, but pans', () => {
    const { editor } = setup(new Shape().to(0, 0).to(5, 0).build());
    expect(editor.down(5, 0, 0, 0, false, 1)).toBe('pan');
  });

  it('selects a rectangle, nudges and deletes', () => {
    const { state, editor } = setup(new Shape().to(0, 0).to(1, 0).to(2, 0).to(3, 0).to(4, 0).build());
    expect(editor.down(0.5, -1, 0, 0, true, SCALE)).toBe('band');
    editor.dragTo(2.5, 1, 40, 40);
    editor.up();
    expect([...editor.selection].sort()).toEqual([1, 2]);
    editor.nudge(0, 3);
    expect(Array.from(state.pattern.y)).toEqual([0, 3, 3, 0, 0]);
    editor.deleteSelection();
    expect(state.pattern.cmd.filter((c) => c === STITCH)).toHaveLength(3);
    expect(state.commits).toHaveLength(2);
    expect(editor.selection.size).toBe(0);
  });

  it('thins the selected part of a satin', () => {
    const { state, editor } = setup(new Shape().satin(0, 0, 20, 4, 0.4).build());
    editor.selectAll();
    expect(editor.thinSelection(0.5)).toBeGreaterThan(20);
    expect(state.commits).toHaveLength(1);
  });

  it('clears the selection on a click into empty space', () => {
    const { editor } = setup(new Shape().to(0, 0).to(5, 0).build());
    editor.down(5, 0, 0, 0, false, SCALE);
    editor.up();
    expect(editor.selection.size).toBe(1);
    editor.down(50, 50, 0, 0, false, SCALE);
    editor.up();
    expect(editor.selection.size).toBe(0);
  });
});

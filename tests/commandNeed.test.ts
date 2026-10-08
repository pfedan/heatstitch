import { describe, expect, it } from 'vitest';
import type { Key } from '../src/i18n';
import { registerObjectCommands, type ObjectActions } from '../src/areas/objects/commands';
import { canRun, getCommand, needOf } from '../src/shell/commands';
import type { ObjectInfo } from '../src/ui/objectPanel';

/**
 * A command that can't run now says in the command search what to do first ("Spiegeln: Erst ein
 * Objekt wählen") instead of the search finding nothing. The object commands against a stand-in app.
 */
interface State {
  blocked?: Key;
  selected: number[];
  lettering?: boolean;
  info?: Partial<ObjectInfo>;
}

function setUp(s: State): void {
  const stub = new Proxy({} as ObjectActions, { get: () => () => undefined });
  registerObjectCommands({
    ...stub,
    flow: () => !s.blocked,
    blocked: () => s.blocked,
    count: () => 5,
    frame: () => (s.blocked ? [] : s.selected),
    info: () => (s.selected.length && !s.lettering ? ({ selected: s.selected, objects: [], shaping: null, editing: null, mergeBlocked: null, ...s.info } as unknown as ObjectInfo) : null),
    lettering: () => !!s.lettering,
    drawing: () => false,
    typing: () => false,
    canPaste: () => false,
    knockoutState: () => null,
    colorTarget: () => null,
  });
}

const need = (id: string) => {
  const c = getCommand(id)!;
  return canRun(c) ? 'runs' : needOf(c);
};

describe('what a command needs first', () => {
  it('asks for a design, then for an object, before mirroring', () => {
    setUp({ blocked: 'shell.need.design', selected: [] });
    expect(need('object.mirrorH')).toBe('shell.need.design');
    setUp({ selected: [] });
    expect(need('object.mirrorH')).toBe('objects.need.select');
    expect(need('object.mirrorV')).toBe('objects.need.select');
    setUp({ selected: [2] });
    expect(need('object.mirrorH')).toBe('runs');
  });

  it('asks for two objects to combine, with none or one selected', () => {
    setUp({ selected: [] });
    expect(need('object.combine')).toBe('objects.need.two');
    setUp({ selected: [1] });
    expect(need('object.combine')).toBe('objects.need.two');
    setUp({ selected: [1, 2], info: { mergeBlocked: 'objects.need.fill' } });
    expect(need('object.combine')).toBe('objects.need.fill');
  });

  it('names the lettering, the copy and the color as what is missing', () => {
    setUp({ selected: [1], lettering: true });
    expect(need('object.duplicate')).toBe('objects.need.lettering');
    setUp({ selected: [] });
    expect(need('object.paste')).toBe('objects.need.copy');
    expect(need('color.hide')).toBe('objects.need.color');
    expect(need('object.knockout')).toBe('objects.need.select');
    setUp({ selected: [1] });
    expect(need('object.knockout')).toBe('objects.need.fill');
  });
});

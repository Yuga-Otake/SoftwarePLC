import { describe, expect, it } from 'vitest';
import { Equipment, LineIR, emptyLine } from './schema';

describe('IR schema', () => {
  it('emptyLine parses as LineIR', () => {
    expect(LineIR.safeParse(emptyLine()).success).toBe(true);
  });

  it('parses a hand-written conveyor', () => {
    const conveyor = {
      kind: 'conveyor',
      id: 'conv1',
      name: 'コンベヤ1',
      semantics: { status: 'confirmed', source: 'library' },
      visual: { type: 'builtin' },
      io: [],
      axes: [],
      ports: [],
      transform: { position: [0, 0, 0], rotationYDeg: 0, scale: 1 },
      params: { lengthM: 2, widthM: 0.4, heightM: 0.8, speedMps: 0.3 },
    };
    const r = Equipment.safeParse(conveyor);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});

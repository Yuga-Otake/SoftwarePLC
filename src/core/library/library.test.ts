import { describe, expect, it } from 'vitest';
import { Equipment } from '../ir/schema';
import { DEFAULTS, getLibraryItem, library } from './index';

describe('library', () => {
  it('has all six items and every build parses', () => {
    expect(library.map((l) => l.id).sort()).toEqual(
      ['conveyor', 'generic', 'inspection_cell', 'sensor', 'source', 'stopper'].sort(),
    );
    for (const item of library) {
      const eqs = item.build({ idPrefix: 'X1' });
      for (const e of eqs) {
        expect(Equipment.safeParse(e).success, `${item.id}/${e.id}`).toBe(true);
        expect(e.semantics).toEqual({ status: 'confirmed', source: 'library' });
      }
    }
  });

  it('conveyor defaults, io, axis and ports', () => {
    const [c] = getLibraryItem('conveyor').build({ idPrefix: 'CV1' });
    expect(c.kind === 'conveyor' && c.params).toEqual(DEFAULTS.conveyor);
    expect(c.io).toEqual([expect.objectContaining({ tag: 'CV1_Run', dir: 'DO', role: 'motor_run', id: 'motor_run' })]);
    expect(c.ports.find((p) => p.id === 'out')!.localPosition).toEqual([2, 0.8, 0]);
    expect(c.ports.find((p) => p.id === 'in')!.localPosition).toEqual([0, 0.8, 0]);
    expect(c.axes[0]).toMatchObject({ type: 'belt', direction: [1, 0, 0], drivenByIo: 'motor_run' });
  });

  it('inspection cell builds 3 linked items', () => {
    const [st, stp, ps] = getLibraryItem('inspection_cell').build({ idPrefix: 'ST1', params: { actuationTimeS: 0.5, ngRate: 0.2 } });
    expect([st.id, stp.id, ps.id]).toEqual(['ST1', 'ST1_STP', 'ST1_PS']);
    expect(st.kind === 'inspection_station' && st.params).toEqual({ inspectTimeS: 2, ngRate: 0.2, stopperId: 'ST1_STP', sensorId: 'ST1_PS' });
    expect(stp.kind === 'stopper' && stp.params.actuationTimeS).toBe(0.5);
    expect(st.io.map((i) => i.tag)).toEqual(['ST1_Start', 'ST1_Done', 'ST1_OK']);
    expect(stp.axes[0]).toMatchObject({ type: 'linear', direction: [0, 1, 0], strokeM: 0.05, drivenByIo: 'release' });
    expect(ps.io[0]).toMatchObject({ tag: 'ST1_PS_Detect', role: 'detect' });
  });
});

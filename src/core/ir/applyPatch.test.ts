import { describe, expect, it } from 'vitest';
import { buildStandardLine } from '../demo/standardLine';
import { conveyorDirection, conveyorPointToWorld, mountWorldPosition } from './geometry';
import { LineIR, emptyLine } from './schema';
import type { Conveyor, PatchOp } from './schema';
import { applyPatch, validate } from './index';

const ok = (ir: LineIR, ops: PatchOp[]) => {
  const r = applyPatch(ir, ops);
  expect(r.errors).toEqual([]);
  expect(LineIR.safeParse(r.ir).success).toBe(true);
  return r;
};
const get = (ir: LineIR, id: string) => ir.equipment.find((e) => e.id === id)!;
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('standard line', () => {
  const ir = buildStandardLine();
  it('builds without validation errors', () => {
    expect(validate(ir).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validate(ir)).toEqual([]);
    expect(ir.equipment.map((e) => e.id)).toEqual(['CV1', 'SRC1', 'ST1', 'ST1_STP', 'ST1_PS']);
    expect(ir.connections).toHaveLength(1);
  });
  it('has unique tags and addresses', () => {
    const io = ir.equipment.flatMap((e) => e.io);
    expect(new Set(io.map((i) => i.tag)).size).toBe(io.length);
    expect(io.every((i) => i.address)).toBe(true);
    expect(new Set(io.map((i) => i.address)).size).toBe(io.length);
    expect(io.find((i) => i.tag === 'CV1_Run')!.address).toBe('%QX0.0');
    expect(io.find((i) => i.tag === 'ST1_PS_Detect')!.address).toBe('%IX0.2');
  });
  it('places mounts and source', () => {
    expect((get(ir, 'ST1') as never as { mount: unknown }).mount).toEqual({ conveyorId: 'CV1', offsetM: 1 });
    expect((get(ir, 'ST1_PS') as never as { mount: { offsetM: number } }).mount.offsetM).toBeCloseTo(0.95);
    close((get(ir, 'SRC1') as never as { transform: { position: number[] } }).transform.position, [0, 0.8, 0]);
  });
});

describe('add', () => {
  it('auto ids, defaults and changes', () => {
    const r = ok(emptyLine(), [{ op: 'add', item: 'conveyor' }, { op: 'add', item: 'conveyor' }, { op: 'add', item: 'generic' }]);
    expect(r.ir.equipment.map((e) => e.id)).toEqual(['CV1', 'CV2', 'OBJ1']);
    expect(r.changes.map((c) => c.type)).toEqual(['added', 'added', 'added']);
  });
  it('merges params and rejects duplicates / unknown keys / bad values', () => {
    const r = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'A', params: { speedMps: 0.5 } }]);
    expect((get(r.ir, 'A') as Conveyor).params).toEqual({ lengthM: 2, widthM: 0.4, heightM: 0.8, speedMps: 0.5 });
    expect(applyPatch(r.ir, [{ op: 'add', item: 'conveyor', id: 'A' }]).errors).toHaveLength(1);
    expect(applyPatch(r.ir, [{ op: 'add', item: 'conveyor', params: { foo: 1 } }]).errors).toHaveLength(1);
    expect(applyPatch(r.ir, [{ op: 'add', item: 'conveyor', params: { speedMps: -1 } }]).errors).toHaveLength(1);
  });
  it('mounted kinds require valid mount', () => {
    const base = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'CV1' }]).ir;
    expect(applyPatch(base, [{ op: 'add', item: 'sensor' }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'add', item: 'sensor', mount: { conveyorId: 'NOPE', offsetM: 1 } }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'add', item: 'stopper', mount: { conveyorId: 'CV1', offsetM: 2.5 } }]).errors).toHaveLength(1);
    const r = ok(base, [{ op: 'add', item: 'sensor', mount: { conveyorId: 'CV1', offsetM: 2 } }]);
    expect(r.ir.equipment.map((e) => e.id)).toEqual(['CV1', 'S1']);
  });
  it('inspection cell: positions, params routing, auto id', () => {
    const base = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'CV1' }]).ir;
    const r = ok(base, [
      { op: 'add', item: 'inspection_cell', mount: { conveyorId: 'CV1', offsetM: 1 }, params: { inspectTimeS: 3, actuationTimeS: 0.1 } },
    ]);
    const st = get(r.ir, 'ST1') as never as { params: Record<string, unknown> };
    expect(st.params).toMatchObject({ inspectTimeS: 3, stopperId: 'ST1_STP', sensorId: 'ST1_PS' });
    expect((get(r.ir, 'ST1_STP') as never as { params: { actuationTimeS: number } }).params.actuationTimeS).toBe(0.1);
    expect(r.changes).toHaveLength(3);
    expect(r.changes[0].summary).toBe('ST1 検査ステーションを追加 (CV1 の 1.0 m 地点)');
    const near0 = ok(base, [{ op: 'add', item: 'inspection_cell', mount: { conveyorId: 'CV1', offsetM: 0.02 } }]);
    expect((get(near0.ir, 'ST1_PS') as never as { mount: { offsetM: number } }).mount.offsetM).toBe(0);
  });
  it('after: chains conveyors and connects (rotation 0)', () => {
    const r = ok(emptyLine(), [
      { op: 'add', item: 'conveyor', id: 'CV1' },
      { op: 'add', item: 'conveyor', id: 'CV2', after: 'CV1' },
    ]);
    const c2 = get(r.ir, 'CV2') as Conveyor;
    close(c2.transform.position, [2, 0, 0]);
    expect(r.ir.connections).toEqual([{ id: 'C1', from: { equipmentId: 'CV1', portId: 'out' }, to: { equipmentId: 'CV2', portId: 'in' } }]);
  });
  it('after: rotated 90 degrees goes toward -Z (three.js rotation.y)', () => {
    const r = ok(emptyLine(), [
      { op: 'add', item: 'conveyor', id: 'CV1', transform: { position: [1, 0, 1], rotationYDeg: 90 } },
      { op: 'add', item: 'conveyor', id: 'CV2', after: 'CV1', params: { lengthM: 1 } },
      { op: 'add', item: 'conveyor', id: 'CV3', after: 'CV2' },
    ]);
    const c1 = get(r.ir, 'CV1') as Conveyor;
    close(conveyorDirection(c1), [0, 0, -1]);
    const c2 = get(r.ir, 'CV2') as Conveyor;
    close(c2.transform.position, [1, 0, -1]);
    expect(c2.transform.rotationYDeg).toBe(90);
    close((get(r.ir, 'CV3') as Conveyor).transform.position, [1, 0, -2]);
  });
  it('after errors: non-conveyor, unknown, occupied out', () => {
    const base = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'CV1' }, { op: 'add', item: 'conveyor', id: 'CV2', after: 'CV1' }]).ir;
    expect(applyPatch(base, [{ op: 'add', item: 'conveyor', after: 'CV1' }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'add', item: 'conveyor', after: 'X' }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'add', item: 'source', after: 'CV2' }]).errors).toHaveLength(1);
  });
});

describe('atomicity', () => {
  it('failing op leaves original ir, no changes', () => {
    const ir = buildStandardLine();
    const snapshot = JSON.stringify(ir);
    const r = applyPatch(ir, [
      { op: 'update', id: 'CV1', params: { speedMps: 0.5 } },
      { op: 'remove', id: 'NOPE' },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/NOPE/);
    expect(r.changes).toEqual([]);
    expect(r.ir).toBe(ir);
    expect(JSON.stringify(ir)).toBe(snapshot);
  });
  it('does not mutate input on success', () => {
    const ir = buildStandardLine();
    const snapshot = JSON.stringify(ir);
    ok(ir, [{ op: 'update', id: 'CV1', params: { speedMps: 0.5 } }, { op: 'remove', id: 'ST1' }]);
    expect(JSON.stringify(ir)).toBe(snapshot);
  });
});

describe('update', () => {
  it('speed change with summary and fields', () => {
    const r = ok(buildStandardLine(), [{ op: 'update', id: 'CV1', params: { speedMps: 0.3 } }]);
    expect(r.changes).toEqual([
      { type: 'updated', equipmentId: 'CV1', fields: [{ path: 'params.speedMps', before: 0.2, after: 0.3 }], summary: 'CV1 搬送速度 0.2 → 0.3 m/s' },
    ]);
  });
  it('rejects invalid params', () => {
    const ir = buildStandardLine();
    expect(applyPatch(ir, [{ op: 'update', id: 'CV1', params: { speedMps: 0 } }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'update', id: 'ST1', params: { ngRate: 2 } }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'update', id: 'ST1', params: { sensorId: 'NOPE' } }]).errors).toHaveLength(1);
  });
  it('length change updates out port and guards mounts', () => {
    const ir = buildStandardLine();
    const r = ok(ir, [{ op: 'update', id: 'CV1', params: { lengthM: 3 } }]);
    expect((get(r.ir, 'CV1') as Conveyor).ports.find((p) => p.id === 'out')!.localPosition).toEqual([3, 0.8, 0]);
    expect(applyPatch(ir, [{ op: 'update', id: 'CV1', params: { lengthM: 0.5 } }]).errors).toHaveLength(1);
  });
  it('moving the station moves stopper and sensor', () => {
    const r = ok(buildStandardLine(), [{ op: 'update', id: 'ST1', mount: { offsetM: 1.5 } }]);
    const off = (id: string) => (get(r.ir, id) as never as { mount: { offsetM: number } }).mount.offsetM;
    expect([off('ST1'), off('ST1_STP')]).toEqual([1.5, 1.5]);
    expect(off('ST1_PS')).toBeCloseTo(1.45);
    expect(r.changes.map((c) => c.equipmentId).sort()).toEqual(['ST1', 'ST1_PS', 'ST1_STP']);
    expect(applyPatch(buildStandardLine(), [{ op: 'update', id: 'ST1', mount: { offsetM: 5 } }]).errors).toHaveLength(1);
  });
  it('transform on mounted / mount on placed are errors; transform merges', () => {
    const ir = buildStandardLine();
    expect(applyPatch(ir, [{ op: 'update', id: 'ST1', transform: { scale: 2 } }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'update', id: 'CV1', mount: { offsetM: 1 } }]).errors).toHaveLength(1);
    const r = ok(ir, [{ op: 'update', id: 'CV1', transform: { rotationYDeg: 45 }, name: 'メイン' }]);
    expect((get(r.ir, 'CV1') as Conveyor).transform).toMatchObject({ rotationYDeg: 45, scale: 1 });
  });
});

describe('remove', () => {
  it('conveyor cascades to mounted devices and connections', () => {
    const r = ok(buildStandardLine(), [{ op: 'remove', id: 'CV1' }]);
    expect(r.ir.equipment.map((e) => e.id)).toEqual(['SRC1']);
    expect(r.ir.connections).toEqual([]);
    expect(r.changes.map((c) => c.equipmentId).sort()).toEqual(['CV1', 'ST1', 'ST1_PS', 'ST1_STP']);
  });
  it('station removes stopper and sensor; referenced stopper/sensor cannot be removed alone', () => {
    const ir = buildStandardLine();
    const r = ok(ir, [{ op: 'remove', id: 'ST1' }]);
    expect(r.ir.equipment.map((e) => e.id)).toEqual(['CV1', 'SRC1']);
    expect(applyPatch(ir, [{ op: 'remove', id: 'ST1_STP' }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'remove', id: 'ST1_PS' }]).errors).toHaveLength(1);
  });
  it('drops assumptions of removed equipment and frees addresses', () => {
    const r = ok(buildStandardLine(), [
      { op: 'assume', equipmentId: 'CV1', path: 'params.speedMps', rationale: 'x' },
      { op: 'remove', id: 'CV1' },
      { op: 'add', item: 'conveyor', id: 'CV9' },
    ]);
    expect(r.ir.assumptions).toEqual([]);
    expect(get(r.ir, 'CV9').io[0].address).toBe('%QX0.0');
  });
});

describe('connect / disconnect / rename', () => {
  const base = ok(emptyLine(), [
    { op: 'add', item: 'conveyor', id: 'CV1', transform: { position: [3, 0, 1], rotationYDeg: 90 } },
    { op: 'add', item: 'source', id: 'SRC1' },
    { op: 'add', item: 'source', id: 'SRC2' },
  ]).ir;
  const link = (s: string): PatchOp => ({ op: 'connect', from: { equipmentId: s, portId: 'out' }, to: { equipmentId: 'CV1', portId: 'in' } });
  it('connects and snaps source to infeed', () => {
    const r = ok(base, [link('SRC1')]);
    const s = get(r.ir, 'SRC1') as never as { transform: { position: number[]; rotationYDeg: number } };
    close(s.transform.position, [3, 0.8, 1]);
    expect(s.transform.rotationYDeg).toBe(90);
    expect(r.ir.connections[0].id).toBe('C1');
  });
  it('rejects second connection to same port, self, wrong roles, unknown port', () => {
    const c1 = ok(base, [link('SRC1')]).ir;
    expect(applyPatch(c1, [link('SRC2')]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'connect', from: { equipmentId: 'CV1', portId: 'out' }, to: { equipmentId: 'CV1', portId: 'in' } }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'connect', from: { equipmentId: 'CV1', portId: 'in' }, to: { equipmentId: 'CV1', portId: 'out' } }]).errors).toHaveLength(1);
    expect(applyPatch(base, [{ op: 'connect', from: { equipmentId: 'SRC1', portId: 'zzz' }, to: { equipmentId: 'CV1', portId: 'in' } }]).errors).toHaveLength(1);
  });
  it('disconnect and rename_line', () => {
    const c1 = ok(base, [link('SRC1')]).ir;
    const r = ok(c1, [{ op: 'disconnect', connectionId: 'C1' }, { op: 'rename_line', name: '新ライン' }]);
    expect(r.ir.connections).toEqual([]);
    expect(r.ir.name).toBe('新ライン');
    expect(applyPatch(c1, [{ op: 'disconnect', connectionId: 'C9' }]).errors).toHaveLength(1);
  });
});

describe('semantics', () => {
  const base = ok(buildStandardLine(), [{ op: 'add', item: 'generic', id: 'OBJ1', transform: { position: [5, 0, 5] } }]).ir;
  it('propose / confirm round trip', () => {
    const p = ok(base, [{ op: 'propose_semantics', id: 'OBJ1', kind: 'sensor', mount: { conveyorId: 'CV1', offsetM: 0.5 }, confidence: 0.7, rationale: '名前が sensor' }]);
    const e = get(p.ir, 'OBJ1');
    expect(e.kind).toBe('sensor');
    expect(e.semantics).toEqual({ status: 'proposed', source: 'ai', confidence: 0.7, rationale: '名前が sensor' });
    expect('transform' in e).toBe(false);
    expect(e.io[0].address).toBeDefined();
    expect(validate(p.ir).some((i) => i.severity === 'warning' && i.message.includes('未確認のため動作しません'))).toBe(true);
    const c = ok(p.ir, [{ op: 'confirm_semantics', id: 'OBJ1' }]);
    expect(get(c.ir, 'OBJ1').semantics.status).toBe('confirmed');
  });
  it('reject reverts to generic at the mount world position', () => {
    const p = ok(base, [{ op: 'propose_semantics', id: 'OBJ1', kind: 'stopper', mount: { conveyorId: 'CV1', offsetM: 0.5 }, confidence: 0.5, rationale: 'r' }]);
    const r = ok(p.ir, [{ op: 'reject_semantics', id: 'OBJ1' }]);
    const g = get(r.ir, 'OBJ1');
    expect(g.kind).toBe('generic');
    expect(g.semantics).toEqual({ status: 'confirmed', source: 'user' });
    expect(g.io).toEqual([]);
    close((g as never as { transform: { position: number[] } }).transform.position, [0.5, 0.8, 0]);
    expect(mountWorldPosition(p.ir, get(p.ir, 'OBJ1'))).toEqual([0.5, 0.8, 0]);
  });
  it('placed proposal keeps transform and params merge', () => {
    const p = ok(base, [{ op: 'propose_semantics', id: 'OBJ1', kind: 'conveyor', params: { lengthM: 1 }, confidence: 0.6, rationale: 'r' }]);
    const c = get(p.ir, 'OBJ1') as Conveyor;
    expect(c.transform.position).toEqual([5, 0, 5]);
    expect(c.ports.find((x) => x.id === 'out')!.localPosition[0]).toBe(1);
  });
  it('station proposal requires existing stopper/sensor; target must be generic', () => {
    const mount = { conveyorId: 'CV1', offsetM: 1 };
    const prop = (params?: Record<string, unknown>): PatchOp => ({ op: 'propose_semantics', id: 'OBJ1', kind: 'inspection_station', params, mount, confidence: 0.5, rationale: 'r' });
    expect(applyPatch(base, [prop()]).errors).toHaveLength(1);
    expect(applyPatch(base, [prop({ stopperId: 'X', sensorId: 'ST1_PS' })]).errors).toHaveLength(1);
    const r = ok(base, [prop({ stopperId: 'ST1_STP', sensorId: 'ST1_PS' })]);
    expect(get(r.ir, 'OBJ1').kind).toBe('inspection_station');
    expect(applyPatch(base, [{ op: 'propose_semantics', id: 'CV1', kind: 'source', confidence: 1, rationale: 'r' }]).errors).toHaveLength(1);
  });
  it('mounted proposal without mount is an error', () => {
    expect(applyPatch(base, [{ op: 'propose_semantics', id: 'OBJ1', kind: 'sensor', confidence: 1, rationale: 'r' }]).errors).toHaveLength(1);
  });
});

describe('assumptions', () => {
  const ir = buildStandardLine();
  it('assume records current value; accept flips status', () => {
    const r = ok(ir, [{ op: 'assume', equipmentId: 'CV1', path: 'params.speedMps', rationale: '未指定' }]);
    expect(r.ir.assumptions).toEqual([{ id: 'A1', equipmentId: 'CV1', path: 'params.speedMps', value: 0.2, rationale: '未指定', status: 'open' }]);
    expect(validate(r.ir).some((i) => i.message.includes('1 件'))).toBe(true);
    const a = ok(r.ir, [{ op: 'accept_assumption', id: 'A1' }]);
    expect(a.ir.assumptions[0].status).toBe('accepted');
    expect(validate(a.ir).some((i) => i.message.includes('仮定'))).toBe(false);
  });
  it('errors for unknown equipment/path/id', () => {
    expect(applyPatch(ir, [{ op: 'assume', equipmentId: 'X', path: 'params.a', rationale: '' }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'assume', equipmentId: 'CV1', path: 'params.nope', rationale: '' }]).errors).toHaveLength(1);
    expect(applyPatch(ir, [{ op: 'accept_assumption', id: 'A9' }]).errors).toHaveLength(1);
  });
  it('update of an assumed path removes the open assumption; other paths do not', () => {
    const r = ok(ir, [
      { op: 'assume', equipmentId: 'CV1', path: 'params.speedMps', rationale: 'a' },
      { op: 'assume', equipmentId: 'CV1', path: 'params.lengthM', rationale: 'b' },
    ]);
    const u = ok(r.ir, [{ op: 'update', id: 'CV1', params: { speedMps: 0.4 } }]);
    expect(u.ir.assumptions.map((a) => a.path)).toEqual(['params.lengthM']);
  });
});

describe('validate', () => {
  it('flags dangling refs, duplicates, over-length mounts, warnings', () => {
    const ir = JSON.parse(JSON.stringify(buildStandardLine())) as LineIR;
    (ir.equipment[3] as never as { mount: { conveyorId: string } }).mount.conveyorId = 'GONE';
    (ir.equipment[4] as never as { mount: { offsetM: number } }).mount.offsetM = 9;
    ir.equipment[0].io[0].tag = 'ST1_Start';
    ir.equipment[0].io[0].address = ir.equipment[2].io[0].address;
    ir.connections.push({ id: 'C9', from: { equipmentId: 'NOPE', portId: 'out' }, to: { equipmentId: 'CV1', portId: 'in' } });
    const errs = validate(ir).filter((i) => i.severity === 'error').map((i) => i.message).join('\n');
    expect(errs).toMatch(/GONE/);
    expect(errs).toMatch(/超えて/);
    expect(errs).toMatch(/タグ/);
    expect(errs).toMatch(/アドレス/);
    expect(errs).toMatch(/NOPE/);
  });
  it('warns: no conveyor, orphan source, conveyor without source', () => {
    expect(validate(emptyLine()).map((i) => i.message)).toContain('コンベヤがありません');
    const ir = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'CV1' }, { op: 'add', item: 'source', id: 'SRC1' }]).ir;
    const w = validate(ir).map((i) => i.message).join('\n');
    expect(w).toMatch(/CV1 の上流にワーク供給がありません/);
    expect(w).toMatch(/SRC1 がコンベヤに接続されていません/);
  });
  it('source reachable through a chain', () => {
    const ir = ok(buildStandardLine(), [{ op: 'add', item: 'conveyor', id: 'CV2', after: 'CV1' }]).ir;
    expect(validate(ir)).toEqual([]);
  });
});

describe('geometry', () => {
  it('applies scale to offsets', () => {
    const r = ok(emptyLine(), [{ op: 'add', item: 'conveyor', id: 'CV1', transform: { position: [1, 0, 0], scale: 2 } }]);
    const c = get(r.ir, 'CV1') as Conveyor;
    close(conveyorPointToWorld(c, 1), [3, 1.6, 0]);
  });
});

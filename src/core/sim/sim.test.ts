import { describe, expect, it } from 'vitest';
import { buildStandardLine } from '../demo/standardLine';
import { applyPatch } from '../ir';
import type { LineIR, PatchOp } from '../ir';
import { createSimulation } from './index';
import { generateControl, emitST } from '../control';
import { compare, runHeadless } from '../compare';
import type { Fault } from '../contracts';

const patch = (ir: LineIR, ops: PatchOp[]): LineIR => {
  const r = applyPatch(ir, ops);
  if (r.errors.length) throw new Error(r.errors.join(','));
  return r.ir;
};
const withSource = (ir: LineIR, intervalS: number, extra: Record<string, unknown> = {}) =>
  patch(ir, [{ op: 'update', id: 'SRC1', params: { intervalS, ...extra } }]);

function run(ir: LineIR, durationS: number, seed = 1) {
  const sim = createSimulation(ir, { seed });
  sim.start();
  sim.step(Math.round(durationS / sim.dtS));
  return sim;
}

describe('標準ライン', () => {
  it('120 s 流すと供給間隔 (5 s) で完成品が出る', () => {
    const sim = run(buildStandardLine(), 120);
    const s = sim.snapshot();
    console.log('standard metrics', JSON.stringify(s.metrics));
    expect(s.metrics.completed).toBeGreaterThan(15);
    expect(Math.abs(s.metrics.avgCycleTimeS! - 5)).toBeLessThan(0.25);
    expect(Math.abs(s.metrics.throughputPerMin! - 12)).toBeLessThan(0.7);
    // (2.0-0.1)/0.2 = 9.5 s + 検査 2 s + ストッパ/通過のオーバーヘッド
    expect(s.metrics.avgLeadTimeS!).toBeGreaterThan(11.2);
    expect(s.metrics.avgLeadTimeS!).toBeLessThan(14);
    expect(s.control.alarm).toBeNull();
    expect(s.metrics.ok + s.metrics.ng).toBe(s.metrics.completed);
  });

  it('決定的: 同シードで同一、別シードで OK/NG が変わる', () => {
    const ir = patch(buildStandardLine(), [{ op: 'update', id: 'ST1', params: { ngRate: 0.5 } }]);
    const a = runHeadless(ir, { durationS: 200, seed: 7 });
    const b = runHeadless(ir, { durationS: 200, seed: 7 });
    expect(a).toEqual(b);
    const ngs = [8, 9, 10, 11, 12].map((seed) => runHeadless(ir, { durationS: 200, seed }).ng);
    expect(ngs.some((n) => n !== a.ng)).toBe(true);
    expect(a.ng).toBeGreaterThan(0);
    expect(a.ok).toBeGreaterThan(0);
  });

  it('供給 1 s 間隔ではステーションが律速し、ワークは重ならない', () => {
    const ir = withSource(buildStandardLine(), 1);
    const sim = createSimulation(ir);
    sim.start();
    let minSpacing = Infinity;
    let maxCount = 0;
    for (let i = 0; i < 12000; i++) {
      sim.step();
      if (i % 5 !== 0) continue;
      const w = sim.snapshot().workpieces.filter((x) => x.conveyorId === 'CV1').sort((p, q) => p.offsetM - q.offsetM);
      maxCount = Math.max(maxCount, w.length);
      for (let k = 1; k < w.length; k++) minSpacing = Math.min(minSpacing, w[k].offsetM - w[k - 1].offsetM);
    }
    const m = sim.snapshot().metrics;
    console.log('fast source', JSON.stringify(m), 'minSpacing', minSpacing, 'maxCount', maxCount);
    expect(minSpacing).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(maxCount).toBeGreaterThan(3);
    expect(m.avgCycleTimeS!).toBeGreaterThan(1);
    expect(sim.snapshot().control.alarm).toBeNull();
  });
});

describe('滞留時の全数検査', () => {
  it('供給 1 s・200 s で全完成品が検査済み、通過後に pending は残らない', () => {
    const sim = createSimulation(withSource(buildStandardLine(), 1));
    sim.start();
    for (let i = 0; i < 20000; i++) {
      sim.step();
      if (i % 5) continue;
      for (const w of sim.snapshot().workpieces) {
        if (w.conveyorId === 'CV1' && w.offsetM + 0.1 > 1.0 + 0.1) expect(w.result).not.toBe('pending');
      }
    }
    const m = sim.snapshot().metrics;
    console.log('fast2', JSON.stringify(m));
    expect(m.completed).toBeGreaterThan(20);
    expect(m.ok + m.ng).toBe(m.completed);
  });
});

describe('異常注入', () => {
  const cases: [string, Fault, string, number][] = [
    ['motor trip', { type: 'conveyor_motor_trip', equipmentId: 'CV1' }, 'ST1_NO_ARRIVAL', 30],
    ['sensor off', { type: 'sensor_stuck_off', equipmentId: 'ST1_PS' }, 'ST1_NO_ARRIVAL', 30],
    ['sensor on', { type: 'sensor_stuck_on', equipmentId: 'ST1_PS' }, 'ST1_JAM', 15],
    ['stopper closed', { type: 'stopper_stuck_closed', equipmentId: 'ST1_STP' }, 'ST1_JAM', 40],
    ['no done', { type: 'inspection_no_done', equipmentId: 'ST1' }, 'ST1_INSPECT_TIMEOUT', 40],
  ];
  for (const [name, fault, code, bound] of cases) {
    it(`${name} -> ${code}`, () => {
      const sim = createSimulation(buildStandardLine());
      sim.injectFault(fault);
      sim.start();
      let t = -1;
      for (let i = 0; i < bound * 100; i++) {
        sim.step();
        if (sim.snapshot().control.alarm) {
          t = sim.snapshot().timeS;
          break;
        }
      }
      const s = sim.snapshot();
      expect(s.control.alarm?.code).toBe(code);
      console.log(name, code, 'at', t.toFixed(2));
      // 全 DO が false
      sim.step(5);
      const s2 = sim.snapshot();
      for (const tag of ['CV1_Run', 'ST1_Start', 'ST1_STP_Release']) expect(s2.io[tag]).toBe(false);
      // 復旧
      sim.clearFaults();
      sim.resetAlarm();
      const before = sim.snapshot().metrics.completed;
      sim.step(6000);
      const after = sim.snapshot();
      expect(after.control.alarm).toBeNull();
      expect(after.metrics.completed).toBeGreaterThan(before);
    });
  }
});

describe('比較', () => {
  it('検査時間短縮 + 高速化で 1 s 供給ならサイクルタイムが下がる', () => {
    const base = withSource(buildStandardLine(), 1);
    const after = patch(base, [
      { op: 'update', id: 'ST1', params: { inspectTimeS: 1.5 } },
      { op: 'update', id: 'CV1', params: { speedMps: 0.3 } },
    ]);
    const r = compare(base, after, { durationS: 200 });
    console.log('compare', JSON.stringify(r));
    expect(r.delta.cycleTimePct).not.toBeNull();
    expect(r.delta.cycleTimePct!).toBeLessThan(0);
    expect(r.delta.throughputPct!).toBeGreaterThan(0);
  });

  it('提案中のコンベヤは何も運ばず notes に載る', () => {
    const ir = buildStandardLine();
    ir.equipment = ir.equipment.map((e) =>
      e.id === 'CV1' ? { ...e, semantics: { status: 'proposed' as const, source: 'ai' as const } } : e,
    );
    const prog = generateControl(ir);
    expect(prog.notes.some((n) => n.includes('CV1'))).toBe(true);
    expect(prog.vars.some((v) => v.name === 'CV1_Run')).toBe(false);
    const sim = run(ir, 60);
    const s = sim.snapshot();
    expect(s.metrics.completed).toBe(0);
    expect(s.workpieces).toHaveLength(0);
  });

  it('2 台連結: after で接続したコンベヤへ受け渡して末端で排出', () => {
    const ir = patch(buildStandardLine(), [{ op: 'add', item: 'conveyor', id: 'CV2', after: 'CV1' }]);
    const sim = run(ir, 120);
    const s = sim.snapshot();
    expect(s.metrics.completed).toBeGreaterThan(10);
    expect(s.metrics.avgLeadTimeS!).toBeGreaterThan(20);
    expect(s.control.alarm).toBeNull();
  });
});

describe('ST 出力', () => {
  it('stepLines・構文バランス・全 DO タグ', () => {
    const ir = buildStandardLine();
    const prog = generateControl(ir);
    const st = emitST(prog, ir);
    const lines = st.code.split('\n');
    for (const [key, ln] of Object.entries(st.stepLines)) {
      const [seq, step] = key.split('.');
      const label = prog.sequences.find((s) => s.id === seq)!.steps.find((s) => s.id === step)!.label;
      expect(lines[ln - 1]).toContain(label);
    }
    expect(Object.keys(st.stepLines)).toHaveLength(4);
    const count = (re: RegExp) => (st.code.match(re) ?? []).length;
    expect(count(/\bCASE\b/g)).toBe(count(/\bEND_CASE\b/g));
    expect(count(/\bIF\b/g)).toBe(count(/\bEND_IF\b/g));
    for (const v of prog.vars.filter((x) => x.kind === 'output')) expect(st.code).toContain(v.name);
    expect(st.code).toContain("AlarmCode := 'ST1_JAM';");
    expect(st.code).toContain('標準ライン');
  });

  it('未確認の仮定が notes に出る', () => {
    const ir = patch(buildStandardLine(), [{ op: 'assume', equipmentId: 'CV1', path: 'params.speedMps', rationale: '指定なし' }]);
    const prog = generateControl(ir);
    expect(prog.notes.some((n) => n.startsWith('仮定: CV1 params.speedMps'))).toBe(true);
  });
});

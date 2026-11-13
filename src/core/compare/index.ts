import type { CompareResult, Metrics } from '../contracts';
import type { LineIR } from '../ir/schema';
import { createSimulation } from '../sim';

export function runHeadless(ir: LineIR, opts: { durationS: number; seed: number }): Metrics {
  const sim = createSimulation(ir, { seed: opts.seed });
  sim.start();
  sim.step(Math.round(opts.durationS / sim.dtS));
  return sim.snapshot().metrics;
}

const pct = (b: number | null, a: number | null): number | null =>
  b === null || a === null || b === 0 ? null : (a - b) / b;

export function compare(
  before: LineIR,
  after: LineIR,
  opts?: { durationS?: number; seed?: number },
): CompareResult {
  const durationS = opts?.durationS ?? 300;
  const seed = opts?.seed ?? 1;
  const b = runHeadless(before, { durationS, seed });
  const a = runHeadless(after, { durationS, seed });
  return {
    durationS,
    seed,
    before: b,
    after: a,
    delta: {
      cycleTimePct: pct(b.avgCycleTimeS, a.avgCycleTimeS),
      throughputPct: pct(b.throughputPerMin, a.throughputPerMin),
    },
  };
}

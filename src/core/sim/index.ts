/**
 * 決定的な運動学シミュレータ。物理エンジンなし。
 * ワークは「どのコンベヤの何 m 地点か」で表す。固定刻み + シード付き乱数。
 */
import type {
  Fault,
  FaultType,
  Metrics,
  SimSnapshot,
  SimWorkpiece,
  Simulation,
} from '../contracts';
import { createController, generateControl } from '../control';
import type { Conveyor, InspectionStation, LineIR, Sensor, Source, Stopper } from '../ir/schema';

const GAP_M = 0.05;
const HOLD_TOL_M = 0.03;
const EPS = 1e-9;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Wp {
  id: number;
  conveyorId: string;
  offsetM: number;
  lengthM: number;
  state: 'moving' | 'blocked';
  result: 'pending' | 'ok' | 'ng';
  createdAtS: number;
}

interface StationRt {
  eq: InspectionStation;
  startTag: string;
  doneTag: string;
  okTag: string;
  prevStart: boolean;
  inspecting: boolean;
  timerS: number;
  done: boolean;
  ok: boolean;
}

interface SourceRt {
  eq: Source;
  conveyorId: string | null;
  nextAtS: number;
}

export function createSimulation(ir: LineIR, opts?: { seed?: number; dtS?: number }): Simulation {
  const seed = opts?.seed ?? 1;
  const dtS = opts?.dtS ?? 0.01;
  const rng = mulberry32(seed);
  const program = generateControl(ir);
  const controller = createController(program);

  const active = ir.equipment.filter((e) => e.semantics.status === 'confirmed');
  const conveyors = new Map<string, Conveyor>();
  const stoppers: Stopper[] = [];
  const sensors: Sensor[] = [];
  for (const e of active) {
    if (e.kind === 'conveyor') conveyors.set(e.id, e);
    else if (e.kind === 'stopper') stoppers.push(e);
    else if (e.kind === 'sensor') sensors.push(e);
  }
  const tagOf = (e: { io: { role: string; tag: string }[] }, role: string) =>
    e.io.find((p) => p.role === role)?.tag ?? '';

  const stations: StationRt[] = active
    .filter((e): e is InspectionStation => e.kind === 'inspection_station')
    .map((eq) => ({
      eq,
      startTag: tagOf(eq, 'inspect_start'),
      doneTag: tagOf(eq, 'inspect_done'),
      okTag: tagOf(eq, 'inspect_ok'),
      prevStart: false,
      inspecting: false,
      timerS: 0,
      done: false,
      ok: false,
    }));
  const sources: SourceRt[] = active
    .filter((e): e is Source => e.kind === 'source')
    .map((eq) => {
      const c = ir.connections.find((x) => x.from.equipmentId === eq.id);
      const to = c ? c.to.equipmentId : null;
      return { eq, conveyorId: to && conveyors.has(to) ? to : null, nextAtS: 0 };
    });

  /** conveyorId → 下流コンベヤ ID (確定コンベヤのみ) */
  const downstream = new Map<string, string>();
  for (const c of ir.connections) {
    if (conveyors.has(c.from.equipmentId) && conveyors.has(c.to.equipmentId)) {
      downstream.set(c.from.equipmentId, c.to.equipmentId);
    }
  }
  // 下流から先に処理する順序 (末端までの距離が小さい順)
  const depth = (id: string): number => {
    let d = 0;
    const seen = new Set<string>([id]);
    let cur = id;
    while (downstream.has(cur)) {
      cur = downstream.get(cur)!;
      if (seen.has(cur)) break;
      seen.add(cur);
      d++;
    }
    return d;
  };
  const convOrder = [...conveyors.keys()].sort((a, b) => depth(a) - depth(b));

  let tick = 0;
  let nextWpId = 1;
  let wps: Wp[] = [];
  const faults: Fault[] = [];
  const stopperOpen: Record<string, number> = {};
  for (const s of stoppers) stopperOpen[s.id] = 0;
  const io: Record<string, boolean> = {};
  for (const x of program.vars) if (x.kind !== 'internal') io[x.name] = false;

  let completed = 0;
  let okCount = 0;
  let ngCount = 0;
  const exits: number[] = [];
  let leadSum = 0;

  const hasFault = (type: FaultType, id: string) => faults.some((f) => f.type === type && f.equipmentId === id);
  const timeS = () => tick * dtS;
  const onConv = (cid: string) => wps.filter((w) => w.conveyorId === cid);

  const hasSpace = (cid: string, centre: number, len: number) =>
    !wps.some((w) => w.conveyorId === cid && Math.abs(w.offsetM - centre) < (w.lengthM + len) / 2 + GAP_M - EPS);

  function step1Sensors(): Record<string, boolean> {
    const inputs: Record<string, boolean> = {};
    for (const s of sensors) {
      const tag = tagOf(s, 'detect');
      let on = onConv(s.mount.conveyorId).some(
        (w) => Math.abs(w.offsetM - s.mount.offsetM) <= w.lengthM / 2 + EPS,
      );
      if (hasFault('sensor_stuck_off', s.id)) on = false;
      if (hasFault('sensor_stuck_on', s.id)) on = true;
      if (tag) inputs[tag] = on;
    }
    for (const st of stations) {
      inputs[st.doneTag] = st.done;
      inputs[st.okTag] = st.done && st.ok;
    }
    return inputs;
  }

  function heldWp(st: StationRt): Wp | undefined {
    const off = st.eq.mount.offsetM;
    let best: Wp | undefined;
    let bestD = Infinity;
    for (const w of onConv(st.eq.mount.conveyorId)) {
      const d = Math.abs(w.offsetM + w.lengthM / 2 - off);
      if (d <= HOLD_TOL_M && d < bestD) {
        best = w;
        bestD = d;
      }
    }
    return best;
  }

  function step3Actuators(outputs: Record<string, boolean>) {
    for (const s of stoppers) {
      const want = !!outputs[tagOf(s, 'release')];
      const cur = stopperOpen[s.id];
      if (hasFault('stopper_stuck_closed', s.id)) {
        stopperOpen[s.id] = 0;
        continue;
      }
      const T = s.params.actuationTimeS;
      const delta = T <= 0 ? 1 : dtS / T;
      stopperOpen[s.id] = want ? Math.min(1, cur + delta) : Math.max(0, cur - delta);
    }
    for (const st of stations) {
      const start = !!outputs[st.startTag];
      if (start && !st.prevStart) {
        st.inspecting = true;
        st.timerS = st.eq.params.inspectTimeS;
        st.done = false;
        st.ok = false;
      } else if (start && st.inspecting) {
        if (!hasFault('inspection_no_done', st.eq.id)) {
          st.timerS -= dtS;
          if (st.timerS <= EPS) {
            st.inspecting = false;
            st.done = true;
            st.ok = rng() >= st.eq.params.ngRate;
            const w = heldWp(st);
            if (w) w.result = st.ok ? 'ok' : 'ng';
          }
        }
      }
      if (!start) {
        st.inspecting = false;
        st.done = false;
        st.ok = false;
      }
      st.prevStart = start;
    }
  }

  function step4Spawn() {
    const cs = controller.state;
    if (!cs.running || cs.alarm) return;
    const t = timeS();
    for (const s of sources) {
      if (!s.conveyorId || t + EPS < s.nextAtS) continue;
      const len = s.eq.params.workpiece.lengthM;
      if (!hasSpace(s.conveyorId, len / 2, len)) continue;
      wps.push({
        id: nextWpId++,
        conveyorId: s.conveyorId,
        offsetM: len / 2,
        lengthM: len,
        state: 'moving',
        result: 'pending',
        createdAtS: t,
      });
      s.nextAtS += s.eq.params.intervalS;
      if (s.nextAtS <= t + EPS) s.nextAtS = t + s.eq.params.intervalS;
    }
  }

  function step5Move(outputs: Record<string, boolean>) {
    const t = timeS();
    for (const cid of convOrder) {
      const conv = conveyors.get(cid)!;
      const running = !!outputs[tagOf(conv, 'motor_run')] && !hasFault('conveyor_motor_trip', cid);
      const desired = running ? conv.params.speedMps * dtS : 0;
      const blockers = stoppers.filter(
        (s) => s.mount.conveyorId === cid && stopperOpen[s.id] < 1 - EPS,
      );
      const list = onConv(cid).sort((a, b) => b.offsetM - a.offsetM);
      const down = downstream.get(cid);
      let ahead: Wp | null = null;
      for (const w of list) {
        let target = w.offsetM + desired;
        if (ahead) target = Math.min(target, ahead.offsetM - (ahead.lengthM + w.lengthM) / 2 - GAP_M);
        for (const s of blockers) {
          const lead = w.offsetM + w.lengthM / 2;
          if (lead <= s.mount.offsetM + EPS) target = Math.min(target, s.mount.offsetM - w.lengthM / 2);
        }
        target = Math.max(target, w.offsetM); // 後退しない
        let removed = false;
        if (target > conv.params.lengthM + EPS) {
          if (down) {
            const carried = target - conv.params.lengthM;
            if (hasSpace(down, carried, w.lengthM)) {
              w.conveyorId = down;
              w.offsetM = carried;
              w.state = 'moving';
              continue; // 下流で管理: ahead には含めない (空間は hasSpace で保証)
            }
            target = Math.max(w.offsetM, conv.params.lengthM);
          } else {
            // 排出
            removed = true;
            completed++;
            if (w.result === 'ok') okCount++;
            else if (w.result === 'ng') ngCount++;
            exits.push(t);
            leadSum += t - w.createdAtS;
          }
        }
        if (removed) {
          wps = wps.filter((x) => x !== w);
          continue;
        }
        w.state = desired > 0 && target - w.offsetM < desired - 1e-12 ? 'blocked' : 'moving';
        w.offsetM = target;
        ahead = w;
      }
    }
  }

  function metrics(): Metrics {
    const intervals: number[] = [];
    for (let i = 1; i < exits.length; i++) intervals.push(exits[i] - exits[i - 1]);
    const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    return {
      completed,
      ok: okCount,
      ng: ngCount,
      avgCycleTimeS: avg,
      lastCycleTimeS: intervals.length ? intervals[intervals.length - 1] : null,
      avgLeadTimeS: completed ? leadSum / completed : null,
      throughputPerMin: avg && avg > 0 ? 60 / avg : null,
    };
  }

  function stepOnce() {
    const inputs = step1Sensors();
    const outputs = controller.scan(inputs, dtS, timeS());
    Object.assign(io, inputs, outputs);
    step3Actuators(outputs);
    step4Spawn();
    step5Move(outputs);
    tick++;
  }

  return {
    dtS,
    step(n = 1) {
      for (let i = 0; i < n; i++) stepOnce();
    },
    start: () => controller.start(),
    stop: () => controller.stop(),
    resetAlarm: () => controller.resetAlarm(),
    injectFault(f) {
      if (!hasFault(f.type, f.equipmentId)) faults.push({ ...f });
    },
    clearFaults() {
      faults.length = 0;
    },
    snapshot(): SimSnapshot {
      const cs = controller.state;
      const inspecting: Record<string, boolean> = {};
      for (const st of stations) inspecting[st.eq.id] = st.inspecting;
      return {
        timeS: timeS(),
        workpieces: wps.map(
          (w): SimWorkpiece => ({
            id: w.id,
            conveyorId: w.conveyorId,
            offsetM: w.offsetM,
            state: w.state,
            result: w.result,
            createdAtS: w.createdAtS,
          }),
        ),
        io: { ...io },
        stopperOpen: { ...stopperOpen },
        inspecting,
        control: {
          activeSteps: { ...cs.activeSteps },
          alarm: cs.alarm ? { ...cs.alarm } : null,
          running: cs.running,
        },
        faults: faults.map((f) => ({ ...f })),
        metrics: metrics(),
      };
    },
  };
}

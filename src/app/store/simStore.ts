import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { createSimulation } from '@core/sim';
import { emitST, generateControl } from '@core/control';
import { validate } from '@core/ir';
import type { LineIR } from '@core/ir';
import type { ControlProgram, Fault, FaultType, STOutput, SimSnapshot, Simulation } from '@core/contracts';
import type { LiveState } from '../scene/live';
import { useLineStore } from './lineStore';
import { useUiStore } from './uiStore';

export type SimStatus = 'idle' | 'running' | 'paused';
export type SimSpeed = 1 | 2 | 4;

const MAX_STEPS_PER_FRAME = 400;
const MAX_FRAME_DT_S = 0.25;
const EMPTY_LIVE: Record<string, LiveState> = {};

export const FAULT_LABEL: Record<FaultType, string> = {
  sensor_stuck_off: '固着OFF',
  sensor_stuck_on: '固着ON',
  stopper_stuck_closed: '閉固着',
  inspection_no_done: '検査完了せず',
  conveyor_motor_trip: 'モータトリップ',
};

export const FAULTS_BY_KIND: Record<string, FaultType[]> = {
  sensor: ['sensor_stuck_off', 'sensor_stuck_on'],
  stopper: ['stopper_stuck_closed'],
  inspection_station: ['inspection_no_done'],
  conveyor: ['conveyor_motor_trip'],
};

export interface SimState {
  status: SimStatus;
  speed: SimSpeed;
  snapshot: SimSnapshot | null;
  program: ControlProgram;
  st: STOutput;
  /** 注入中の異常 (idle でも保持し、実行開始時に適用する) */
  faults: Fault[];
  /** 設備 ID → ライブ表示状態 (3D 用。変化したときだけ更新される) */
  live: Record<string, LiveState>;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (s: SimSpeed) => void;
  injectFault: (f: Fault) => void;
  clearFaults: () => void;
  resetAlarm: () => void;
}

function build(ir: LineIR): { program: ControlProgram; st: STOutput } {
  const program = generateControl(ir);
  return { program, st: emitST(program, ir) };
}

/* ───────── ループ (モジュール内で 1 本) ───────── */

let sim: Simulation | null = null;
let raf = 0;
let lastT = 0;
let acc = 0;
/** 検査ステーション ID → 最後に見た検査結果 */
let lastResults: Record<string, 'ok' | 'ng' | null> = {};
let liveCache: Record<string, LiveState> = EMPTY_LIVE;

const shallowEq = (a: LiveState, b: LiveState) => {
  const ka = Object.keys(a) as (keyof LiveState)[];
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

function computeLive(ir: LineIR, snap: SimSnapshot | null, status: SimStatus): Record<string, LiveState> {
  if (!snap) {
    lastResults = {};
    liveCache = EMPTY_LIVE;
    return EMPTY_LIVE;
  }
  const alarmId = snap.control.alarm?.equipmentId;
  const tagOf = (e: { io: { role: string; tag: string }[] }, role: string) => e.io.find((p) => p.role === role)?.tag;
  const next: Record<string, LiveState> = {};
  for (const e of ir.equipment) {
    const faulted = snap.faults.some((f) => f.equipmentId === e.id) || alarmId === e.id;
    const l: LiveState = {};
    if (faulted) l.fault = true;
    if (e.kind === 'conveyor') {
      const tag = tagOf(e, 'motor_run');
      l.running =
        status === 'running' &&
        !!tag &&
        !!snap.io[tag] &&
        !snap.faults.some((f) => f.type === 'conveyor_motor_trip' && f.equipmentId === e.id);
    } else if (e.kind === 'stopper') {
      l.open = snap.stopperOpen[e.id] ?? 0;
    } else if (e.kind === 'sensor') {
      const tag = tagOf(e, 'detect');
      l.detecting = !!tag && !!snap.io[tag];
    } else if (e.kind === 'inspection_station') {
      l.inspecting = !!snap.inspecting[e.id];
      // 検査結果: ステーション位置の直下流にいる、結果確定済みで最も近いワーク
      const off = e.mount.offsetM;
      let best: { d: number; r: 'ok' | 'ng' } | null = null;
      for (const w of snap.workpieces) {
        if (w.conveyorId !== e.mount.conveyorId || w.result === 'pending') continue;
        const d = w.offsetM - off;
        if (d < -0.3) continue;
        if (!best || d < best.d) best = { d, r: w.result };
      }
      if (best) lastResults[e.id] = best.r;
      l.lastResult = lastResults[e.id] ?? null;
    } else continue;
    if (Object.keys(l).length === 0) continue;
    const prev = liveCache[e.id];
    next[e.id] = prev && shallowEq(prev, l) ? prev : l;
  }
  const keys = Object.keys(next);
  const same = keys.length === Object.keys(liveCache).length && keys.every((k) => liveCache[k] === next[k]);
  if (!same) liveCache = next;
  return liveCache;
}

function publish() {
  if (!sim) return;
  const snapshot = sim.snapshot();
  const live = computeLive(useLineStore.getState().ir, snapshot, useSimStore.getState().status);
  useSimStore.setState({ snapshot, live });
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME_DT_S, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  const s = useSimStore.getState();
  if (!sim || s.status !== 'running') return;
  acc += dt * s.speed;
  const n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc / sim.dtS));
  if (n > 0) {
    sim.step(n);
    acc = n === MAX_STEPS_PER_FRAME ? 0 : acc - n * sim.dtS;
    publish();
  }
}

function startLoop() {
  if (raf) return;
  lastT = performance.now();
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function discardSim() {
  stopLoop();
  sim = null;
  acc = 0;
  lastResults = {};
  liveCache = EMPTY_LIVE;
}

const initial = build(useLineStore.getState().ir);

export const useSimStore = create<SimState>((set, get) => ({
  status: 'idle',
  speed: 1,
  snapshot: null,
  program: initial.program,
  st: initial.st,
  faults: [],
  live: EMPTY_LIVE,

  play: () => {
    const ui = useUiStore.getState();
    const { status } = get();
    if (status === 'running') return;
    if (status === 'paused' && sim) {
      set({ status: 'running' });
      startLoop();
      return;
    }
    const ir = useLineStore.getState().ir;
    if (!ir.equipment.some((e) => e.kind === 'conveyor')) {
      ui.toast('コンベヤがありません。「設備」タブから追加してください', 'error');
      return;
    }
    const err = validate(ir).find((i) => i.severity === 'error');
    if (err) {
      ui.toast(`実行できません: ${err.message}`, 'error');
      return;
    }
    discardSim();
    sim = createSimulation(ir, { seed: 1 });
    for (const f of get().faults) sim.injectFault(f);
    sim.start();
    set({ status: 'running' });
    publish();
    startLoop();
  },

  pause: () => {
    if (get().status !== 'running') return;
    stopLoop();
    set({ status: 'paused' });
    publish();
  },

  reset: () => {
    discardSim();
    set({ status: 'idle', snapshot: null, live: EMPTY_LIVE, faults: [] });
  },

  setSpeed: (speed) => set({ speed }),

  injectFault: (f) => {
    if (get().faults.some((x) => x.type === f.type && x.equipmentId === f.equipmentId)) return;
    sim?.injectFault(f);
    set((s) => ({ faults: [...s.faults, f] }));
    publish();
  },

  clearFaults: () => {
    sim?.clearFaults();
    set({ faults: [] });
    publish();
  },

  resetAlarm: () => {
    sim?.resetAlarm();
    publish();
  },
}));

// IR が変わったら ST を再生成し、シミュレーションを破棄して idle に戻す
useLineStore.subscribe((s, prev) => {
  if (s.ir === prev.ir) return;
  const was = useSimStore.getState().status;
  const ids = new Set(s.ir.equipment.map((e) => e.id));
  const { program, st } = build(s.ir);
  discardSim();
  useSimStore.setState((cur) => ({
    program,
    st,
    status: 'idle',
    snapshot: null,
    live: EMPTY_LIVE,
    faults: cur.faults.filter((f) => ids.has(f.equipmentId)),
  }));
  if (was !== 'idle') useUiStore.getState().toast('ラインが変更されたためシミュレーションをリセットしました');
});

/** 約 ms ごとにだけ更新される SimState の一部 (HUD や ST ハイライト用。React ツリーを 60fps で再描画しない) */
export function useThrottledSim<T>(select: (s: SimState) => T, ms = 200): T {
  const [val, setVal] = useState(() => select(useSimStore.getState()));
  const selRef = useRef(select);
  selRef.current = select;
  useEffect(() => {
    let last = useSimStore.getState().snapshot;
    let lastStatus = useSimStore.getState().status;
    setVal(selRef.current(useSimStore.getState()));
    const id = setInterval(() => {
      const st = useSimStore.getState();
      if (st.snapshot === last && st.status === lastStatus) return;
      last = st.snapshot;
      lastStatus = st.status;
      setVal(selRef.current(st));
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return val;
}

// 開発時のみ: デバッグ/自動テスト用
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__simStore = useSimStore;

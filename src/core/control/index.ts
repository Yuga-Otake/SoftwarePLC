/**
 * 制御ロジック生成 (Control IR) / ST 出力 / 解釈実行。
 * LLM は使わない。同じ ControlProgram から ST テキストと解釈実行の両方を作るので、
 * 表示される ST とシミュレータ内のロジックは常に一致する。
 */
import type {
  Alarm,
  ControlProgram,
  ControlVar,
  Controller,
  ControllerState,
  Expr,
  Sequence,
  STOutput,
  Step,
} from '../contracts';
import { SENSOR_BEFORE_STOP_M } from '../library';
import type { Conveyor, Equipment, InspectionStation, LineIR, Sensor, Source, Stopper } from '../ir/schema';

/* ───────────── Expr ヘルパ ───────────── */

const v = (name: string): Expr => ({ t: 'var', name });
const not = (e: Expr): Expr => ({ t: 'not', e });
const and = (...es: Expr[]): Expr => ({ t: 'and', es });
const elapsed = (sec: number): Expr => ({ t: 'elapsed', sec });

const DEFAULT_WORKPIECE_LENGTH_M = 0.2;
const DEFAULT_SPEED_MPS = 0.2;

/* ───────────── 生成 ───────────── */

const KIND_LABEL: Record<Equipment['kind'], string> = {
  conveyor: 'コンベヤ',
  source: 'ワーク供給',
  sensor: 'センサ',
  stopper: 'ストッパ',
  inspection_station: '検査ステーション',
  generic: '汎用オブジェクト',
};

function addressFor(dir: 'DI' | 'DO', n: number): string {
  return `%${dir === 'DI' ? 'IX' : 'QX'}${Math.floor(n / 8)}.${n % 8}`;
}

/** 上流 (接続を遡って) の供給口と、そこから対象コンベヤ搬入端までの搬送時間 */
function findUpstream(ir: LineIR, conveyorId: string): { source: Source; travelS: number } | null {
  const seen = new Set<string>();
  let cur = conveyorId;
  let travelS = 0;
  for (;;) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const conn = ir.connections.find((c) => c.to.equipmentId === cur);
    if (!conn) return null;
    const from = ir.equipment.find((e) => e.id === conn.from.equipmentId);
    if (!from) return null;
    if (from.kind === 'source') return from.semantics.status === 'confirmed' ? { source: from, travelS } : null;
    if (from.kind !== 'conveyor') return null;
    travelS += from.params.lengthM / from.params.speedMps;
    cur = from.id;
  }
}

export function generateControl(ir: LineIR): ControlProgram {
  const notes: string[] = [];
  const confirmed = (e: Equipment) => e.semantics.status === 'confirmed';
  const active = ir.equipment.filter(confirmed);
  for (const e of ir.equipment) {
    if (!confirmed(e)) {
      notes.push(`${e.id} (${KIND_LABEL[e.kind]}) は提案中で未確認のため、制御対象外とした`);
    }
  }
  for (const a of ir.assumptions) {
    if (a.status === 'open') {
      notes.push(`仮定: ${a.equipmentId} ${a.path} = ${JSON.stringify(a.value)} — ${a.rationale}`);
    }
  }

  const vars: ControlVar[] = [];
  let di = 0;
  let dout = 0;
  for (const e of active) {
    for (const p of e.io) {
      const address = p.address ?? addressFor(p.dir, p.dir === 'DI' ? di : dout);
      if (p.dir === 'DI') di++;
      else dout++;
      vars.push({
        name: p.tag,
        kind: p.dir === 'DI' ? 'input' : 'output',
        equipmentId: e.id,
        ioId: p.id,
        address,
        comment: p.comment,
      });
    }
  }
  vars.push({ name: 'Run', kind: 'internal', comment: '運転中 (HMI/起動指令)' });
  vars.push({ name: 'Alarm', kind: 'internal', comment: 'アラーム保持中' });

  const tagOf = (e: Equipment, role: string) => e.io.find((p) => p.role === role)?.tag;

  const continuous: ControlProgram['continuous'] = [];
  for (const e of active) {
    if (e.kind !== 'conveyor') continue;
    const tag = tagOf(e, 'motor_run');
    if (tag) continuous.push({ output: tag, expr: and(v('Run'), not(v('Alarm'))), comment: `${e.id} 運転` });
  }

  const sequences: Sequence[] = [];
  for (const st of active) {
    if (st.kind !== 'inspection_station') continue;
    const stopper = active.find((e): e is Stopper => e.kind === 'stopper' && e.id === st.params.stopperId);
    const sensor = active.find((e): e is Sensor => e.kind === 'sensor' && e.id === st.params.sensorId);
    if (!stopper || !sensor) {
      notes.push(`${st.id} のシーケンスは生成しない: 参照するストッパ/在荷センサが未確認または存在しない`);
      continue;
    }
    const startTag = tagOf(st, 'inspect_start');
    const doneTag = tagOf(st, 'inspect_done');
    const releaseTag = tagOf(stopper, 'release');
    const detectTag = tagOf(sensor, 'detect');
    if (!startTag || !doneTag || !releaseTag || !detectTag) {
      notes.push(`${st.id} のシーケンスは生成しない: 必要な I/O (開始/完了/開放/検出) が不足`);
      continue;
    }
    sequences.push(buildSequence(ir, st, stopper, sensor, { startTag, doneTag, releaseTag, detectTag }));
  }

  return { name: ir.name, vars, sequences, continuous, notes };
}

function buildSequence(
  ir: LineIR,
  st: InspectionStation,
  stopper: Stopper,
  sensor: Sensor,
  t: { startTag: string; doneTag: string; releaseTag: string; detectTag: string },
): Sequence {
  const id = st.id;
  const conv = ir.equipment.find((e): e is Conveyor => e.kind === 'conveyor' && e.id === st.mount.conveyorId);
  const speed = conv?.params.speedMps ?? DEFAULT_SPEED_MPS;
  const up = conv ? findUpstream(ir, conv.id) : null;
  const wpLen = up?.source.params.workpiece.lengthM ?? DEFAULT_WORKPIECE_LENGTH_M;
  const detect = v(t.detectTag);

  const s0: Step = {
    id: 'S0',
    label: 'ワーク待ち',
    outputs: [],
    transitions: [{ to: 'S1', when: detect }],
  };
  if (up) {
    const arrivalTimeoutS =
      Math.max(3 * up.source.params.intervalS, 2 * (up.travelS + st.mount.offsetM / speed)) + 5;
    s0.transitions.push({
      to: 'S0',
      when: and(v('Run'), not(v('Alarm')), elapsed(arrivalTimeoutS)),
      alarm: {
        code: `${id}_NO_ARRIVAL`,
        message: `${id} ワーク未到着タイムアウト（在荷センサ ${sensor.id} / 搬送を確認）`,
        equipmentId: sensor.id,
      },
    });
  }
  const s1: Step = {
    id: 'S1',
    label: '検査中',
    outputs: [t.startTag],
    transitions: [
      { to: 'S2', when: v(t.doneTag) },
      {
        to: 'S0',
        when: elapsed(st.params.inspectTimeS + 3),
        alarm: {
          code: `${id}_INSPECT_TIMEOUT`,
          message: `${id} 検査完了タイムアウト（検査ステーション ${id} を確認）`,
          equipmentId: id,
        },
      },
    ],
  };
  const s2: Step = {
    id: 'S2',
    label: 'ストッパ開放',
    outputs: [t.releaseTag],
    transitions: [
      { to: 'S3', when: not(detect) },
      {
        to: 'S0',
        when: elapsed(stopper.params.actuationTimeS + 5),
        alarm: {
          code: `${id}_JAM`,
          message: `${id} ストッパ開放後もワーク詰まり（ストッパ ${stopper.id} / 在荷センサ ${sensor.id} を確認）`,
          equipmentId: stopper.id,
        },
      },
    ],
  };
  const clearS = (SENSOR_BEFORE_STOP_M + 0.02) / speed;
  void wpLen;
  const s3: Step = {
    id: 'S3',
    label: '通過待ち',
    outputs: [t.releaseTag],
    transitions: [{ to: 'S0', when: elapsed(clearS) }],
  };
  return { id, label: `検査 ${id}`, equipmentId: id, initialStep: 'S0', steps: [s0, s1, s2, s3] };
}

/* ───────────── 解釈実行 ───────────── */

const EPS = 1e-9;

export function createController(program: ControlProgram): Controller {
  const outputNames = program.vars.filter((x) => x.kind === 'output').map((x) => x.name);
  const inputNames = program.vars.filter((x) => x.kind === 'input').map((x) => x.name);
  const activeSteps: Record<string, string> = {};
  const elapsedS: Record<string, number> = {};
  const state: ControllerState = { activeSteps, alarm: null, running: false };

  const resetSequences = () => {
    for (const s of program.sequences) {
      activeSteps[s.id] = s.initialStep;
      elapsedS[s.id] = 0;
    }
  };
  resetSequences();

  const evalExpr = (e: Expr, vals: Record<string, boolean>, el: number): boolean => {
    switch (e.t) {
      case 'const':
        return e.v;
      case 'var':
        return !!vals[e.name];
      case 'not':
        return !evalExpr(e.e, vals, el);
      case 'and':
        return e.es.every((x) => evalExpr(x, vals, el));
      case 'or':
        return e.es.some((x) => evalExpr(x, vals, el));
      case 'elapsed':
        return el >= e.sec - EPS;
    }
  };

  return {
    scan(inputs, dtS, nowS) {
      const vals: Record<string, boolean> = {};
      for (const n of inputNames) vals[n] = !!inputs[n];
      for (const n of outputNames) vals[n] = false;
      vals.Run = state.running;
      vals.Alarm = state.alarm !== null;

      for (const c of program.continuous) vals[c.output] = evalExpr(c.expr, vals, 0);

      for (const seq of program.sequences) {
        if (!state.running || state.alarm) continue;
        elapsedS[seq.id] += dtS;
        const step = seq.steps.find((s) => s.id === activeSteps[seq.id]);
        if (!step) continue;
        const driven = new Set(seq.steps.flatMap((s) => s.outputs));
        for (const o of driven) vals[o] = step.outputs.includes(o);
        for (const tr of step.transitions) {
          if (!evalExpr(tr.when, vals, elapsedS[seq.id])) continue;
          if (tr.alarm) {
            state.alarm = { ...tr.alarm, timeS: nowS } as Alarm;
            vals.Alarm = true;
          }
          activeSteps[seq.id] = tr.to;
          elapsedS[seq.id] = 0;
          break;
        }
      }

      const out: Record<string, boolean> = {};
      const off = !state.running || state.alarm !== null;
      for (const n of outputNames) out[n] = off ? false : vals[n];
      return out;
    },
    start() {
      state.running = true;
    },
    stop() {
      state.running = false;
    },
    resetAlarm() {
      state.alarm = null;
      resetSequences();
    },
    get state() {
      return state;
    },
  };
}

/* ───────────── ST 出力 ───────────── */

function stTime(sec: number): string {
  return `T#${Math.round(sec * 1000)}ms`;
}

function stExpr(e: Expr, seqId: string, parent: 'and' | 'or' | 'top' = 'top'): string {
  switch (e.t) {
    case 'const':
      return e.v ? 'TRUE' : 'FALSE';
    case 'var':
      return e.name;
    case 'not': {
      const inner = stExpr(e.e, seqId, 'and');
      return e.e.t === 'and' || e.e.t === 'or' ? `NOT (${stExpr(e.e, seqId)})` : `NOT ${inner}`;
    }
    case 'and':
      return e.es.map((x) => stExpr(x, seqId, 'and')).join(' AND ');
    case 'or': {
      const s = e.es.map((x) => stExpr(x, seqId, 'or')).join(' OR ');
      return parent === 'and' ? `(${s})` : s;
    }
    case 'elapsed':
      return `${seqId}_T.ET >= ${stTime(e.sec)}`;
  }
}

export function emitST(program: ControlProgram, ir: LineIR): STOutput {
  void ir;
  const lines: string[] = [];
  const stepLines: Record<string, number> = {};
  const L = (s = '') => void lines.push(s);

  L('(*');
  L(`  ライン: ${program.name}`);
  L('  このコードは Equipment IR から自動生成されました (手編集しないでください)。');
  if (program.notes.length) {
    L('  注意事項:');
    for (const n of program.notes) L(`   - ${n}`);
  }
  L('*)');
  L('PROGRAM LineControl');
  L('VAR');
  const decl = (x: ControlVar) => {
    const at = x.address ? ` AT ${x.address}` : '';
    const c = x.comment ? ` (* ${x.comment} *)` : '';
    L(`  ${x.name}${at} : BOOL;${c}`);
  };
  const inputs = program.vars.filter((x) => x.kind === 'input');
  const outputs = program.vars.filter((x) => x.kind === 'output');
  const internals = program.vars.filter((x) => x.kind === 'internal');
  L('  (* 入力 *)');
  inputs.forEach(decl);
  L('  (* 出力 *)');
  outputs.forEach(decl);
  L('  (* 内部変数 *)');
  internals.forEach(decl);
  L("  AlarmCode : STRING[48]; (* 発報中のアラームコード *)");
  L('  AlarmReset : BOOL; (* アラームリセット指令 (HMI) *)');
  for (const s of program.sequences) {
    L(`  ${s.id}_Step : INT := 0; (* ${s.label} ステップ番号 *)`);
    L(`  ${s.id}_T : TON; (* ${s.label} ステップ経過タイマ *)`);
  }
  L('END_VAR');
  L('');

  const stepNo = (seq: Sequence, id: string) => seq.steps.findIndex((s) => s.id === id) * 10;

  L('(* アラームリセット: 保持解除・全シーケンスを初期ステップへ *)');
  L('IF AlarmReset THEN');
  L('  Alarm := FALSE;');
  L("  AlarmCode := '';");
  for (const s of program.sequences) {
    L(`  ${s.id}_Step := ${stepNo(s, s.initialStep)};`);
    L(`  ${s.id}_T(IN := FALSE, PT := T#24h);`);
  }
  L('  AlarmReset := FALSE;');
  L('END_IF;');
  L('');

  if (program.continuous.length) {
    L('(* 常時出力 *)');
    for (const c of program.continuous) {
      L(`${c.output} := ${stExpr(c.expr, '')};${c.comment ? ` (* ${c.comment} *)` : ''}`);
    }
    L('');
  }

  const driven = new Set(program.sequences.flatMap((s) => s.steps.flatMap((st) => st.outputs)));
  const continuousOut = new Set(program.continuous.map((c) => c.output));
  const undriven = outputs.map((o) => o.name).filter((n) => !driven.has(n) && !continuousOut.has(n));
  for (const n of undriven) L(`${n} := FALSE; (* 駆動するロジックなし *)`);
  if (undriven.length) L('');

  for (const seq of program.sequences) {
    const seqOuts = [...new Set(seq.steps.flatMap((s) => s.outputs))];
    L(`(* ${seq.label} *)`);
    L('IF Run AND NOT Alarm THEN');
    L(`  ${seq.id}_T(IN := TRUE, PT := T#24h);`);
    L(`  CASE ${seq.id}_Step OF`);
    for (const [i, step] of seq.steps.entries()) {
      L(`    ${i * 10}: (* ${step.id} ${step.label} *)`);
      stepLines[`${seq.id}.${step.id}`] = lines.length;
      for (const o of seqOuts) L(`      ${o} := ${step.outputs.includes(o) ? 'TRUE' : 'FALSE'};`);
      step.transitions.forEach((tr, k) => {
        L(`      ${k === 0 ? 'IF' : 'ELSIF'} ${stExpr(tr.when, seq.id)} THEN`);
        if (tr.alarm) {
          L(`        (* ${tr.alarm.message} *)`);
          L('        Alarm := TRUE;');
          L(`        AlarmCode := '${tr.alarm.code}';`);
        }
        L(`        ${seq.id}_Step := ${stepNo(seq, tr.to)};`);
        L(`        ${seq.id}_T(IN := FALSE, PT := T#24h);`);
      });
      if (step.transitions.length) L('      END_IF;');
    }
    L('  END_CASE;');
    L('END_IF;');
    L('');
  }

  L('(* フェイルセーフ: 停止中・アラーム中は全出力 OFF *)');
  L('IF NOT Run OR Alarm THEN');
  for (const o of outputs) L(`  ${o.name} := FALSE;`);
  if (!outputs.length) L('  ;');
  L('END_IF;');
  L('END_PROGRAM');

  return { code: lines.join('\n') + '\n', stepLines };
}

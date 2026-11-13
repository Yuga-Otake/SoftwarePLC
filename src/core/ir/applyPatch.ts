/**
 * applyPatch: PatchOp 列を IR に適用する純関数 (アトミック)。
 * 入力 ir は変更しない。1 件でも失敗したら元の ir・空の changes・errors を返す。
 */
import type { IRChange, PatchResult } from '../contracts';
import { SENSOR_BEFORE_STOP_M, conveyorPorts, getLibraryItem, mergeParams } from '../library';
import { conveyorPointToWorld, portWorldPosition } from './geometry';
import {
  Conveyor,
  Equipment,
  InspectionStation,
  LineIR,
  PatchOp,
  Sensor,
  Source,
  Stopper,
  Transform,
} from './schema';
import type { Assumption, LibraryItemId, Mount, Vec3 } from './schema';

type Eq = Equipment;
type Op = PatchOp;
type AnyRec = Record<string, unknown>;

class PatchError extends Error {}
const fail = (msg: string): never => {
  throw new PatchError(msg);
};

const EPS = 1e-9;

const PARAM_SCHEMAS: Record<Eq['kind'], { shape: AnyRec; safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: { path: (string | number)[]; message: string }[] } } }> = {
  conveyor: Conveyor.shape.params,
  source: Source.shape.params,
  sensor: Sensor.shape.params,
  stopper: Stopper.shape.params,
  inspection_station: InspectionStation.shape.params,
  generic: { shape: {}, safeParse: (v: unknown) => ({ success: true, data: v }) },
} as never;

const KIND_LABEL: Record<Eq['kind'], string> = {
  conveyor: 'コンベヤ',
  source: 'ワーク供給',
  sensor: 'センサ',
  stopper: 'ストッパ',
  inspection_station: '検査ステーション',
  generic: '汎用オブジェクト',
};

const PARAM_LABEL: Record<string, [string, string]> = {
  speedMps: ['搬送速度', ' m/s'],
  lengthM: ['長さ', ' m'],
  widthM: ['幅', ' m'],
  heightM: ['高さ', ' m'],
  intervalS: ['投入間隔', ' s'],
  actuationTimeS: ['動作時間', ' s'],
  inspectTimeS: ['検査時間', ' s'],
  ngRate: ['NG率', ''],
  workpiece: ['ワーク寸法', ''],
  stopperId: ['ストッパ', ''],
  sensorId: ['センサ', ''],
};

const AUTO_PREFIX: Record<LibraryItemId, string> = {
  conveyor: 'CV',
  source: 'SRC',
  sensor: 'S',
  stopper: 'STP',
  inspection_cell: 'ST',
  generic: 'OBJ',
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function pathsOverlap(a: string, b: string) {
  return a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}

function getPath(obj: unknown, path: string): { found: boolean; value?: unknown } {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(key in (cur as AnyRec))) return { found: false };
    cur = (cur as AnyRec)[key];
  }
  return { found: true, value: cur };
}

/* ───────── ドラフト操作 ───────── */

interface Ctx {
  d: LineIR;
  changes: IRChange[];
}

function find(ctx: Ctx, id: string): Eq {
  return ctx.d.equipment.find((e) => e.id === id) ?? fail(`設備 ${id} が見つかりません`);
}
const exists = (ctx: Ctx, id: string) => ctx.d.equipment.some((e) => e.id === id);

function nextNum(used: Set<string>, make: (n: number) => string[]): number {
  for (let n = 1; ; n++) if (make(n).every((id) => !used.has(id))) return n;
}

function record(ctx: Ctx, ch: IRChange) {
  const list = ctx.changes;
  const idx = list.findIndex((c) => c.equipmentId === ch.equipmentId);
  if (ch.type === 'removed') {
    if (idx >= 0) {
      const prev = list[idx];
      list.splice(idx, 1);
      if (prev.type === 'added') return; // 追加して即削除 → 正味変化なし
    }
    list.push(ch);
    return;
  }
  if (ch.type === 'updated' && idx >= 0) {
    const prev = list[idx];
    if (prev.type === 'added') return; // 追加時の要約に含める
    if (prev.type === 'updated') {
      prev.fields = [...(prev.fields ?? []), ...(ch.fields ?? [])];
      prev.summary = `${prev.summary}、${ch.summary}`;
      return;
    }
  }
  list.push(ch);
}

function usedAddresses(ctx: Ctx): Set<string> {
  const s = new Set<string>();
  for (const e of ctx.d.equipment) for (const p of e.io) if (p.address) s.add(p.address);
  return s;
}

function assignAddresses(ctx: Ctx, eq: Eq) {
  const used = usedAddresses(ctx);
  for (const p of eq.io) {
    if (p.address) continue;
    const prefix = p.dir === 'DI' ? '%IX' : '%QX';
    for (let n = 0; ; n++) {
      const a = `${prefix}${Math.floor(n / 8)}.${n % 8}`;
      if (!used.has(a)) {
        p.address = a;
        used.add(a);
        break;
      }
    }
  }
}

function checkMount(ctx: Ctx, m: Mount): Conveyor {
  const conv = ctx.d.equipment.find((e) => e.id === m.conveyorId);
  if (!conv || conv.kind !== 'conveyor') return fail(`取付先のコンベヤ ${m.conveyorId} が見つかりません`);
  if (!(m.offsetM >= 0 && m.offsetM <= conv.params.lengthM + EPS))
    return fail(`取付位置 ${m.offsetM} m が ${conv.id} の範囲 (0〜${conv.params.lengthM} m) 外です`);
  return conv;
}

function checkParamKeys(kind: Eq['kind'] | 'inspection_cell', params: AnyRec | undefined) {
  if (!params) return;
  const allowed =
    kind === 'inspection_cell'
      ? ['inspectTimeS', 'ngRate', 'actuationTimeS']
      : Object.keys(PARAM_SCHEMAS[kind].shape);
  for (const k of Object.keys(params))
    if (!allowed.includes(k)) fail(`${kind} に未知のパラメータ ${k} があります`);
}

function parseEquipment(eq: unknown): Eq {
  const r = Equipment.safeParse(eq);
  if (!r.success) {
    const id = (eq as AnyRec)?.id;
    return fail(`${id} が不正です: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
  }
  return r.data;
}

function cellOffsets(offsetM: number) {
  return { station: offsetM, stopper: offsetM, sensor: Math.max(0, offsetM - SENSOR_BEFORE_STOP_M) };
}

/** 検査ステーションの取付を設定 (ストッパ・センサも連動) */
function setStationMount(ctx: Ctx, st: InspectionStation, m: Mount): { id: string; before: Mount; after: Mount }[] {
  checkMount(ctx, m);
  const o = cellOffsets(m.offsetM);
  const out: { id: string; before: Mount; after: Mount }[] = [];
  const set = (e: Eq | undefined, off: number) => {
    if (!e || !('mount' in e)) return;
    const after = { conveyorId: m.conveyorId, offsetM: off };
    out.push({ id: e.id, before: clone(e.mount), after });
    e.mount = after;
  };
  set(st, o.station);
  set(ctx.d.equipment.find((e) => e.id === st.params.stopperId), o.stopper);
  set(ctx.d.equipment.find((e) => e.id === st.params.sensorId), o.sensor);
  return out;
}

function dropAssumptionsOf(ctx: Ctx, id: string) {
  ctx.d.assumptions = ctx.d.assumptions.filter((a) => a.equipmentId !== id);
}

function nextConnectionId(ctx: Ctx) {
  const used = new Set(ctx.d.connections.map((c) => c.id));
  return `C${nextNum(used, (n) => [`C${n}`])}`;
}

/* ───────── add ───────── */

function opAdd(ctx: Ctx, op: Extract<Op, { op: 'add' }>) {
  const item = op.item;
  const used = new Set(ctx.d.equipment.map((e) => e.id));
  const suffixes = item === 'inspection_cell' ? ['', '_STP', '_PS'] : [''];
  const id =
    op.id ?? `${AUTO_PREFIX[item]}${nextNum(used, (n) => suffixes.map((s) => `${AUTO_PREFIX[item]}${n}${s}`))}`;
  for (const s of suffixes) if (used.has(id + s)) fail(`ID ${id + s} は既に使われています`);
  checkParamKeys(item === 'inspection_cell' ? 'inspection_cell' : item, op.params);

  const built = getLibraryItem(item).build({ idPrefix: id, name: op.name, params: op.params });
  const primary = built[0];
  if (op.visual) primary.visual = clone(op.visual);
  if (op.semantics) for (const e of built) e.semantics = clone(op.semantics);

  let afterNote = '';
  if ('transform' in primary) {
    primary.transform = { ...primary.transform, ...clone(op.transform ?? {}) } as Transform;
    if (op.after !== undefined) {
      if (primary.kind !== 'conveyor') fail('after は conveyor にのみ指定できます');
      const up = find(ctx, op.after);
      if (up.kind !== 'conveyor') fail(`${op.after} はコンベヤではありません`);
      const upConv = up as Conveyor;
      if (ctx.d.connections.some((c) => c.from.equipmentId === up.id && c.from.portId === 'out'))
        fail(`${up.id} の out ポートは既に接続されています`);
      const out = conveyorPointToWorld(upConv, upConv.params.lengthM);
      primary.transform.position = [out[0], upConv.transform.position[1], out[2]];
      primary.transform.rotationYDeg = upConv.transform.rotationYDeg;
      afterNote = ` / ${up.id} の後段`;
    }
  } else {
    if (op.after !== undefined) fail('after は conveyor にのみ指定できます');
    if (!op.mount) fail(`${item} には mount (取付先コンベヤと位置) が必要です`);
    checkMount(ctx, op.mount!);
    if (primary.kind === 'inspection_station') {
      const o = cellOffsets(op.mount!.offsetM);
      for (const e of built) {
        if (!('mount' in e)) continue;
        const off = e.id === id ? o.station : e.kind === 'stopper' ? o.stopper : o.sensor;
        e.mount = { conveyorId: op.mount!.conveyorId, offsetM: off };
      }
    } else {
      primary.mount = clone(op.mount!);
    }
  }
  if (op.after !== undefined && !('transform' in primary)) fail('after は conveyor にのみ指定できます');

  const parsed: Eq[] = [];
  for (const e of built) {
    const pe = parseEquipment(e);
    ctx.d.equipment.push(pe);
    assignAddresses(ctx, pe);
    parsed.push(pe);
  }
  if (op.after !== undefined) {
    ctx.d.connections.push({
      id: nextConnectionId(ctx),
      from: { equipmentId: op.after, portId: 'out' },
      to: { equipmentId: id, portId: 'in' },
    });
  }
  for (const e of parsed) {
    let detail = '';
    if (e.kind === 'conveyor') detail = ` (長さ ${e.params.lengthM} m${afterNote})`;
    else if ('mount' in e)
      detail = ` (${e.mount.conveyorId} の ${e.mount.offsetM.toFixed(e.mount.offsetM * 10 % 1 ? 2 : 1)} m 地点)`;
    record(ctx, { type: 'added', equipmentId: e.id, summary: `${e.id} ${KIND_LABEL[e.kind]}を追加${detail}` });
  }
}

/* ───────── update ───────── */

function labelFor(path: string): [string, string] {
  if (path.startsWith('params.')) return PARAM_LABEL[path.slice(7)] ?? [path, ''];
  if (path === 'name') return ['名称', ''];
  if (path === 'transform.position') return ['位置', ''];
  if (path === 'transform.rotationYDeg') return ['回転', '°'];
  if (path === 'transform.scale') return ['スケール', ''];
  if (path === 'mount.offsetM') return ['取付位置', ' m'];
  if (path === 'mount.conveyorId') return ['取付先', ''];
  if (path === 'visual') return ['外観', ''];
  return [path, ''];
}

type Field = { path: string; before: unknown; after: unknown };

function diffGroup(prefix: string, before: AnyRec, after: AnyRec, out: Field[]) {
  for (const k of Object.keys(after))
    if (!same(before[k], after[k])) out.push({ path: `${prefix}.${k}`, before: before[k], after: after[k] });
}

function finishUpdate(ctx: Ctx, id: string, fields: Field[], extra?: string) {
  if (fields.length === 0 && !extra) return;
  ctx.d.assumptions = ctx.d.assumptions.filter(
    (a) => !(a.equipmentId === id && a.status === 'open' && fields.some((f) => pathsOverlap(f.path, a.path))),
  );
  const parts = fields.map((f) => {
    const [label, unit] = labelFor(f.path);
    return `${label} ${fmt(f.before)} → ${fmt(f.after)}${unit}`;
  });
  if (extra) parts.push(extra);
  record(ctx, { type: 'updated', equipmentId: id, fields, summary: `${id} ${parts.join('、')}` });
}

function opUpdate(ctx: Ctx, op: Extract<Op, { op: 'update' }>) {
  const eq = find(ctx, op.id);
  const fields: Field[] = [];

  if (op.name !== undefined && op.name !== eq.name) {
    fields.push({ path: 'name', before: eq.name, after: op.name });
    eq.name = op.name;
  }
  if (op.visual !== undefined && !same(op.visual, eq.visual)) {
    fields.push({ path: 'visual', before: eq.visual, after: op.visual });
    eq.visual = clone(op.visual);
  }

  if (op.params) {
    checkParamKeys(eq.kind, op.params);
    const merged = mergeParams(eq.params as AnyRec, op.params);
    const r = PARAM_SCHEMAS[eq.kind].safeParse(merged);
    if (!r.success)
      fail(`${eq.id} の params が不正です: ${r.error!.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
    const data = r.data as AnyRec;
    if (eq.kind === 'inspection_station') {
      const stp = ctx.d.equipment.find((e) => e.id === data.stopperId);
      const sns = ctx.d.equipment.find((e) => e.id === data.sensorId);
      if (stp?.kind !== 'stopper') fail(`stopperId ${data.stopperId} はストッパではありません`);
      if (sns?.kind !== 'sensor') fail(`sensorId ${data.sensorId} はセンサではありません`);
    }
    diffGroup('params', eq.params as AnyRec, data, fields);
    (eq as AnyRec).params = data;
  }

  if (op.transform) {
    if (!('transform' in eq)) fail(`${eq.id} は取付設備のため transform を持ちません (mount を使用)`);
    const t = { ...(eq as { transform: Transform }).transform, ...clone(op.transform) } as Transform;
    const r = Transform.safeParse(t);
    if (!r.success) fail(`${eq.id} の transform が不正です`);
    diffGroup('transform', (eq as { transform: Transform }).transform as unknown as AnyRec, t as unknown as AnyRec, fields);
    (eq as { transform: Transform }).transform = t;
  }

  // 長さ/高さ変更 → ポート再計算 + 取付超過チェック
  if (eq.kind === 'conveyor') {
    const c = eq as Conveyor;
    c.ports = conveyorPorts(c.params.lengthM, c.params.heightM);
    for (const m of ctx.d.equipment)
      if ('mount' in m && m.mount.conveyorId === c.id && m.mount.offsetM > c.params.lengthM + EPS)
        fail(`${m.id} の取付位置 ${m.mount.offsetM} m が新しい長さ ${c.params.lengthM} m を超えます`);
  }

  const side: { id: string; fields: Field[] }[] = [];
  if (op.mount) {
    if (!('mount' in eq)) fail(`${eq.id} は床置き設備のため mount を持ちません (transform を使用)`);
    const m = { ...(eq as { mount: Mount }).mount, ...clone(op.mount) };
    if (eq.kind === 'inspection_station') {
      const moved = setStationMount(ctx, eq as InspectionStation, m);
      for (const mv of moved) {
        const f: Field[] = [];
        diffGroup('mount', mv.before as unknown as AnyRec, mv.after as unknown as AnyRec, f);
        if (mv.id === eq.id) fields.push(...f);
        else side.push({ id: mv.id, fields: f });
      }
    } else {
      checkMount(ctx, m);
      diffGroup('mount', (eq as { mount: Mount }).mount as unknown as AnyRec, m as unknown as AnyRec, fields);
      (eq as { mount: Mount }).mount = m;
    }
  }

  parseEquipment(eq);
  finishUpdate(ctx, op.id, fields);
  for (const s of side) finishUpdate(ctx, s.id, s.fields);
}

/* ───────── remove ───────── */

function removalSet(ctx: Ctx, id: string): Set<string> {
  const target = find(ctx, id);
  const set = new Set<string>([id]);
  if (target.kind === 'conveyor')
    for (const e of ctx.d.equipment) if ('mount' in e && e.mount.conveyorId === id) set.add(e.id);
  for (const sid of [...set]) {
    const e = ctx.d.equipment.find((x) => x.id === sid);
    if (e?.kind === 'inspection_station') {
      set.add(e.params.stopperId);
      set.add(e.params.sensorId);
    }
  }
  return set;
}

function checkNotReferenced(ctx: Ctx, set: Set<string>) {
  for (const e of ctx.d.equipment)
    if (e.kind === 'inspection_station' && !set.has(e.id))
      for (const ref of [e.params.stopperId, e.params.sensorId])
        if (set.has(ref)) fail(`${ref} は検査ステーション ${e.id} が参照しているため削除できません`);
}

function opRemove(ctx: Ctx, op: Extract<Op, { op: 'remove' }>) {
  const set = removalSet(ctx, op.id);
  checkNotReferenced(ctx, set);
  for (const sid of set) {
    const e = ctx.d.equipment.find((x) => x.id === sid);
    if (!e) continue; // 既に無い参照
    ctx.d.equipment = ctx.d.equipment.filter((x) => x.id !== sid);
    ctx.d.connections = ctx.d.connections.filter((c) => c.from.equipmentId !== sid && c.to.equipmentId !== sid);
    dropAssumptionsOf(ctx, sid);
    record(ctx, {
      type: 'removed',
      equipmentId: sid,
      summary: sid === op.id ? `${sid} ${KIND_LABEL[e.kind]}を削除` : `${sid} ${KIND_LABEL[e.kind]}を削除 (${op.id} に付随)`,
    });
  }
}

/* ───────── connect / disconnect ───────── */

function opConnect(ctx: Ctx, op: Extract<Op, { op: 'connect' }>) {
  const fe = find(ctx, op.from.equipmentId);
  const te = find(ctx, op.to.equipmentId);
  if (fe.id === te.id) fail('同じ設備同士は接続できません');
  const fp = fe.ports.find((p) => p.id === op.from.portId);
  const tp = te.ports.find((p) => p.id === op.to.portId);
  if (!fp) fail(`${fe.id} にポート ${op.from.portId} がありません`);
  if (!tp) fail(`${te.id} にポート ${op.to.portId} がありません`);
  if (fp!.role !== 'out') fail(`${fe.id}.${fp!.id} は out ポートではありません`);
  if (tp!.role !== 'in') fail(`${te.id}.${tp!.id} は in ポートではありません`);
  for (const c of ctx.d.connections) {
    if (c.from.equipmentId === fe.id && c.from.portId === fp!.id) fail(`${fe.id}.${fp!.id} は既に接続されています`);
    if (c.to.equipmentId === te.id && c.to.portId === tp!.id) fail(`${te.id}.${tp!.id} は既に接続されています`);
  }
  const id = nextConnectionId(ctx);
  ctx.d.connections.push({ id, from: { ...op.from }, to: { ...op.to } });

  const fields: Field[] = [];
  if (fe.kind === 'source' && 'transform' in te) {
    const pos = portWorldPosition(te, tp!)!.map(round) as Vec3;
    const t = { ...fe.transform, position: pos, rotationYDeg: te.transform.rotationYDeg };
    diffGroup('transform', fe.transform as unknown as AnyRec, t as unknown as AnyRec, fields);
    fe.transform = t;
  }
  finishUpdate(ctx, fe.id, fields, `${fe.id}.${fp!.id} → ${te.id}.${tp!.id} を接続 (${id})`);
}

function opDisconnect(ctx: Ctx, op: Extract<Op, { op: 'disconnect' }>) {
  const c = ctx.d.connections.find((x) => x.id === op.connectionId) ?? fail(`接続 ${op.connectionId} が見つかりません`);
  ctx.d.connections = ctx.d.connections.filter((x) => x !== c);
  record(ctx, {
    type: 'updated',
    equipmentId: c.from.equipmentId,
    summary: `${c.from.equipmentId} の接続 ${c.id} (→ ${c.to.equipmentId}) を解除`,
  });
}

/* ───────── semantics ───────── */

/** transform を搬送方向へ sign * (lengthM * scale) / 2 だけ平行移動する (glb コンベヤの原点補正) */
function shiftAlongConveyor(t: Transform, lengthM: number, sign: 1 | -1) {
  const th = (t.rotationYDeg * Math.PI) / 180;
  const d = (sign * lengthM * t.scale) / 2;
  t.position = [round(t.position[0] + Math.cos(th) * d), t.position[1], round(t.position[2] - Math.sin(th) * d)];
}

function opPropose(ctx: Ctx, op: Extract<Op, { op: 'propose_semantics' }>) {
  const idx = ctx.d.equipment.findIndex((e) => e.id === op.id);
  if (idx < 0) fail(`設備 ${op.id} が見つかりません`);
  const target = ctx.d.equipment[idx];
  if (target.kind !== 'generic') fail(`${op.id} は generic ではないため意味付けを提案できません`);
  const kind = op.kind;
  checkParamKeys(kind, op.params);
  const item: LibraryItemId = kind === 'inspection_station' ? 'inspection_cell' : kind;
  const built = getLibraryItem(item).build({ idPrefix: op.id, name: target.name, params: op.params })[0] as AnyRec;
  built.name = target.name;
  built.visual = clone(target.visual);
  built.semantics = { status: 'proposed', source: op.source ?? 'ai', confidence: op.confidence, rationale: op.rationale };

  if (kind === 'sensor' || kind === 'stopper' || kind === 'inspection_station') {
    if (!op.mount) fail(`${kind} の提案には mount が必要です`);
    checkMount(ctx, op.mount!);
    built.mount = clone(op.mount!);
    delete built.transform;
    if (kind === 'inspection_station') {
      const sid = op.params?.stopperId;
      const nid = op.params?.sensorId;
      if (typeof sid !== 'string' || ctx.d.equipment.find((e) => e.id === sid)?.kind !== 'stopper')
        fail('inspection_station の提案には既存ストッパを指す params.stopperId が必要です');
      if (typeof nid !== 'string' || ctx.d.equipment.find((e) => e.id === nid)?.kind !== 'sensor')
        fail('inspection_station の提案には既存センサを指す params.sensorId が必要です');
      (built.params as AnyRec).stopperId = sid;
      (built.params as AnyRec).sensorId = nid;
    }
  } else {
    built.transform = clone((target as { transform: Transform }).transform);
    // glb の generic は原点が外形の中心、コンベヤは搬入端。見た目が飛ばないよう原点を搬入端側へずらす
    if (kind === 'conveyor' && target.visual.type === 'glb') {
      shiftAlongConveyor(built.transform as Transform, Number((built.params as AnyRec).lengthM), -1);
    }
  }
  const eq = parseEquipment(built);
  ctx.d.equipment[idx] = eq;
  assignAddresses(ctx, eq);
  record(ctx, {
    type: 'updated',
    equipmentId: op.id,
    fields: [{ path: 'kind', before: 'generic', after: kind }],
    summary: `${op.id} を ${KIND_LABEL[eq.kind]} として提案 (確信度 ${op.confidence}) — 未確認のため動作しません`,
  });
}

function opConfirm(ctx: Ctx, op: Extract<Op, { op: 'confirm_semantics' }>) {
  const eq = find(ctx, op.id);
  if (eq.semantics.status === 'confirmed') return;
  const before = eq.semantics.status;
  eq.semantics = { ...eq.semantics, status: 'confirmed' };
  record(ctx, {
    type: 'updated',
    equipmentId: op.id,
    fields: [{ path: 'semantics.status', before, after: 'confirmed' }],
    summary: `${op.id} を ${KIND_LABEL[eq.kind]} として確認`,
  });
}

function opReject(ctx: Ctx, op: Extract<Op, { op: 'reject_semantics' }>) {
  const idx = ctx.d.equipment.findIndex((e) => e.id === op.id);
  if (idx < 0) fail(`設備 ${op.id} が見つかりません`);
  const eq = ctx.d.equipment[idx];
  if (eq.semantics.status !== 'proposed') fail(`${op.id} は提案中ではありません`);
  checkNotReferenced(ctx, new Set([op.id]));
  if (eq.kind === 'conveyor' && ctx.d.equipment.some((e) => 'mount' in e && e.mount.conveyorId === op.id))
    fail(`${op.id} には取付設備があるため却下できません`);
  let transform: Transform;
  if ('transform' in eq) transform = clone(eq.transform);
  else {
    const conv = ctx.d.equipment.find((e) => e.id === eq.mount.conveyorId);
    const pos = conv && conv.kind === 'conveyor' ? conveyorPointToWorld(conv, eq.mount.offsetM) : ([0, 0, 0] as Vec3);
    transform = { position: pos, rotationYDeg: conv && 'transform' in conv ? conv.transform.rotationYDeg : 0, scale: 1 };
  }
  if (eq.kind === 'conveyor' && eq.visual.type === 'glb') shiftAlongConveyor(transform, eq.params.lengthM, 1);
  const generic = parseEquipment({
    kind: 'generic',
    id: eq.id,
    name: eq.name,
    semantics: { status: 'confirmed', source: 'user' },
    visual: clone(eq.visual),
    io: [],
    axes: [],
    ports: [],
    transform,
    params: {},
  });
  const prevKind = eq.kind;
  ctx.d.equipment[idx] = generic;
  ctx.d.connections = ctx.d.connections.filter((c) => c.from.equipmentId !== op.id && c.to.equipmentId !== op.id);
  dropAssumptionsOf(ctx, op.id);
  record(ctx, {
    type: 'updated',
    equipmentId: op.id,
    fields: [{ path: 'kind', before: prevKind, after: 'generic' }],
    summary: `${op.id} の ${KIND_LABEL[prevKind]} 提案を却下 (汎用オブジェクトに戻す)`,
  });
}

/* ───────── assumptions ───────── */

function opAssume(ctx: Ctx, op: Extract<Op, { op: 'assume' }>) {
  const eq = find(ctx, op.equipmentId);
  const r = getPath(eq, op.path);
  if (!r.found) fail(`${op.equipmentId} に ${op.path} がありません`);
  if (ctx.d.assumptions.some((a) => a.equipmentId === eq.id && a.path === op.path))
    fail(`${eq.id} の ${op.path} は既に仮定として記録されています`);
  const used = new Set(ctx.d.assumptions.map((a) => a.id));
  const a: Assumption = {
    id: `A${nextNum(used, (n) => [`A${n}`])}`,
    equipmentId: eq.id,
    path: op.path,
    value: clone(r.value),
    rationale: op.rationale,
    status: 'open',
  };
  ctx.d.assumptions.push(a);
  const [label, unit] = labelFor(op.path);
  record(ctx, {
    type: 'updated',
    equipmentId: eq.id,
    summary: `${eq.id} ${label} ${fmt(a.value)}${unit} を仮定として記録 (${a.id}): ${op.rationale}`,
  });
}

function opAccept(ctx: Ctx, op: Extract<Op, { op: 'accept_assumption' }>) {
  const a = ctx.d.assumptions.find((x) => x.id === op.id) ?? fail(`仮定 ${op.id} が見つかりません`);
  a.status = 'accepted';
  record(ctx, { type: 'updated', equipmentId: a.equipmentId, summary: `${a.equipmentId} の仮定 ${a.id} (${a.path}) を承認` });
}

/* ───────── エントリポイント ───────── */

export function applyPatch(ir: LineIR, ops: PatchOp[]): PatchResult {
  const ctx: Ctx = { d: clone(ir), changes: [] };
  const errors: string[] = [];
  try {
    ops.forEach((raw, i) => {
      const p = PatchOp.safeParse(raw);
      if (!p.success) {
        errors.push(`操作 ${i + 1}: 形式が不正です (${p.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join(', ')})`);
        throw new PatchError('');
      }
      const op = p.data;
      try {
        switch (op.op) {
          case 'add': opAdd(ctx, op); break;
          case 'update': opUpdate(ctx, op); break;
          case 'remove': opRemove(ctx, op); break;
          case 'connect': opConnect(ctx, op); break;
          case 'disconnect': opDisconnect(ctx, op); break;
          case 'propose_semantics': opPropose(ctx, op); break;
          case 'confirm_semantics': opConfirm(ctx, op); break;
          case 'reject_semantics': opReject(ctx, op); break;
          case 'assume': opAssume(ctx, op); break;
          case 'accept_assumption': opAccept(ctx, op); break;
          case 'rename_line': ctx.d.name = op.name; break;
        }
      } catch (e) {
        if (e instanceof PatchError) {
          errors.push(`操作 ${i + 1} (${op.op}): ${e.message}`);
          throw new PatchError('');
        }
        throw e;
      }
    });
  } catch (e) {
    if (!(e instanceof PatchError)) throw e;
  }
  if (errors.length === 0) {
    const r = LineIR.safeParse(ctx.d);
    if (!r.success) errors.push(`IR が不正です: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
    else return { ir: r.data, changes: ctx.changes, errors: [] };
  }
  return { ir, changes: [], errors };
}


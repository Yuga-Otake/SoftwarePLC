/**
 * デモ用の定型文インタプリタ。AI ではない: 限られた日本語の言い回しを正規表現で解釈し、
 * 節ごとに applyPatch で検証しながら PatchOp を組み立てる (決定的)。
 */
import type { AIProposal, AIProvider } from '../contracts';
import { applyPatch } from '../ir';
import type { Conveyor, Equipment, InspectionStation, LineIR, PatchOp } from '../ir';
import { DEFAULTS } from '../library';

const NUM = '(\\d+(?:\\.\\d+)?)';
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const D = DEFAULTS;

class Unsupported extends Error {}
const bad = (m: string): never => {
  throw new Unsupported(m);
};

interface Built {
  ops: PatchOp[];
  summary: string;
}
type Rule = (c: string, ir: LineIR) => Built | null;

/* ───────── 解析ヘルパ ───────── */

const POS_WORDS = '(?:の)?\\s*(?:地点|位置|所|ところ|付近|あたり)';
const MID_RE = /真ん中|真中|中央|中間|まんなか/;

function normalize(t: string): string {
  return t.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 「N m 地点」ではない長さ指定 (メートル) */
function findLength(c: string): number | null {
  const re = new RegExp(`${NUM}\\s*(?:メートル|m(?![/a-zA-Z]))`, 'g');
  for (const m of c.matchAll(re)) {
    const after = c.slice((m.index ?? 0) + m[0].length);
    if (new RegExp(`^\\s*${POS_WORDS}`).test(after)) continue;
    return parseFloat(m[1]);
  }
  return null;
}

type Pos = { kind: 'at'; m: number } | { kind: 'mid' } | null;
function findPosition(c: string): Pos {
  const at = c.match(new RegExp(`${NUM}\\s*(?:メートル|m(?![/a-zA-Z]))\\s*${POS_WORDS}`));
  if (at) return { kind: 'at', m: parseFloat(at[1]) };
  if (MID_RE.test(c)) return { kind: 'mid' };
  return null;
}

/** kw (正規表現ソース) の前後にある「N秒」 */
function secondsFor(c: string, kw: string): number | null {
  const a = c.match(new RegExp(`${NUM}\\s*秒(?:間)?[^\\d]{0,6}?${kw}`));
  if (a) return parseFloat(a[1]);
  const b = c.match(new RegExp(`${kw}[^\\d]{0,12}?${NUM}\\s*秒`));
  return b ? parseFloat(b[1]) : null;
}

function findNgRate(c: string): number | null {
  const m = c.match(new RegExp(`(?:NG|ng|Ng)\\s*率[^\\d]*?${NUM}\\s*(%|パーセント|割)?`));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2];
  let r: number;
  if (unit === '割') r = v / 10;
  else if (unit) r = v / 100;
  else r = v > 1 ? v / 100 : v;
  if (!(r >= 0 && r <= 1)) return bad(`NG率 ${m[1]} は 0〜100% の範囲で指定してください`);
  return r4(r);
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function mentionedIds(c: string, ir: LineIR): string[] {
  const byUpper = new Map(ir.equipment.map((e) => [e.id.toUpperCase(), e.id]));
  const found = c.match(/[A-Za-z]+\d+(?:_[A-Za-z]+)?/g) ?? [];
  return [...new Set(found.map((x) => byUpper.get(x.toUpperCase())).filter((x): x is string => !!x))];
}

const ofKind = <K extends Equipment['kind']>(ir: LineIR, kind: K) =>
  ir.equipment.filter((e): e is Extract<Equipment, { kind: K }> => e.kind === kind);

function pick<K extends Equipment['kind']>(c: string, ir: LineIR, kind: K, label: string) {
  const all = ofKind(ir, kind);
  const ids = mentionedIds(c, ir);
  const hit = all.find((e) => ids.includes(e.id));
  return hit ?? all[0] ?? bad(`${label}がありません`);
}

function pickAll(c: string, ir: LineIR, kind: 'conveyor') {
  const all = ofKind(ir, kind);
  const ids = mentionedIds(c, ir);
  const hit = all.filter((e) => ids.includes(e.id));
  if (!all.length) return bad('コンベヤがありません');
  return hit.length ? hit : all;
}

function nextId(ir: LineIR, prefix: string): string {
  const used = new Set(ir.equipment.map((e) => e.id));
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (![id, `${id}_STP`, `${id}_PS`].some((x) => used.has(x))) return id;
  }
}

const assume = (equipmentId: string, path: string, rationale: string): PatchOp => ({
  op: 'assume',
  equipmentId,
  path,
  rationale,
});

/* ───────── 新規ライン作成 ───────── */

function buildCreate(t: string): Built {
  const len = findLength(t);
  const lengthM = len ?? D.conveyor.lengthM;
  const withStation = /検査/.test(t);
  const speed = t.match(new RegExp(`${NUM}\\s*m/s`));
  const interval = secondsFor(t, '(?:供給|投入|間隔)') ?? (t.match(new RegExp(`${NUM}\\s*秒(?:ごと|おき|毎)`))?.[1] ?? null);
  const intervalS = interval === null ? null : Number(interval);
  const ng = findNgRate(t);
  const ops: PatchOp[] = [];
  const asm: PatchOp[] = [];

  const cvParams: Record<string, unknown> = {};
  if (len !== null) cvParams.lengthM = len;
  if (speed) cvParams.speedMps = parseFloat(speed[1]);
  ops.push({ op: 'add', item: 'conveyor', id: 'CV1', ...(Object.keys(cvParams).length ? { params: cvParams } : {}) });
  ops.push({
    op: 'add',
    item: 'source',
    id: 'SRC1',
    ...(intervalS !== null ? { params: { intervalS } } : {}),
  });
  ops.push({ op: 'connect', from: { equipmentId: 'SRC1', portId: 'out' }, to: { equipmentId: 'CV1', portId: 'in' } });

  if (len === null) asm.push(assume('CV1', 'params.lengthM', `長さの指定がなかったため標準値 ${D.conveyor.lengthM} m`));
  if (!speed) asm.push(assume('CV1', 'params.speedMps', `搬送速度の指定がなかったため標準値 ${D.conveyor.speedMps} m/s`));
  if (intervalS === null) asm.push(assume('SRC1', 'params.intervalS', `投入間隔の指定がなかったため標準値 ${D.source.intervalS} 秒`));

  let summary = `コンベヤ CV1 (${lengthM} m)・ワーク供給 SRC1`;
  if (withStation) {
    const pos = findPosition(t);
    const offsetM = pos?.kind === 'at' ? pos.m : r3(lengthM / 2);
    const inspect = secondsFor(t, '検査');
    const stParams: Record<string, unknown> = {};
    if (inspect !== null) stParams.inspectTimeS = inspect;
    if (ng !== null) stParams.ngRate = ng;
    ops.push({
      op: 'add',
      item: 'inspection_cell',
      id: 'ST1',
      mount: { conveyorId: 'CV1', offsetM },
      ...(Object.keys(stParams).length ? { params: stParams } : {}),
    });
    if (inspect === null)
      asm.push(assume('ST1', 'params.inspectTimeS', `検査時間の指定がなかったため標準値 ${D.inspection_station.inspectTimeS} 秒`));
    if (ng === null)
      asm.push(assume('ST1', 'params.ngRate', `NG率の指定がなかったため標準値 ${D.inspection_station.ngRate * 100}%`));
    if (!pos) asm.push(assume('ST1', 'mount.offsetM', `位置の指定がなかったためコンベヤの中央 (${offsetM} m)`));
    summary += `・検査ステーション ST1 (${offsetM} m 地点, ${inspect ?? D.inspection_station.inspectTimeS} 秒)`;
  }
  return { ops: [...ops, ...asm], summary: `${summary} を追加` };
}

/* ───────── 既存ラインへの変更ルール ───────── */

const REMOVE_VERB = /(削除|消して|消す|消去|撤去|外して)/;

const ruleRemove: Rule = (c, ir) => {
  if (!REMOVE_VERB.test(c)) return null;
  let ids = mentionedIds(c, ir);
  if (!ids.length && /検査/.test(c)) {
    const st = ofKind(ir, 'inspection_station')[0];
    if (!st) return bad('検査ステーションがありません');
    ids = [st.id];
  }
  if (!ids.length) return null;
  // 検査ステーション指定時の付随設備 (ID 指定が重複したもの) は除く
  const children = new Set<string>();
  for (const id of ids) {
    const e = ir.equipment.find((x) => x.id === id);
    if (e?.kind === 'inspection_station') {
      children.add(e.params.stopperId);
      children.add(e.params.sensorId);
    }
  }
  ids = ids.filter((id) => !children.has(id));
  return { ops: ids.map((id) => ({ op: 'remove', id }) as PatchOp), summary: `${ids.join('・')} を削除` };
};

const ruleAddSensor: Rule = (c, ir) => {
  if (!/センサ(?:を|も|の)?\s*(?:もう\s*[1一]\s*台\s*)?(?:追加|足し|増や|付け|取り付け)/.test(c)) return null;
  const convs = ofKind(ir, 'conveyor');
  if (!convs.length) return bad('コンベヤがありません');
  const conv = convs.find((x) => mentionedIds(c, ir).includes(x.id)) ?? convs[0];
  const pos = findPosition(c);
  const offsetM = pos?.kind === 'at' ? pos.m : r3(conv.params.lengthM / 2);
  const id = nextId(ir, 'S');
  const ops: PatchOp[] = [{ op: 'add', item: 'sensor', id, mount: { conveyorId: conv.id, offsetM } }];
  if (!pos) ops.push(assume(id, 'mount.offsetM', `位置の指定がなかったため ${conv.id} の中央 (${offsetM} m)`));
  return { ops, summary: `センサ ${id} を ${conv.id} の ${offsetM} m 地点に追加` };
};

const ruleAddStation: Rule = (c, ir) => {
  if (!/検査(?:ステーション|セル|工程|機)?(?:を|も|の)?\s*(?:もう\s*[1一]\s*台|追加|増や|足し)/.test(c)) return null;
  const convs = ofKind(ir, 'conveyor');
  if (!convs.length) return bad('コンベヤがありません');
  const stationConvs = new Set(ofKind(ir, 'inspection_station').map((s) => s.mount.conveyorId));
  const explicit = convs.find((x) => mentionedIds(c, ir).includes(x.id));
  const conv = explicit ?? [...convs].reverse().find((x) => !stationConvs.has(x.id)) ?? convs[convs.length - 1];
  const len = conv.params.lengthM;
  const pos = findPosition(c);
  let offsetM: number;
  if (pos?.kind === 'at') offsetM = pos.m;
  else if (pos?.kind === 'mid' || !stationConvs.has(conv.id)) offsetM = r3(len / 2);
  else {
    const taken = ir.equipment.flatMap((e) => ('mount' in e && e.mount.conveyorId === conv.id ? [e.mount.offsetM] : []));
    const cand = [0.8, 0.2, 0.65, 0.35].map((f) => r3(len * f)).find((o) => taken.every((t) => Math.abs(t - o) >= 0.3));
    offsetM = cand ?? bad(`${conv.id} に検査ステーションを置ける空き位置が見つかりません。「N m 地点」で位置を指定してください`);
  }
  const inspect = secondsFor(c, '検査');
  const ng = findNgRate(c);
  const id = nextId(ir, 'ST');
  const params: Record<string, unknown> = {};
  if (inspect !== null) params.inspectTimeS = inspect;
  if (ng !== null) params.ngRate = ng;
  const ops: PatchOp[] = [
    {
      op: 'add',
      item: 'inspection_cell',
      id,
      mount: { conveyorId: conv.id, offsetM },
      ...(Object.keys(params).length ? { params } : {}),
    },
  ];
  if (inspect === null)
    ops.push(assume(id, 'params.inspectTimeS', `検査時間の指定がなかったため標準値 ${D.inspection_station.inspectTimeS} 秒`));
  if (ng === null) ops.push(assume(id, 'params.ngRate', `NG率の指定がなかったため標準値 ${D.inspection_station.ngRate * 100}%`));
  if (!pos)
    ops.push(
      assume(
        id,
        'mount.offsetM',
        stationConvs.has(conv.id) ? `位置の指定がなかったため ${conv.id} の空いている位置` : `位置の指定がなかったため検査のないコンベヤ ${conv.id} の中央`,
      ),
    );
  return { ops, summary: `検査ステーション ${id} を ${conv.id} の ${offsetM} m 地点に追加` };
};

const ruleAddConveyor: Rule = (c, ir) => {
  if (!/コンベヤ(?:を|も|に)?\s*(?:\d+(?:\.\d+)?\s*(?:メートル|m)(?:分|ほど)?\s*)?(?:もう\s*[1一]\s*台\s*)?(?:追加|延長|つなげ|繋げ|つなぐ|繋ぐ|増や|足し|連結|接続)/.test(c)) return null;
  const convs = ofKind(ir, 'conveyor');
  if (!convs.length) return bad('コンベヤがありません');
  const free = (x: Conveyor) => !ir.connections.some((k) => k.from.equipmentId === x.id && k.from.portId === 'out');
  const ids = mentionedIds(c, ir);
  const up = convs.find((x) => ids.includes(x.id) && free(x)) ?? [...convs].reverse().find(free);
  if (!up) return bad('搬出側が空いているコンベヤがありません');
  const len = findLength(c);
  const id = nextId(ir, 'CV');
  const ops: PatchOp[] = [
    {
      op: 'add',
      item: 'conveyor',
      id,
      after: up.id,
      params: { ...(len !== null ? { lengthM: len } : {}), speedMps: up.params.speedMps },
    },
  ];
  if (len === null) ops.push(assume(id, 'params.lengthM', `長さの指定がなかったため標準値 ${D.conveyor.lengthM} m`));
  ops.push(assume(id, 'params.speedMps', `速度の指定がなかったため上流の ${up.id} と同じ ${up.params.speedMps} m/s`));
  return { ops, summary: `コンベヤ ${id} (${len ?? D.conveyor.lengthM} m) を ${up.id} の後段に追加` };
};

const ruleStopper: Rule = (c, ir) => {
  if (!/ストッパ/.test(c)) return null;
  const t = secondsFor(c, 'ストッパ');
  if (t === null) return null;
  const stations = ofKind(ir, 'inspection_station');
  const ids = mentionedIds(c, ir);
  const viaStation = stations.find((s) => ids.includes(s.id));
  const stoppers = ofKind(ir, 'stopper');
  const stp = (viaStation && stoppers.find((s) => s.id === viaStation.params.stopperId)) ?? pick(c, ir, 'stopper', 'ストッパ');
  return { ops: [{ op: 'update', id: stp.id, params: { actuationTimeS: t } }], summary: `${stp.id} の動作時間を ${t} 秒に変更` };
};

const ruleNgRate: Rule = (c, ir) => {
  const r = findNgRate(c);
  if (r === null) return null;
  const st = pick(c, ir, 'inspection_station', '検査ステーション');
  return { ops: [{ op: 'update', id: st.id, params: { ngRate: r } }], summary: `${st.id} のNG率を ${r * 100}% に変更` };
};

const ruleSpeedMult: Rule = (c, ir) => {
  const m = c.match(new RegExp(`(?:コンベヤ|コンベア|搬送|速度|スピード|速)[^\\d]*?${NUM}\\s*倍`)) ?? c.match(new RegExp(`${NUM}\\s*倍速`));
  if (!m) return null;
  const f = parseFloat(m[1]);
  if (!(f > 0)) return bad('倍率は 0 より大きい数で指定してください');
  const targets = pickAll(c, ir, 'conveyor');
  return {
    ops: targets.map((cv) => ({ op: 'update', id: cv.id, params: { speedMps: r3(cv.params.speedMps * f) } }) as PatchOp),
    summary: `コンベヤ速度を ${f} 倍 (${targets.map((cv) => `${cv.id}: ${cv.params.speedMps} → ${r3(cv.params.speedMps * f)} m/s`).join(', ')})`,
  };
};

const ruleSpeedAbs: Rule = (c, ir) => {
  const m = c.match(new RegExp(`(?:速度|スピード|搬送)[^\\d]*?${NUM}\\s*(?:m/s|メートル毎秒|m毎秒|メートル/秒)`));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const targets = pickAll(c, ir, 'conveyor');
  return {
    ops: targets.map((cv) => ({ op: 'update', id: cv.id, params: { speedMps: v } }) as PatchOp),
    summary: `${targets.map((cv) => cv.id).join('・')} の速度を ${v} m/s に変更`,
  };
};

const ruleInterval: Rule = (c, ir) => {
  const t = secondsFor(c, '(?:供給|投入|間隔)');
  if (t === null) return null;
  const src = pick(c, ir, 'source', 'ワーク供給');
  return { ops: [{ op: 'update', id: src.id, params: { intervalS: t } }], summary: `${src.id} の投入間隔を ${t} 秒に変更` };
};

const ruleInspectTime: Rule = (c, ir) => {
  if (!/検査/.test(c)) return null;
  const t = secondsFor(c, '検査');
  if (t === null) return null;
  const st = pick(c, ir, 'inspection_station', '検査ステーション') as InspectionStation;
  return { ops: [{ op: 'update', id: st.id, params: { inspectTimeS: t } }], summary: `${st.id} の検査時間を ${t} 秒に変更` };
};

const ruleConvLength: Rule = (c, ir) => {
  if (!/コンベヤ|コンベア|長さ/.test(c)) return null;
  const len = findLength(c);
  if (len === null) return null;
  const cv = pick(c, ir, 'conveyor', 'コンベヤ');
  return { ops: [{ op: 'update', id: cv.id, params: { lengthM: len } }], summary: `${cv.id} の長さを ${len} m に変更` };
};

const RULES: Rule[] = [
  ruleRemove,
  ruleAddSensor,
  ruleAddStation,
  ruleAddConveyor,
  ruleStopper,
  ruleNgRate,
  ruleSpeedMult,
  ruleSpeedAbs,
  ruleInterval,
  ruleInspectTime,
  ruleConvLength,
];

/* ───────── 本体 ───────── */

const RENAME_RE = /(?:名前|名称|ライン名)を?\s*[「『"'](.+?)[」』"']\s*に/;
const CREATE_VERB = /(作って|作る|作成|つくって|建てて|生成|構築|組んで)/;
const FOOTER = '※デモモード: 決まった言い回しを解釈した結果です (AI ではありません)。';

const PARAM_LABEL: Record<string, string> = {
  'params.speedMps': '搬送速度',
  'params.lengthM': '長さ',
  'params.intervalS': '投入間隔',
  'params.ngRate': 'NG率',
  'params.inspectTimeS': '検査時間',
  'params.actuationTimeS': '動作時間',
  'mount.offsetM': '取付位置',
};
const fmtValue = (path: string, v: unknown) => {
  if (path === 'params.ngRate') return `${r4(Number(v) * 100)}%`;
  const unit = path.endsWith('Mps') ? ' m/s' : path.endsWith('S') ? ' 秒' : path.endsWith('M') ? ' m' : '';
  return `${v}${unit}`;
};

function splitClauses(t: string): string[] {
  return t
    .replace(/(ください|下さい|お願いします|お願い|ほしい|欲しい|くれ(?:ない)?)/g, '')
    .split(/[、。，,！!？?\n]+|(?<=して)(?=.)/)
    .map((s) => s.trim().replace(/^(そして|さらに|あと|それと|また|それから)\s*/, ''))
    .filter((s) => s.length >= 2 && !/^(して|やって|おいて)$/.test(s));
}

const FALLBACK = `デモモードでは、決まった言い回しだけ理解できます。例:
・2メートルのコンベヤで箱を流して、真ん中で2秒検査するラインを作って
・検査を1.5秒にして、コンベヤを1.5倍速にして
・NG率を20%にして
・センサを追加して
・検査ステーションをもう1台追加して
APIキーを接続すると、自由な文章で依頼できます。`;

export function createDemoProvider(): AIProvider {
  return {
    id: 'demo',
    label: 'デモモード（定型文のみ）',
    async propose({ ir, message }): Promise<AIProposal> {
      let t = normalize(message);
      const hasConv = ir.equipment.some((e) => e.kind === 'conveyor');
      const mentionsConv = /コンベヤ|コンベア/.test(t);
      const createIntent =
        CREATE_VERB.test(t) && /(ライン|コンベヤ|コンベア)/.test(t) && !/(追加|延長|増や|足し)/.test(t);

      if (hasConv && createIntent)
        return {
          reply: `すでにラインがあります。作り直す場合は「新規」でリセットしてから依頼してください。\n${FOOTER}`,
          ops: [],
        };

      let rename: string | null = null;
      const rm = t.match(RENAME_RE);
      if (rm) {
        rename = rm[1];
        t = t.replace(RENAME_RE, ' ');
      }

      const accepted: PatchOp[] = [];
      const summaries: string[] = [];
      const dropped: string[] = [];
      const unmatched: string[] = [];
      let cur = ir;

      const tryApply = (label: string, b: Built) => {
        const r = applyPatch(cur, b.ops);
        if (r.errors.length) {
          dropped.push(`「${label}」: ${r.errors[0]}`);
          return;
        }
        cur = r.ir;
        accepted.push(...b.ops);
        summaries.push(b.summary);
      };

      const wantsCreate = !hasConv && (mentionsConv || (createIntent && /ライン/.test(t)));
      if (wantsCreate) {
        tryApply(t.trim(), buildCreate(t));
      } else {
        for (const clause of splitClauses(t)) {
          try {
            let built: Built | null = null;
            for (const rule of RULES) {
              built = rule(clause, cur);
              if (built) break;
            }
            if (built) tryApply(clause, built);
            else unmatched.push(clause);
          } catch (e) {
            if (e instanceof Unsupported) dropped.push(`「${clause}」: ${e.message}`);
            else throw e;
          }
        }
      }
      if (rename !== null) tryApply(`名前を「${rename}」に`, { ops: [{ op: 'rename_line', name: rename }], summary: `ライン名を「${rename}」に変更` });

      if (!accepted.length && !dropped.length) {
        return { reply: `${FALLBACK}\n${FOOTER}`, ops: [] };
      }

      const lines: string[] = [];
      if (summaries.length) lines.push('提案:', ...summaries.map((s) => `・${s}`));
      const assumed = accepted.filter((o): o is Extract<PatchOp, { op: 'assume' }> => o.op === 'assume');
      const assumedLines = assumed.flatMap((o) => {
        const a = cur.assumptions.find((x) => x.equipmentId === o.equipmentId && x.path === o.path);
        return a ? [`・${o.equipmentId} ${PARAM_LABEL[o.path] ?? o.path} ${fmtValue(o.path, a.value)} (${o.rationale})`] : [];
      });
      if (assumedLines.length) lines.push('仮定した値 (要確認):', ...assumedLines);
      if (dropped.length) lines.push('適用できなかった指示:', ...dropped.map((d) => `・${d}`));
      if (unmatched.length) lines.push(`解釈できなかった部分: ${unmatched.map((u) => `「${u}」`).join('')}`);
      lines.push(FOOTER);
      return { reply: lines.join('\n'), ops: accepted };
    },
  };
}

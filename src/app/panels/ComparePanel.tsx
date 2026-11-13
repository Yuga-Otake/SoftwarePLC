import { useMemo, useState } from 'react';
import { compare } from '@core/compare';
import type { CompareResult, Metrics } from '@core/contracts';
import type { Equipment, LineIR } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { Section } from './ui';

/* ───────── IR 差分 (パラメータ) ───────── */

const PARAM_LABEL: Record<string, { label: string; unit?: string }> = {
  lengthM: { label: '長さ', unit: 'm' },
  widthM: { label: '幅', unit: 'm' },
  heightM: { label: '高さ', unit: 'm' },
  speedMps: { label: '搬送速度', unit: 'm/s' },
  intervalS: { label: '供給間隔', unit: 's' },
  inspectTimeS: { label: '検査時間', unit: 's' },
  ngRate: { label: 'NG率' },
  actuationTimeS: { label: '動作時間', unit: 's' },
  stopperId: { label: 'ストッパ' },
  sensorId: { label: 'センサ' },
};

function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = o;
  return out;
}

const num = (v: unknown) => (typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v));

function paramLabel(path: string): { label: string; unit?: string } {
  const key = path.split('.').pop() ?? path;
  const base = PARAM_LABEL[key] ?? { label: key };
  if (path.startsWith('workpiece.')) return { label: `ワーク${base.label}`, unit: base.unit };
  return base;
}

export function diffIr(before: LineIR, after: LineIR): string[] {
  const out: string[] = [];
  const bm = new Map(before.equipment.map((e) => [e.id, e]));
  const am = new Map(after.equipment.map((e) => [e.id, e]));
  for (const e of after.equipment) if (!bm.has(e.id)) out.push(`${e.id} を追加`);
  for (const e of before.equipment) if (!am.has(e.id)) out.push(`${e.id} を削除`);
  for (const a of after.equipment) {
    const b = bm.get(a.id) as Equipment | undefined;
    if (!b) continue;
    if (b.name !== a.name) out.push(`${a.id} 名称 ${b.name} → ${a.name}`);
    if (b.kind !== a.kind) out.push(`${a.id} 種別 ${b.kind} → ${a.kind}`);
    if (b.semantics.status !== a.semantics.status)
      out.push(`${a.id} 状態 ${b.semantics.status === 'confirmed' ? '確定' : '提案中'} → ${a.semantics.status === 'confirmed' ? '確定' : '提案中'}`);
    const pb = flatten(b.params);
    const pa = flatten(a.params);
    for (const k of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
      if (pb[k] === pa[k]) continue;
      const { label, unit } = paramLabel(k);
      out.push(`${a.id} ${label} ${num(pb[k])} → ${num(pa[k])}${unit ? ` ${unit}` : ''}`);
    }
    if ('mount' in a && 'mount' in b) {
      if (a.mount.conveyorId !== b.mount.conveyorId) out.push(`${a.id} 取付先 ${b.mount.conveyorId} → ${a.mount.conveyorId}`);
      if (a.mount.offsetM !== b.mount.offsetM) out.push(`${a.id} 取付位置 ${num(b.mount.offsetM)} → ${num(a.mount.offsetM)} m`);
    }
    if ('transform' in a && 'transform' in b) {
      const ta = a.transform;
      const tb = b.transform;
      if (ta.position.some((v, i) => v !== tb.position[i]))
        out.push(`${a.id} 位置 (${tb.position.map(num).join(', ')}) → (${ta.position.map(num).join(', ')})`);
      if (ta.rotationYDeg !== tb.rotationYDeg) out.push(`${a.id} 向き ${num(tb.rotationYDeg)} → ${num(ta.rotationYDeg)}°`);
      if (ta.scale !== tb.scale) out.push(`${a.id} スケール ${num(tb.scale)} → ${num(ta.scale)}`);
    }
  }
  const cs = (ir: LineIR) => new Set(ir.connections.map((c) => `${c.from.equipmentId}.${c.from.portId}→${c.to.equipmentId}.${c.to.portId}`));
  const cb = cs(before);
  const ca = cs(after);
  for (const c of ca) if (!cb.has(c)) out.push(`接続を追加: ${c}`);
  for (const c of cb) if (!ca.has(c)) out.push(`接続を削除: ${c}`);
  return out;
}

/** 基準の 1 行要約 */
function digest(ir: LineIR): string {
  const parts: string[] = [];
  for (const e of ir.equipment) {
    if (e.kind === 'conveyor') parts.push(`${e.id} ${num(e.params.lengthM)}m・${num(e.params.speedMps)}m/s`);
    else if (e.kind === 'inspection_station') parts.push(`${e.id} 検査${num(e.params.inspectTimeS)}s`);
    else if (e.kind === 'source') parts.push(`${e.id} 供給${num(e.params.intervalS)}s`);
  }
  return parts.join(' / ') || '設備なし';
}

const fmtAt = (t: number | null) =>
  t === null
    ? ''
    : new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ───────── 結果表 ───────── */

interface Row {
  label: string;
  key: keyof Metrics;
  unit: string;
  d: number;
  better: 'lower' | 'higher' | 'none';
}
const ROWS: Row[] = [
  { label: 'サイクルタイム', key: 'avgCycleTimeS', unit: 's/個', d: 2, better: 'lower' },
  { label: 'スループット', key: 'throughputPerMin', unit: '個/分', d: 1, better: 'higher' },
  { label: '完成数', key: 'completed', unit: '個', d: 0, better: 'higher' },
  { label: 'OK', key: 'ok', unit: '', d: 0, better: 'higher' },
  { label: 'NG', key: 'ng', unit: '', d: 0, better: 'none' },
  { label: 'リードタイム', key: 'avgLeadTimeS', unit: 's', d: 1, better: 'lower' },
];

const val = (m: Metrics, r: Row) => {
  const v = m[r.key] as number | null;
  return v === null ? '—' : v.toFixed(r.d);
};

function Delta({ before, after, better }: { before: number | null; after: number | null; better: Row['better'] }) {
  if (before === null || after === null || before === 0) return <span className="muted">—</span>;
  const p = ((after - before) / before) * 100;
  if (Math.abs(p) < 0.05) return <span className="muted">±0%</span>;
  if (better === 'none') return <span className="muted">{p > 0 ? '▲ +' : '▼ −'}{Math.abs(p).toFixed(0)}%</span>;
  const good = better === 'lower' ? p < 0 : p > 0;
  return (
    <span className={good ? 'delta good' : 'delta bad'}>
      {p > 0 ? '▲' : '▼'} {p > 0 ? '+' : '−'}
      {Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%
    </span>
  );
}

function summary(r: CompareResult): string {
  const b = r.before.avgCycleTimeS;
  const a = r.after.avgCycleTimeS;
  const pct = r.delta.cycleTimePct;
  if (b === null || a === null || pct === null) return 'サイクルタイムを比較できません（計測できる完成数が不足しています）。';
  const p = Math.round(Math.abs(pct) * 100);
  if (p === 0) return `サイクルタイムは ${b.toFixed(2)} s のまま変わりません。`;
  const sign = pct < 0 ? '−' : '+';
  return `サイクルタイムが ${b.toFixed(2)} s → ${a.toFixed(2)} s に${pct < 0 ? '短縮' : '延長'}（${sign}${p}%）`;
}

interface Stored {
  result: CompareResult;
  baseline: LineIR;
  ir: LineIR;
}
let cached: Stored | null = null;

export function ComparePanel() {
  const ir = useLineStore((s) => s.ir);
  const baseline = useLineStore((s) => s.baseline);
  const baselineSetAt = useLineStore((s) => s.baselineSetAt);
  const setBaseline = useLineStore((s) => s.setBaseline);
  const [durationS, setDuration] = useState(300);
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState<Stored | null>(cached);

  const diffs = useMemo(() => (baseline ? diffIr(baseline, ir) : []), [baseline, ir]);
  const stale = !!stored && (stored.baseline !== baseline || stored.ir !== ir);

  const markNow = () => {
    setBaseline(ir);
    useUiStore.getState().toast('現在のラインを基準にしました');
  };

  const run = () => {
    if (!baseline || busy) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const result = compare(baseline, ir, { durationS, seed: 1 });
        cached = { result, baseline, ir };
        setStored(cached);
      } catch (e) {
        useUiStore.getState().toast(`比較に失敗しました: ${e instanceof Error ? e.message : String(e)}`, 'error');
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="props cmp">
      <Section title="基準 (変更前)">
        {baseline ? (
          <>
            <div className="cmp-base-name">
              {baseline.name} <span className="muted">· 設置 {fmtAt(baselineSetAt)}</span>
            </div>
            <p className="muted">{digest(baseline)}</p>
          </>
        ) : (
          <p className="muted">
            比較の基準がまだありません。いまのラインを基準にしてから設備やパラメータを変更すると、変更前/変更後を同じ条件で自動比較できます。
          </p>
        )}
        <div className="btn-row">
          <button className="btn primary small" onClick={markNow} disabled={ir.equipment.length === 0}>
            現在を基準にする
          </button>
          {baseline && (
            <button className="btn small" onClick={() => setBaseline(null)}>
              基準をクリア
            </button>
          )}
        </div>
      </Section>

      {baseline && (
        <>
          <Section title={`基準との違い (${diffs.length})`}>
            {diffs.length === 0 ? (
              <p className="muted">現在のラインは基準と同じです。プロパティなどで変更してから比較してください。</p>
            ) : (
              <ul className="diff-list">
                {diffs.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="比較の実行">
            <div className="cmp-run">
              <div className="run-speed dur" role="group" aria-label="シミュレーション時間">
                {[60, 300, 600].map((s) => (
                  <button key={s} className={durationS === s ? 'active' : ''} onClick={() => setDuration(s)}>
                    {s}s
                  </button>
                ))}
              </div>
              <button className="btn primary" onClick={run} disabled={busy} style={{ flex: 1 }}>
                {busy ? (
                  <>
                    <span className="spinner" /> 計算中…
                  </>
                ) : (
                  '比較を実行'
                )}
              </button>
            </div>
          </Section>
        </>
      )}

      {stored && (
        <Section title="比較結果">
          {stale && <p className="muted warn-note">基準または現在のラインが変わったため、この結果は古い可能性があります。</p>}
          <p className="cmp-verdict">{summary(stored.result)}</p>
          <table className="table cmp-table">
            <thead>
              <tr>
                <th />
                <th>変更前</th>
                <th>変更後</th>
                <th>差</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.label}
                    {r.unit && <div className="muted io-comment">{r.unit}</div>}
                  </td>
                  <td className="n">{val(stored.result.before, r)}</td>
                  <td className="n">{val(stored.result.after, r)}</td>
                  <td className="n">
                    <Delta before={stored.result.before[r.key] as number | null} after={stored.result.after[r.key] as number | null} better={r.better} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <p className="muted">同じ乱数シード・同じ時間（{stored?.result.durationS ?? durationS} 秒）で、画面外のヘッドレスシミュレーションとして実行します。</p>
    </div>
  );
}

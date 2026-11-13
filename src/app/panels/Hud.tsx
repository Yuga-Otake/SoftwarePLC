import { useSimStore, useThrottledSim } from '../store/simStore';

const f = (v: number | null | undefined, d: number) => (v === null || v === undefined ? null : v.toFixed(d));

/** 3D ビュー左上のメトリクス表示 (約 5Hz で更新) */
export function Hud() {
  const status = useSimStore((s) => s.status);
  const m = useThrottledSim((s) => s.snapshot?.metrics ?? null, 200);
  if (status === 'idle' && !m) return null;
  if (!m) return null;
  const ct = f(m.avgCycleTimeS, 2);
  const tp = f(m.throughputPerMin, 1);
  const lt = f(m.avgLeadTimeS, 1);
  const wait = <span className="hud-wait">計測中…</span>;
  return (
    <div className="hud" aria-label="計測値">
      <div className="hud-row">
        <span>サイクルタイム</span>
        <b>{ct ? <>{ct} <i>s/個</i></> : wait}</b>
      </div>
      <div className="hud-row">
        <span>スループット</span>
        <b>{tp ? <>{tp} <i>個/分</i></> : wait}</b>
      </div>
      <div className="hud-row">
        <span>完成数</span>
        <b>{m.completed} <i>個</i></b>
      </div>
      <div className="hud-row">
        <span>OK / NG</span>
        <b>
          <em className="ok">{m.ok}</em> / <em className="ng">{m.ng}</em>
        </b>
      </div>
      <div className="hud-row">
        <span>リードタイム</span>
        <b>{lt ? <>{lt} <i>s</i></> : wait}</b>
      </div>
    </div>
  );
}

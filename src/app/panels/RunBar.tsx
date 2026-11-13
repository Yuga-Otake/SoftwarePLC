import { useSimStore, useThrottledSim, FAULT_LABEL } from '../store/simStore';
import type { SimSpeed } from '../store/simStore';
import { useLineStore } from '../store/lineStore';

const SPEEDS: SimSpeed[] = [1, 2, 4];

function fmtTime(s: number) {
  return `${s.toFixed(1)}s`;
}

function SimClock() {
  const t = useThrottledSim((s) => s.snapshot?.timeS ?? 0, 100);
  return <span className="run-time">{fmtTime(t)}</span>;
}

function StatusChip() {
  const status = useSimStore((s) => s.status);
  const alarmed = useThrottledSim((s) => !!s.snapshot?.control.alarm, 100);
  let label = '停止中';
  let cls = 'idle';
  if (status === 'running') {
    label = alarmed ? '異常停止' : '運転中';
    cls = alarmed ? 'alarm' : 'run';
  } else if (status === 'paused') {
    label = alarmed ? '異常停止' : '一時停止';
    cls = alarmed ? 'alarm' : 'pause';
  }
  return <span className={`run-chip ${cls}`}>{label}</span>;
}

/** トップバー直下の運転操作バー */
export function RunBar() {
  const status = useSimStore((s) => s.status);
  const speed = useSimStore((s) => s.speed);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const reset = useSimStore((s) => s.reset);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const running = status === 'running';

  return (
    <div className="runbar" role="toolbar" aria-label="運転操作">
      <button
        className={`run-btn${running ? '' : ' primary'}`}
        onClick={running ? pause : play}
        aria-label={running ? '一時停止' : '実行'}
      >
        {running ? '⏸ 一時停止' : '▶ 実行'}
      </button>
      <button className="run-icon" onClick={reset} disabled={status === 'idle'} aria-label="リセット" title="リセット">
        ⟲
      </button>
      <div className="run-speed" role="group" aria-label="速度">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)} aria-label={`速度 x${s}`}>
            x{s}
          </button>
        ))}
      </div>
      <SimClock />
      <StatusChip />
    </div>
  );
}

/** 異常停止バナー (RunBar の下に出す) */
export function AlarmBanner() {
  const alarm = useThrottledSim((s) => s.snapshot?.control.alarm ?? null, 100);
  const faults = useSimStore((s) => s.faults);
  const resetAlarm = useSimStore((s) => s.resetAlarm);
  const ir = useLineStore((s) => s.ir);
  if (!alarm) return null;
  const name = (id: string) => ir.equipment.find((e) => e.id === id)?.id ?? id;
  return (
    <div className="alarm-banner" role="alert">
      <div className="alarm-text">
        <strong>⚠ 異常停止</strong>
        <span>
          {alarm.message} <span className="mono">[{alarm.code}]</span>
        </span>
        {faults.length > 0 && (
          <span className="alarm-faults">
            注入中の異常: {faults.map((f) => `${name(f.equipmentId)} ${FAULT_LABEL[f.type]}`).join('、')}
          </span>
        )}
      </div>
      <button className="alarm-btn" onClick={resetAlarm}>
        アラームリセット
      </button>
    </div>
  );
}

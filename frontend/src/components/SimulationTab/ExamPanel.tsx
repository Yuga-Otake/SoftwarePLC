import type { SimExamDef, SimExamStatus } from '../../types';

const STATUS_COLOR: Record<string, string> = {
  pending: '#475569',
  running: '#f59e0b',
  pass: '#22c55e',
  fail: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待機',
  running: '実行中',
  pass: '合格',
  fail: '不合格',
};

function StepRow({ step }: { step: SimExamStatus['steps'][number] }) {
  const color = STATUS_COLOR[step.status];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '8px 10px',
        borderRadius: 6,
        background: step.status === 'running' ? '#f59e0b12' : '#0f172a',
        border: `1px solid ${step.status === 'running' ? '#f59e0b60' : '#1e293b'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: '#cbd5e1', fontWeight: 600, flex: 1 }}>
          {step.note || `${step.op} ${step.signal ?? ''}`}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color,
            border: `1px solid ${color}80`,
            background: `${color}18`,
            borderRadius: 4,
            padding: '2px 6px',
            whiteSpace: 'nowrap',
          }}
        >
          {STATUS_LABEL[step.status]}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#64748b' }}>
        {step.signal && <span>信号: {step.signal}</span>}
        {step.elapsed_ms !== null && <span>実測: {step.elapsed_ms.toFixed(0)}ms</span>}
      </div>
      {step.error && (
        <div style={{ fontSize: 10, color: '#f87171' }}>{step.error}</div>
      )}
    </div>
  );
}

export function ExamPanel({
  exam,
  status,
  onStart,
  onAbort,
  canStart,
}: {
  exam: SimExamDef | null | undefined;
  status: SimExamStatus | null;
  onStart: () => void;
  onAbort: () => void;
  canStart: boolean;
}) {
  const state = status?.state ?? 'idle';
  const running = state === 'running';

  const finalBadge =
    state === 'passed' ? (
      <span
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: '#22c55e',
          background: '#22c55e18',
          border: '1.5px solid #22c55e',
          borderRadius: 6,
          padding: '6px 14px',
          display: 'inline-block',
        }}
      >
        ● 合格 (PASS)
      </span>
    ) : state === 'failed' ? (
      <span
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: '#ef4444',
          background: '#ef444418',
          border: '1.5px solid #ef4444',
          borderRadius: 6,
          padding: '6px 14px',
          display: 'inline-block',
        }}
      >
        ● 不合格 (FAIL)
      </span>
    ) : state === 'aborted' ? (
      <span
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: '#94a3b8',
          background: '#94a3b818',
          border: '1.5px solid #64748b',
          borderRadius: 6,
          padding: '6px 14px',
          display: 'inline-block',
        }}
      >
        ● 中止
      </span>
    ) : null;

  return (
    <div
      style={{
        width: 340,
        minWidth: 300,
        flexShrink: 0,
        borderLeft: '1px solid #1e293b',
        background: '#0d1526',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>
          {exam?.title || status?.title || '検定'}
        </div>
        {exam?.description && (
          <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
            {exam.description}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onStart}
            disabled={!canStart || running}
            style={{
              flex: 1,
              background: running || !canStart ? '#1e293b' : '#22c55e20',
              border: `1px solid ${running || !canStart ? '#334155' : '#22c55e'}`,
              borderRadius: 6,
              color: running || !canStart ? '#64748b' : '#22c55e',
              fontSize: 12,
              fontWeight: 700,
              padding: '7px 10px',
              cursor: running || !canStart ? 'default' : 'pointer',
            }}
          >
            {running ? '実行中…' : '▶ 検定開始'}
          </button>
          <button
            onClick={onAbort}
            disabled={!running}
            style={{
              flex: 1,
              background: !running ? '#1e293b' : '#ef444420',
              border: `1px solid ${!running ? '#334155' : '#ef4444'}`,
              borderRadius: 6,
              color: !running ? '#64748b' : '#ef4444',
              fontSize: 12,
              fontWeight: 700,
              padding: '7px 10px',
              cursor: !running ? 'default' : 'pointer',
            }}
          >
            ■ 中止
          </button>
        </div>
        {finalBadge && <div style={{ marginTop: 10, textAlign: 'center' }}>{finalBadge}</div>}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(status?.steps ?? []).length === 0 && (
          <span style={{ fontSize: 11, color: '#475569' }}>
            {exam ? '検定開始を押すと手順が実行されます。' : 'このリグには検定手順が定義されていません。'}
          </span>
        )}
        {(status?.steps ?? []).map((s) => (
          <StepRow key={s.index} step={s} />
        ))}
      </div>
    </div>
  );
}

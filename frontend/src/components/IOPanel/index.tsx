import { usePLCStore } from '../../store/plcStore';

export function IOPanel() {
  const nodes = usePLCStore((s) => s.nodes);
  const runtimeState = usePLCStore((s) => s.runtimeState);
  const ioValues = usePLCStore((s) => s.ioValues);
  const toggleIO = usePLCStore((s) => s.toggleIO);

  const inputs = nodes.filter((n) => n.data.nodeType === 'DigitalInput');
  const outputs = nodes.filter((n) => n.data.nodeType === 'DigitalOutput');

  return (
    <div
      style={{
        background: '#1e293b',
        borderTop: '1px solid #334155',
        padding: '6px 16px',
        display: 'flex',
        gap: 24,
        alignItems: 'center',
        minHeight: 48,
        flexWrap: 'wrap',
      }}
    >
      {inputs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
            Inputs
          </span>
          {inputs.map((n) => {
            const val = ioValues[n.id] ?? (n.data.params['value'] as boolean) ?? false;
            return (
              <button
                key={n.id}
                onClick={() => toggleIO(n.id, val)}
                style={{
                  background: val ? '#22c55e20' : '#0f172a',
                  border: `1px solid ${val ? '#22c55e' : '#475569'}`,
                  borderRadius: 6,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  color: val ? '#22c55e' : '#94a3b8',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: val ? '#22c55e' : '#475569',
                    display: 'inline-block',
                  }}
                />
                {n.data.label || n.id}
              </button>
            );
          })}
        </div>
      )}

      {outputs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
            Outputs
          </span>
          {outputs.map((n) => {
            const state = runtimeState[n.id] ?? {};
            const val = state['OUT'] as boolean | undefined;
            return (
              <div
                key={n.id}
                style={{
                  background: val ? '#22c55e20' : '#0f172a',
                  border: `1px solid ${val ? '#22c55e' : '#475569'}`,
                  borderRadius: 6,
                  padding: '3px 10px',
                  color: val ? '#22c55e' : '#94a3b8',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: val ? '#22c55e' : '#475569',
                    boxShadow: val ? '0 0 6px #22c55e' : 'none',
                    display: 'inline-block',
                    transition: 'all 0.15s',
                  }}
                />
                {n.data.label || n.id}
              </div>
            );
          })}
        </div>
      )}

      {inputs.length === 0 && outputs.length === 0 && (
        <span style={{ fontSize: 11, color: '#475569' }}>
          Add DigitalInput / DigitalOutput blocks to see I/O here
        </span>
      )}
    </div>
  );
}

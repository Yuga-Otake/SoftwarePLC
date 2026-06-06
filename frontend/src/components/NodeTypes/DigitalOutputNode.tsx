import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, PLCNodeData } from './BaseNode';

export function DigitalOutputNode({ id, data }: NodeProps<PLCNodeData>) {
  const out = data.outputs['OUT'] as boolean | undefined;
  const isActive = out === true;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={130}>
      <div style={{ padding: '8px 8px 8px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            background: isActive ? '#22c55e' : '#334155',
            border: `2px solid ${isActive ? '#16a34a' : '#475569'}`,
            boxShadow: isActive ? '0 0 8px rgba(34,197,94,0.6)' : 'none',
            transition: 'all 0.15s',
          }}
        />
        <span style={{ color: isActive ? '#22c55e' : '#94a3b8', fontSize: 12, fontWeight: 700 }}>
          {isActive ? 'ON' : 'OFF'}
        </span>
      </div>
      <InputHandle id="IN" top={42} value={out} label="IN" />
    </NodeWrapper>
  );
}

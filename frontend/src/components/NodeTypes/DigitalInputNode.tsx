import { NodeProps } from 'reactflow';
import { NodeWrapper, OutputHandle, PLCNodeData } from './BaseNode';
import { usePLCStore } from '../../store/plcStore';

export function DigitalInputNode({ id, data }: NodeProps<PLCNodeData>) {
  const ioValues = usePLCStore((s) => s.ioValues);
  const toggleIO = usePLCStore((s) => s.toggleIO);

  const out = data.outputs['OUT'] as boolean | undefined;
  const isActive = out === true;
  const val = ioValues[id] ?? (data.params['value'] as boolean) ?? false;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={140}>
      <div style={{ padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => toggleIO(id, val)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            border: 'none',
            cursor: 'pointer',
            background: val ? '#22c55e' : '#475569',
            position: 'relative',
            transition: 'background 0.15s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: val ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: 10,
              background: '#fff',
              transition: 'left 0.15s',
            }}
          />
        </button>
        <span style={{ color: val ? '#22c55e' : '#94a3b8', fontSize: 11, fontWeight: 700 }}>
          {val ? 'ON' : 'OFF'}
        </span>
      </div>
      <OutputHandle id="OUT" top={42} value={out} label="OUT" />
    </NodeWrapper>
  );
}

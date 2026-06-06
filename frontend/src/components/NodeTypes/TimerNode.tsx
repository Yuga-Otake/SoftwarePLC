import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';
import { usePLCStore } from '../../store/plcStore';
import { useState } from 'react';

export function TimerNode({ id, data }: NodeProps<PLCNodeData>) {
  const updateParams = usePLCStore((s) => s.updateNodeParams);
  const [editing, setEditing] = useState(false);
  const [ptInput, setPtInput] = useState('');

  const q = data.outputs['Q'] as boolean | undefined;
  const et = data.outputs['ET'] as number | undefined ?? 0;
  const pt = Number(data.params['PT'] ?? 1000);
  const progress = Math.min((et / pt) * 100, 100);
  const isActive = q === true;

  const handlePTSave = () => {
    const val = parseFloat(ptInput);
    if (!isNaN(val) && val > 0) {
      updateParams(id, { PT: val });
    }
    setEditing(false);
  };

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={150}>
      <div style={{ padding: '6px 8px 6px 20px', position: 'relative' }}>
        {/* Progress bar */}
        <div style={{ background: '#0f172a', borderRadius: 4, height: 6, margin: '4px 0', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: isActive ? '#22c55e' : '#f59e0b',
              borderRadius: 4,
              transition: 'width 0.1s',
            }}
          />
        </div>

        {/* ET / PT display */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
          <span>ET: <span style={{ color: '#f59e0b' }}>{Math.round(et)}ms</span></span>
          {editing ? (
            <input
              autoFocus
              value={ptInput}
              onChange={(e) => setPtInput(e.target.value)}
              onBlur={handlePTSave}
              onKeyDown={(e) => e.key === 'Enter' && handlePTSave()}
              style={{
                width: 55,
                background: '#0f172a',
                border: '1px solid #f59e0b',
                color: '#f59e0b',
                borderRadius: 3,
                padding: '0 3px',
                fontSize: 10,
              }}
            />
          ) : (
            <span
              onClick={() => { setPtInput(String(pt)); setEditing(true); }}
              style={{ color: '#64748b', cursor: 'pointer', textDecoration: 'underline dotted' }}
              title="Click to edit"
            >
              PT:{pt}ms
            </span>
          )}
        </div>

        {/* Q output */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: isActive ? '#22c55e' : '#475569', marginRight: 16 }}>
            Q:{isActive ? '1' : '0'}
          </span>
        </div>

        <InputHandle id="IN" top={28} />
        <OutputHandle id="Q" top={50} value={q} label="Q" />
        <OutputHandle id="ET" top={68} value={et} label="ET" />
      </div>
    </NodeWrapper>
  );
}

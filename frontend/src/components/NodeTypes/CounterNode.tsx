import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';
import { usePLCStore } from '../../store/plcStore';
import { useState } from 'react';

export function CounterNode({ id, data }: NodeProps<PLCNodeData>) {
  const updateParams = usePLCStore((s) => s.updateNodeParams);
  const [editing, setEditing] = useState(false);
  const [pvInput, setPvInput] = useState('');

  const q = data.outputs['Q'] as boolean | undefined;
  const cv = data.outputs['CV'] as number | undefined ?? 0;
  const pv = Number(data.params['PV'] ?? 10);
  const progress = Math.min((cv / pv) * 100, 100);
  const isActive = q === true;

  const handleSave = () => {
    const val = parseInt(pvInput);
    if (!isNaN(val) && val > 0) updateParams(id, { PV: val });
    setEditing(false);
  };

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={150}>
      <div style={{ padding: '6px 8px 6px 20px', position: 'relative' }}>
        <div style={{ background: '#0f172a', borderRadius: 4, height: 6, margin: '4px 0', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: isActive ? '#22c55e' : '#6366f1',
              borderRadius: 4,
              transition: 'width 0.2s',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
          <span>CV: <span style={{ color: '#6366f1' }}>{cv}</span></span>
          {editing ? (
            <input
              autoFocus
              value={pvInput}
              onChange={(e) => setPvInput(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              style={{
                width: 45,
                background: '#0f172a',
                border: '1px solid #6366f1',
                color: '#6366f1',
                borderRadius: 3,
                padding: '0 3px',
                fontSize: 10,
              }}
            />
          ) : (
            <span
              onClick={() => { setPvInput(String(pv)); setEditing(true); }}
              style={{ color: '#64748b', cursor: 'pointer', textDecoration: 'underline dotted' }}
            >
              PV:{pv}
            </span>
          )}
        </div>

        {/* Ports */}
        <InputHandle id="CU" top={28} label="CU" />
        <InputHandle id="R" top={48} label="R" />
        <OutputHandle id="Q" top={38} value={q} label="Q" />
        <OutputHandle id="CV" top={58} value={cv} label="CV" />
      </div>
    </NodeWrapper>
  );
}

import { NodeProps } from 'reactflow';
import { useState } from 'react';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';
import { usePLCStore } from '../../store/plcStore';

/** Shared VAR_READ / VAR_WRITE block UI: both just need a VAR_ID param
 * picker (dropdown of known internal variables, since that's the only kind
 * of variable these nodes can address -- see docs/VARIABLES.md) plus one
 * port. Rendered from the variable manager's own list (loaded via
 * GET /api/variables) so newly-added variables show up here without a
 * page reload, same as the HMI/viz signal pickers. */
function VarIdPicker({ nodeId, varId }: { nodeId: string; varId: string }) {
  const updateParams = usePLCStore((s) => s.updateNodeParams);
  const variableRows = usePLCStore((s) => s.variableRows);
  const internalVars = variableRows.filter((v) => v.kind === 'internal');

  return (
    <select
      value={varId}
      onChange={(e) => updateParams(nodeId, { VAR_ID: e.target.value })}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        background: '#0f172a',
        border: `1px solid ${varId ? '#334155' : '#ef4444'}`,
        color: varId ? '#e2e8f0' : '#fca5a5',
        borderRadius: 4,
        fontSize: 10,
        padding: '2px 4px',
      }}
    >
      <option value="">(未選択)</option>
      {internalVars.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} ({v.id})
        </option>
      ))}
      {varId && !internalVars.some((v) => v.id === varId) && (
        <option value={varId}>{varId} (不明)</option>
      )}
    </select>
  );
}

export function VarReadNode({ id, data }: NodeProps<PLCNodeData>) {
  const varId = String(data.params['VAR_ID'] ?? '');
  const out = data.outputs['OUT'];
  const isActive = out === true;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={150}>
      <div style={{ padding: '6px 8px 8px 8px', position: 'relative', minHeight: 46 }}>
        <VarIdPicker nodeId={id} varId={varId} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: isActive ? '#22c55e' : '#94a3b8' }}>
            OUT: {typeof out === 'number' ? out : isActive ? '1' : '0'}
          </span>
        </div>
        <OutputHandle id="OUT" top={40} value={out} />
      </div>
    </NodeWrapper>
  );
}

export function VarWriteNode({ id, data }: NodeProps<PLCNodeData>) {
  const varId = String(data.params['VAR_ID'] ?? '');
  const out = data.outputs['OUT'];
  const isActive = out === true;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={150}>
      <div style={{ padding: '6px 8px 8px 20px', position: 'relative', minHeight: 46 }}>
        <VarIdPicker nodeId={id} varId={varId} />
        <InputHandle id="IN" top={40} label="IN" />
        <OutputHandle id="OUT" top={40} value={out} />
      </div>
    </NodeWrapper>
  );
}

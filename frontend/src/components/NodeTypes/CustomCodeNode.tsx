import { NodeProps } from 'reactflow';
import { usePLCStore } from '../../store/plcStore';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';

/** Renders user/AI-authored Python code blocks. Ports come from the catalog
 * entry (registered when the block was created), since the type is the
 * block's own id rather than a fixed built-in type. */
export function CustomCodeNode({ id, data }: NodeProps<PLCNodeData>) {
  const entry = usePLCStore((s) => s.catalog[data.nodeType]);
  const status = usePLCStore((s) => s.customBlockStatus[id]);

  const inputPorts = entry?.input_ports || [];
  const outputPorts = entry?.output_ports || [];
  const height = Math.max(inputPorts.length, outputPorts.length) * 20 + 16;

  const firstOut = outputPorts[0]?.name;
  const isActive = firstOut !== undefined && data.outputs[firstOut] === true;
  const hasError = !!status?.error;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive && !hasError} width={130}>
      <div style={{ height, position: 'relative' }}>
        {inputPorts.map((p, i) => (
          <InputHandle key={p.name} id={p.name} top={14 + i * 20} value={data.outputs[p.name]} label={p.name} />
        ))}
        {outputPorts.map((p, i) => (
          <OutputHandle key={p.name} id={p.name} top={14 + i * 20} value={data.outputs[p.name]} label={p.name} />
        ))}
      </div>
      <div
        title={status?.error || undefined}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 8px 4px',
          fontSize: 9,
          color: hasError ? '#fca5a5' : '#64748b',
          borderTop: '1px solid #334155',
        }}
      >
        <span>🐍 {hasError ? 'エラー' : 'Python'}</span>
        {status?.exec_ms != null && <span>{status.exec_ms.toFixed(2)}ms</span>}
      </div>
    </NodeWrapper>
  );
}

import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';

export function COMPNode({ id, data }: NodeProps<PLCNodeData>) {
  const out = data.outputs['OUT'] as boolean | undefined;
  const isActive = out === true;
  const op = (data.params['OP'] as string) ?? '>=';
  const limit = data.params['LIMIT'] ?? 0;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={120}>
      <div style={{ padding: '4px 8px 8px 20px', position: 'relative', height: 55 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0', textAlign: 'center' }}>
          <span style={{ color: '#f59e0b' }}>{op}</span> {String(limit)}
        </div>
        <InputHandle id="IN" top={30} label="IN" />
        <OutputHandle id="OUT" top={30} value={out} />
      </div>
    </NodeWrapper>
  );
}

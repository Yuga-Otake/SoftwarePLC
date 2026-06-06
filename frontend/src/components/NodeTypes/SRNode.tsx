import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';

export function SRNode({ id, data }: NodeProps<PLCNodeData>) {
  const q = data.outputs['Q'] as boolean | undefined;
  const isActive = q === true;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={110}>
      <div style={{ padding: '4px 8px 8px 20px', position: 'relative', height: 70 }}>
        <InputHandle id="S" top={20} label="S" />
        <InputHandle id="R" top={44} label="R" />
        <OutputHandle id="Q" top={32} value={q} label="Q" />
      </div>
    </NodeWrapper>
  );
}

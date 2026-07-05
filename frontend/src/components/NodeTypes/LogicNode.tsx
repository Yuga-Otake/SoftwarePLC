import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';

const MULTI_INPUT_TYPES = ['AND', 'OR'];

export function LogicNode({ id, data }: NodeProps<PLCNodeData>) {
  const out = data.outputs['OUT'] as boolean | undefined;
  const isActive = out === true;
  const isMulti = MULTI_INPUT_TYPES.includes(data.nodeType);

  const inputPorts = isMulti ? ['IN1', 'IN2', 'IN3', 'IN4'] : ['IN'];
  const height = isMulti ? 16 + inputPorts.length * 20 : 50;

  return (
    <NodeWrapper id={id} data={data} isActive={isActive} width={100}>
      <div style={{ height, position: 'relative' }}>
        {inputPorts.map((port, i) => (
          <InputHandle key={port} id={port} top={18 + i * 20} label={isMulti ? port : ''} />
        ))}
        <OutputHandle id="OUT" top={height / 2 + 10} value={out} />
      </div>
    </NodeWrapper>
  );
}

import { NodeProps } from 'reactflow';
import { NodeWrapper, InputHandle, OutputHandle, PLCNodeData } from './BaseNode';

const INPUT_PORTS = ['IN1', 'IN2', 'IN3', 'IN4'];

/** ADD: sums 2-4 numeric (or boolean, as 0/1) inputs into one number output
 * (see backend/plc/nodes.py::ADDExecutor). Same "IN1..IN4 stacked handles"
 * shape as LogicNode's AND/OR, but shows the running sum instead of an
 * active/inactive glow -- added for the KENTEI-PLC lane extension so several
 * latched per-lane screw detections can be summed into one count
 * (docs/SIMULATION.md "レーン"). */
export function ADDNode({ id, data }: NodeProps<PLCNodeData>) {
  const out = data.outputs['OUT'];
  const height = 16 + INPUT_PORTS.length * 20;

  return (
    <NodeWrapper id={id} data={data} isActive={false} width={100}>
      <div style={{ height, position: 'relative' }}>
        {INPUT_PORTS.map((port, i) => (
          <InputHandle key={port} id={port} top={18 + i * 20} label={port} />
        ))}
        <OutputHandle id="OUT" top={height / 2 + 10} value={out} />
        <div
          style={{
            position: 'absolute',
            right: 6,
            bottom: 2,
            fontSize: 10,
            color: '#94a3b8',
            fontWeight: 700,
          }}
        >
          Σ {typeof out === 'number' ? out : '0'}
        </div>
      </div>
    </NodeWrapper>
  );
}

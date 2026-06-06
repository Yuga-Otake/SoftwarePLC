import { DigitalInputNode } from './DigitalInputNode';
import { DigitalOutputNode } from './DigitalOutputNode';
import { LogicNode } from './LogicNode';
import { TimerNode } from './TimerNode';
import { CounterNode } from './CounterNode';
import { SRNode } from './SRNode';
import { COMPNode } from './COMPNode';

export const nodeTypes = {
  DigitalInput: DigitalInputNode,
  DigitalOutput: DigitalOutputNode,
  AND: LogicNode,
  OR: LogicNode,
  NOT: LogicNode,
  TON: TimerNode,
  TOFF: TimerNode,
  CTU: CounterNode,
  SR: SRNode,
  RS: SRNode,
  COMP: COMPNode,
};

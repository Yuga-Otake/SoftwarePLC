import { DigitalInputNode } from './DigitalInputNode';
import { DigitalOutputNode } from './DigitalOutputNode';
import { LogicNode } from './LogicNode';
import { TimerNode } from './TimerNode';
import { CounterNode } from './CounterNode';
import { SRNode } from './SRNode';
import { COMPNode } from './COMPNode';
import { ADDNode } from './ADDNode';
import { GroupNode } from './GroupNode';
import { BoundaryInNode, BoundaryOutNode } from './BoundaryNode';
import { VarReadNode, VarWriteNode } from './VarNode';

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
  ADD: ADDNode,
  VAR_READ: VarReadNode,
  VAR_WRITE: VarWriteNode,
  group: GroupNode,
  boundaryIn: BoundaryInNode,
  boundaryOut: BoundaryOutNode,
};

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCallback } from 'react';
import { usePLCStore } from '../../store/plcStore';
import { nodeTypes } from '../NodeTypes';
import { PLCEdge } from './CustomEdge';

const edgeTypes = { plcEdge: PLCEdge };

function CanvasInner() {
  const nodes = usePLCStore((s) => s.nodes);
  const edges = usePLCStore((s) => s.edges);
  const onNodesChange = usePLCStore((s) => s.onNodesChange);
  const onEdgesChange = usePLCStore((s) => s.onEdgesChange);
  const onConnect = usePLCStore((s) => s.onConnect);
  const addNodeToCanvas = usePLCStore((s) => s.addNodeToCanvas);
  const { project } = useReactFlow();

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('blockType');
      if (!type) return;
      const bounds = (e.target as Element).closest('.react-flow')?.getBoundingClientRect();
      if (!bounds) return;
      const position = project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });
      addNodeToCanvas(type, position);
    },
    [project, addNodeToCanvas]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      fitView
      deleteKeyCode="Delete"
      multiSelectionKeyCode="Shift"
      style={{ background: '#0f172a' }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#1e293b"
      />
      <Controls
        style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
      />
      <MiniMap
        nodeColor={(n) => {
          const outputs = n.data?.outputs ?? {};
          const hasTrue = Object.values(outputs).some((v) => v === true);
          return hasTrue ? '#22c55e' : '#334155';
        }}
        style={{ background: '#0f172a', border: '1px solid #334155' }}
      />
    </ReactFlow>
  );
}

export function BlockCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

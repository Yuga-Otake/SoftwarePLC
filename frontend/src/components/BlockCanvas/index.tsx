import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCallback, useMemo } from 'react';
import { usePLCStore } from '../../store/plcStore';
import { nodeTypes as builtinNodeTypes } from '../NodeTypes';
import { CustomCodeNode } from '../NodeTypes/CustomCodeNode';
import { PLCEdge } from './CustomEdge';

const edgeTypes = { plcEdge: PLCEdge };

function CanvasInner() {
  const nodes = usePLCStore((s) => s.nodes);
  const edges = usePLCStore((s) => s.edges);
  const catalog = usePLCStore((s) => s.catalog);

  // Custom code blocks have dynamic type IDs (e.g. "custom_debounce_ab12cd"),
  // so they're registered for CustomCodeNode rendering based on the catalog.
  const nodeTypes = useMemo(() => {
    const customTypes = Object.values(catalog)
      .filter((c) => c.is_custom)
      .reduce((acc, c) => ({ ...acc, [c.type]: CustomCodeNode }), {} as Record<string, typeof CustomCodeNode>);
    return { ...builtinNodeTypes, ...customTypes };
  }, [catalog]);

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
          if (n.data?.anyOn !== undefined) return n.data.anyOn ? '#22c55e' : '#334155';
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

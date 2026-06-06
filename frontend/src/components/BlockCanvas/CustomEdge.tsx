import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from 'reactflow';

export function PLCEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const value = data?.value;
  const isNumeric = typeof value === 'number';
  const showLabel = isNumeric && value !== null;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: '#1e293b',
              border: '1px solid #475569',
              borderRadius: 4,
              padding: '1px 5px',
              fontSize: 9,
              color: '#f59e0b',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
            className="nodrag nopan"
          >
            {typeof value === 'number' ? Math.round(value as number) : String(value)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

import { useRef } from 'react';
import type { HmiWidget, HmiWidgetType } from '../../types';
import { Widget } from './Widget';
import { WIDGET_PALETTE, widgetTypeLabel } from './widgetDefs';

let widgetSeq = 0;

export function Canvas({
  widgets,
  setWidgets,
  running,
  selectedId,
  setSelectedId,
}: {
  widgets: HmiWidget[];
  setWidgets: (updater: (prev: HmiWidget[]) => HmiWidget[]) => void;
  running: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ id: string; startX: number; startY: number; origW: number; origH: number } | null>(null);

  const onDragOver = (e: React.DragEvent) => {
    if (running) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: React.DragEvent) => {
    if (running) return;
    e.preventDefault();
    const type = e.dataTransfer.getData('hmiWidgetType') as HmiWidgetType;
    if (!type) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 40;
    const y = rect ? e.clientY - rect.top : 40;
    const def = WIDGET_PALETTE.find((w) => w.type === type);
    const id = `w${Date.now()}_${widgetSeq++}`;
    const newWidget: HmiWidget = {
      id,
      type,
      x: Math.max(0, Math.round(x - (def?.defaultW ?? 100) / 2)),
      y: Math.max(0, Math.round(y - (def?.defaultH ?? 40) / 2)),
      w: def?.defaultW ?? 100,
      h: def?.defaultH ?? 40,
      label: widgetTypeLabel(type),
      signal: '',
    };
    setWidgets((prev) => [...prev, newWidget]);
    setSelectedId(id);
  };

  const onWidgetPointerDown = (e: React.PointerEvent, w: HmiWidget) => {
    if (running) return;
    e.stopPropagation();
    setSelectedId(w.id);
    dragState.current = { id: w.id, startX: e.clientX, startY: e.clientY, origX: w.x, origY: w.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragState.current) {
      const { id, startX, startY, origX, origY } = dragState.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setWidgets((prev) =>
        prev.map((w) => (w.id === id ? { ...w, x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) } : w))
      );
    } else if (resizeState.current) {
      const { id, startX, startY, origW, origH } = resizeState.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setWidgets((prev) =>
        prev.map((w) => (w.id === id ? { ...w, w: Math.max(24, origW + dx), h: Math.max(24, origH + dy) } : w))
      );
    }
  };

  const onPointerUp = () => {
    dragState.current = null;
    resizeState.current = null;
  };

  const onResizeHandleDown = (e: React.PointerEvent, w: HmiWidget) => {
    if (running) return;
    e.stopPropagation();
    setSelectedId(w.id);
    resizeState.current = { id: w.id, startX: e.clientX, startY: e.clientY, origW: w.w, origH: w.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  return (
    <div
      ref={canvasRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={() => !running && setSelectedId(null)}
      style={{
        flex: 1,
        position: 'relative',
        background:
          'repeating-linear-gradient(0deg, #0a0f1a, #0a0f1a 19px, #101827 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, #1e293b22 20px)',
        overflow: 'auto',
      }}
    >
      {widgets.map((w) => (
        <div key={w.id} onPointerDown={(e) => onWidgetPointerDown(e, w)}>
          <Widget widget={w} running={running} selected={selectedId === w.id} onSelect={() => setSelectedId(w.id)} />
          {!running && selectedId === w.id && (
            <div
              onPointerDown={(e) => onResizeHandleDown(e, w)}
              style={{
                position: 'absolute',
                left: w.x + w.w - 6,
                top: w.y + w.h - 6,
                width: 12,
                height: 12,
                background: '#6366f1',
                borderRadius: 3,
                cursor: 'nwse-resize',
              }}
            />
          )}
        </div>
      ))}
      {widgets.length === 0 && (
        <div style={{ position: 'absolute', top: 20, left: 20, fontSize: 11.5, color: '#475569' }}>
          左のパレットからウィジェットをドラッグ&ドロップして配置してください。
        </div>
      )}
    </div>
  );
}

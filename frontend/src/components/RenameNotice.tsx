import { useEffect } from 'react';
import { usePLCStore } from '../store/plcStore';

/** Transient toast shown after a successful node rename (see
 * plcStore.renameNode / POST /api/program/nodes/{id}/rename), summarizing
 * which sim rigs / HMI screens had their signal references cascade-updated
 * -- so a rename doesn't silently touch other files without the user
 * noticing (see docs/VARIABLES.md "6. 信号ハブ"). Auto-dismisses after a
 * few seconds; also closable immediately. */
export function RenameNotice() {
  const notice = usePLCStore((s) => s.lastRenameNotice);
  const clear = usePLCStore((s) => s.clearRenameNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, 5000);
    return () => clearTimeout(t);
  }, [notice, clear]);

  if (!notice) return null;

  const { sim_rigs, hmi_screens } = notice.updated_refs;
  const parts: string[] = [];
  if (sim_rigs.length) parts.push(`リグ ${sim_rigs.join(', ')} の${sim_rigs.length}箇所`);
  if (hmi_screens.length) parts.push(`HMI画面 ${hmi_screens.join(', ')} の${hmi_screens.length}箇所`);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 2000,
        background: '#0f172a',
        border: '1px solid #22c55e80',
        borderRadius: 8,
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        padding: '10px 14px',
        maxWidth: 360,
        fontSize: 12,
        color: '#e2e8f0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0 }}>✓</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>
          信号名を変更しました: {notice.old_id} → {notice.id}
        </div>
        {parts.length > 0 ? (
          <div style={{ color: '#94a3b8', marginTop: 4 }}>{parts.join(' / ')}も更新しました</div>
        ) : (
          <div style={{ color: '#64748b', marginTop: 4 }}>他のリグ/HMI画面からの参照はありませんでした</div>
        )}
      </div>
      <button
        onClick={clear}
        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}

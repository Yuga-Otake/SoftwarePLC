import { usePLCStore } from '../../store/plcStore';

const TABS: { key: 'logic' | 'hmi' | 'viz' | 'resources' | 'network' | 'simulation'; label: string }[] = [
  { key: 'logic', label: 'ロジック設計' },
  { key: 'hmi', label: 'HMI' },
  { key: 'viz', label: '見える化' },
  { key: 'resources', label: 'リソース' },
  { key: 'network', label: 'ネットワーク' },
  { key: 'simulation', label: 'シミュレーション' },
];

export function TabBar() {
  const activeTab = usePLCStore((s) => s.activeTab);
  const setActiveTab = usePLCStore((s) => s.setActiveTab);
  const setVariablesModalOpen = usePLCStore((s) => s.setVariablesModalOpen);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 12px',
        background: '#0b1220',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 800, color: '#6366f1', letterSpacing: 0.5, marginRight: 16 }}>
        Software PLC
      </span>
      {TABS.map((t) => {
        const active = activeTab === t.key;
        return (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: active ? '#1e293b' : 'transparent',
              border: 'none',
              borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
              color: active ? '#e2e8f0' : '#64748b',
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              cursor: 'pointer',
              padding: '10px 16px 8px',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            {t.label}
          </button>
        );
      })}

      <button
        onClick={() => setVariablesModalOpen(true)}
        title="変数マネージャーを開く (I/O・内部変数)"
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          border: '1px solid #33415580',
          borderRadius: 6,
          color: '#94a3b8',
          fontSize: 11.5,
          fontWeight: 700,
          cursor: 'pointer',
          padding: '5px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ color: '#818cf8' }}>▤</span>
        変数
      </button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import type { NetworkService, DebugEvent } from '../../types';

const ROLE_LABELS: Record<string, string> = {
  studio: '開発スタジオ',
  hmi: 'HMI配信',
  viz: '見える化配信',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  studio: 'フルUI + 全API。プログラム編集・保存・デバッグを含む開発用ポート。',
  hmi: '運転専用HMIページ配信。画面閲覧・I/O書込のみ公開(プログラム編集・デバッグAPIは非公開)。',
  viz: '稼働状況ボード + トレンド配信。読み取り専用(書込・変更系は非公開)。',
};

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function ServiceCard({ service }: { service: NetworkService }) {
  const updateNetworkService = usePLCStore((s) => s.updateNetworkService);
  const [portInput, setPortInput] = useState(String(service.port));
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => setPortInput(String(service.port)), [service.port]);

  const isStudio = service.role === 'studio';
  const listening = service.status === 'listening';

  const applyPort = async () => {
    const port = Number(portInput);
    if (!Number.isFinite(port) || port === service.port) return;
    const result = await updateNetworkService(service.name, { port });
    if (!result.ok) {
      setError(result.error || '変更に失敗しました');
      setPortInput(String(service.port));
      setTimeout(() => setError(''), 3000);
    }
  };

  const toggleEnabled = async () => {
    const result = await updateNetworkService(service.name, { enabled: !service.enabled });
    if (!result.ok) {
      setError(result.error || '変更に失敗しました');
      setTimeout(() => setError(''), 3000);
    }
  };

  const doCopy = () => {
    copyToClipboard(service.urls.lan);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: 18,
        minWidth: 280,
        flex: '1 1 280px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{ROLE_LABELS[service.role] || service.name}</span>
        <span
          style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
            color: listening ? '#22c55e' : '#64748b',
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: 4,
              background: listening ? '#22c55e' : '#475569',
              boxShadow: listening ? '0 0 6px #22c55e' : 'none',
            }}
          />
          {listening ? '稼働中' : '停止中'}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 14, minHeight: 28 }}>
        {ROLE_DESCRIPTIONS[service.role] || ''}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, color: '#94a3b8', width: 60 }}>ポート</span>
        <input
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          onBlur={applyPort}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          disabled={isStudio}
          style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
            color: isStudio ? '#64748b' : '#e2e8f0', padding: '4px 8px', fontSize: 12, width: 80,
          }}
        />
        {isStudio && <span style={{ fontSize: 9.5, color: '#475569' }}>(起動方法で固定)</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, opacity: isStudio ? 0.5 : 1 }}>
        <span style={{ fontSize: 10.5, color: '#94a3b8', width: 60 }}>有効</span>
        <button
          onClick={toggleEnabled}
          disabled={isStudio}
          style={{
            background: service.enabled ? '#22c55e20' : '#1e293b',
            border: `1px solid ${service.enabled ? '#22c55e' : '#475569'}`,
            borderRadius: 5,
            color: service.enabled ? '#22c55e' : '#94a3b8',
            fontSize: 11, fontWeight: 700, cursor: isStudio ? 'default' : 'pointer',
            padding: '3px 12px',
          }}
        >
          {service.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>アクセスURL</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace' }}>{service.urls.localhost}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace' }}>{service.urls.lan}</span>
            <button
              onClick={doCopy}
              title="LAN URLをコピー"
              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 10.5, padding: 0 }}
            >
              {copied ? '✓ コピー済み' : 'コピー'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: '#475569' }}>WS接続数: {service.ws_clients}</div>
      {error && <div style={{ fontSize: 10.5, color: '#ef4444', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function EventLog() {
  const [events, setEvents] = useState<DebugEvent[]>([]);

  useEffect(() => {
    let lastSeq = 0;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/debug/events?since=${lastSeq}`);
        if (res.ok && !cancelled) {
          const body = await res.json();
          if (body.events.length > 0) {
            setEvents((prev) => [...body.events, ...prev].slice(0, 20));
            lastSeq = body.last_seq;
          }
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, flex: '1 1 320px', minWidth: 300 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>信号遷移イベントログ (最新20件)</div>
      <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {events.length === 0 && <span style={{ fontSize: 11, color: '#475569' }}>イベント待ち…</span>}
        {events.map((e) => (
          <div
            key={e.seq}
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace',
              borderBottom: '1px solid #1e293b', paddingBottom: 3,
            }}
          >
            <span style={{ color: '#cbd5e1' }}>{e.signal}</span>
            <span>
              {String(e.old)} → <span style={{ color: '#22c55e' }}>{String(e.new)}</span>
            </span>
            <span style={{ color: '#475569' }}>scan {e.scan}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonitoringPanel() {
  const networkInfo = usePLCStore((s) => s.networkInfo);
  const monitoring = networkInfo?.monitoring;

  const TASK_LABELS: Record<string, string> = { control: '制御', hmi: 'HMI', viz: '見える化' };

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, flex: '1 1 300px', minWidth: 280 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>実行プログラム監視</div>
        {monitoring ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>プログラム名</span>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{monitoring.program_name}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>運転状態</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: monitoring.running ? '#22c55e' : '#94a3b8', fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: monitoring.running ? '#22c55e' : '#475569' }} />
                {monitoring.running ? '運転中' : '停止'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>スキャン回数</span>
              <span style={{ color: '#cbd5e1' }}>{monitoring.scan_index}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>直近スキャン時間</span>
              <span style={{ color: '#cbd5e1' }}>{monitoring.last_cycle_time_ms?.toFixed(2) ?? '--'} ms</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>ノード数</span>
              <span style={{ color: '#cbd5e1' }}>{monitoring.node_count}</span>
            </div>

            <div style={{ marginTop: 6 }}>
              <div style={{ color: '#64748b', marginBottom: 6 }}>タスク別使用率</div>
              {monitoring.tasks.map((t) => (
                <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 44, fontSize: 10.5, color: '#94a3b8' }}>{TASK_LABELS[t.name] || t.name}</span>
                  <div style={{ flex: 1, height: 7, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(t.utilization_pct, 100)}%`,
                        height: '100%',
                        background: t.degraded || t.utilization_pct > t.cpu_share ? '#ef4444' : '#22c55e',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <span style={{ width: 44, textAlign: 'right', fontSize: 10, color: '#cbd5e1' }}>{t.utilization_pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#475569' }}>読み込み中…</span>
        )}
      </div>

      <EventLog />
    </div>
  );
}

export function NetworkTab() {
  const networkInfo = usePLCStore((s) => s.networkInfo);
  const loadNetworkInfo = usePLCStore((s) => s.loadNetworkInfo);

  useEffect(() => {
    loadNetworkInfo();
    const interval = setInterval(loadNetworkInfo, 2000);
    return () => clearInterval(interval);
  }, []);

  const order = ['studio', 'hmi', 'viz'];
  const services = [...(networkInfo?.services || [])].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, background: '#0a0f1a' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: 0, marginBottom: 4 }}>ネットワーク管理</h2>
        <p style={{ fontSize: 11.5, color: '#64748b', margin: 0, maxWidth: 760 }}>
          開発スタジオ・HMI配信・見える化配信をポートで分離し、別端末(タブレット・別PC)から
          HMI・見える化だけを開けるようにします。ポート変更・有効/無効の切替は即座に反映されます。
          詳細は docs/NETWORK.md 参照。
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        {services.map((s) => (
          <ServiceCard key={s.name} service={s} />
        ))}
        {services.length === 0 && <span style={{ color: '#475569', fontSize: 12 }}>読み込み中…</span>}
      </div>

      <MonitoringPanel />
    </div>
  );
}

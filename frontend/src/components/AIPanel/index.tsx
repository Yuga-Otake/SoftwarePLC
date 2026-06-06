import { useState, useRef, useEffect } from 'react';
import { usePLCStore, ChatEntry } from '../../store/plcStore';

function ToolCallBadge({ name, result }: { name: string; result: unknown }) {
  const ok = (result as Record<string, unknown>)?.ok !== false;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
        border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 10,
        color: ok ? '#86efac' : '#fca5a5',
        fontFamily: 'monospace',
      }}
    >
      {ok ? '✓' : '✗'} {name}
    </span>
  );
}

function Message({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      {entry.toolCalls && entry.toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
          {entry.toolCalls.map((tc, i) => (
            <ToolCallBadge key={i} name={tc.name} result={tc.result} />
          ))}
        </div>
      )}
      <div
        style={{
          maxWidth: '90%',
          background: isUser ? '#1d4ed8' : '#1e293b',
          border: `1px solid ${isUser ? '#2563eb' : '#334155'}`,
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          padding: '8px 12px',
          fontSize: 12,
          color: '#e2e8f0',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        {entry.content}
      </div>
    </div>
  );
}

export function AIPanel() {
  const chatHistory = usePLCStore((s) => s.chatHistory);
  const aiLoading = usePLCStore((s) => s.aiLoading);
  const pendingOps = usePLCStore((s) => s.pendingOps);
  const sendAIMessage = usePLCStore((s) => s.sendAIMessage);
  const applyPending = usePLCStore((s) => s.applyPending);
  const rejectPending = usePLCStore((s) => s.rejectPending);

  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, aiLoading]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || aiLoading) return;
    setInput('');
    sendAIMessage(msg);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0f172a',
        borderLeft: '1px solid #1e293b',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #1e293b',
          fontSize: 12,
          fontWeight: 700,
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ color: '#6366f1' }}>◈</span>
        AI Assistant
        <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>Tool Use Mode</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {chatHistory.length === 0 && (
          <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            <div style={{ marginBottom: 8 }}>Ask me to build automation logic.</div>
            <div style={{ fontSize: 11, color: '#334155' }}>
              e.g. "When X1 and X2 are both ON, start Y0 after 3 seconds"
            </div>
          </div>
        )}
        {chatHistory.map((entry, i) => (
          <Message key={i} entry={entry} />
        ))}
        {aiLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 4,
                background: '#6366f1',
                animation: 'pulse 1s infinite',
              }}
            />
            Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending ops approval */}
      {pendingOps.length > 0 && (
        <div
          style={{
            borderTop: '1px solid #f59e0b40',
            background: 'rgba(245,158,11,0.08)',
            padding: '8px 14px',
          }}
        >
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
            ⚠ {pendingOps.length} pending change{pendingOps.length > 1 ? 's' : ''} — review on canvas
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={applyPending}
              style={{
                flex: 1,
                background: '#22c55e20',
                border: '1px solid #22c55e',
                borderRadius: 6,
                padding: '5px',
                color: '#22c55e',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              ✓ Apply All
            </button>
            <button
              onClick={rejectPending}
              style={{
                flex: 1,
                background: '#ef444420',
                border: '1px solid #ef4444',
                borderRadius: 6,
                padding: '5px',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              ✗ Reject
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          borderTop: '1px solid #1e293b',
          padding: '10px 14px',
          display: 'flex',
          gap: 8,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Describe the logic you need... (Enter to send)"
          rows={2}
          style={{
            flex: 1,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#e2e8f0',
            padding: '6px 10px',
            fontSize: 12,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={aiLoading || !input.trim()}
          style={{
            background: aiLoading || !input.trim() ? '#1e293b' : '#4f46e5',
            border: '1px solid #4f46e5',
            borderRadius: 6,
            color: aiLoading || !input.trim() ? '#475569' : '#fff',
            cursor: aiLoading || !input.trim() ? 'default' : 'pointer',
            padding: '0 12px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { useLineStore } from '../store/lineStore';
import { ProposalCard } from './chat/ProposalCard';
import { Settings } from './chat/Settings';
import './chat/chat.css';

const EXAMPLE_EMPTY = ['2メートルのコンベヤで箱を流して、真ん中で2秒検査するラインを作って'];
const EXAMPLE_EXISTING = ['検査を1.5秒にして、コンベヤを1.5倍速にして', '0.5m地点にセンサを追加して', 'コンベヤを1.5メートル延長して'];

function ModeBar() {
  const hasKey = useChatStore((s) => !!s.apiKey);
  const open = useChatStore((s) => s.settingsOpen);
  const setOpen = useChatStore((s) => s.setSettingsOpen);
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const busy = useChatStore((s) => s.busy);
  return (
    <div className="chat-modebar">
      <button
        className={`chat-mode ${hasKey ? 'ai' : 'demo'}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="タップで設定"
      >
        <span className="dot" />
        <span className="chat-mode-text">{hasKey ? 'AI: Gemini' : 'デモモード（定型文のみ・AIではありません）'}</span>
        <span className="chat-gear" aria-hidden>
          ⚙
        </span>
      </button>
      {hasMessages && (
        <button
          className="link"
          disabled={busy}
          onClick={() => {
            if (window.confirm('会話履歴をクリアします。(ラインは変わりません)')) useChatStore.getState().clear();
          }}
        >
          会話をクリア
        </button>
      )}
    </div>
  );
}

function Messages() {
  const messages = useChatStore((s) => s.messages);
  const busy = useChatStore((s) => s.busy);
  const isEmpty = useLineStore((s) => s.ir.equipment.length === 0);
  const ref = useRef<HTMLDivElement>(null);
  const hasKey = useChatStore((s) => !!s.apiKey);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (messages.length === 0) return void (el.scrollTop = 0);
    // 最新メッセージが画面より高い (変更カード) ときは、その先頭に合わせる
    const last = el.querySelector<HTMLElement>('[data-last="1"]');
    if (!busy && last && last.offsetHeight > el.clientHeight - 16) el.scrollTop = Math.max(0, last.offsetTop - 8);
    else el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  return (
    <div className="chat-messages" ref={ref} data-testid="chat-messages">
      {messages.length === 0 && (
        <div className="chat-welcome">
          <p className="chat-welcome-title">作りたいラインを、日本語で話しかけてください。</p>
          <p className="muted">
            AIは「提案」だけを出します。内容を確認して「適用」を押すまで、ラインは変わりません。
            {!hasKey && ' いまはデモモードです（決まった言い回しにだけ反応します）。'}
          </p>
          <p className="muted">例（タップで送信）</p>
          <div className="chat-welcome-chips">
            {(isEmpty ? EXAMPLE_EMPTY : EXAMPLE_EXISTING).map((t) => (
              <button key={t} className="chat-chip wrap" disabled={busy} onClick={() => void useChatStore.getState().send(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m, mi) => {
        const last = mi === messages.length - 1 ? '1' : undefined;
        switch (m.kind) {
          case 'user':
            return (
              <div key={m.id} data-last={last} className="bubble user">
                {m.text}
              </div>
            );
          case 'assistant':
            return (
              <div key={m.id} data-last={last} className="bubble ai">
                {m.text}
              </div>
            );
          case 'error':
            return (
              <div key={m.id} data-last={last} className="bubble err" role="alert">
                <div>{m.text}</div>
                <button className="btn small" disabled={busy} onClick={() => void useChatStore.getState().retry(m.id)}>
                  再送
                </button>
              </div>
            );
          case 'proposal':
            return (
              <div key={m.id} data-last={last} className="bubble ai card">
                <ProposalCard msg={m} />
              </div>
            );
        }
      })}
      {busy && (
        <div className="bubble ai thinking" aria-live="polite">
          考え中<span className="dots">…</span>
        </div>
      )}
    </div>
  );
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;

function Composer() {
  const busy = useChatStore((s) => s.busy);
  const isEmpty = useLineStore((s) => s.ir.equipment.length === 0);
  const [text, setText] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [text]);

  const submit = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    setText('');
    void useChatStore.getState().send(v);
  };

  const chips = isEmpty ? EXAMPLE_EMPTY : EXAMPLE_EXISTING;
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  return (
    <div className="chat-composer">
      {hasMessages && (
        <div className="chat-chips" aria-label="入力例">
          {chips.map((t) => (
            <button key={t} className="chat-chip" disabled={busy} onClick={() => submit(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <textarea
          ref={ta}
          rows={1}
          value={text}
          disabled={busy}
          placeholder={busy ? '考え中…' : '例: 0.5m地点にセンサを追加して'}
          aria-label="メッセージ"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && isDesktop()) {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        <button className="btn primary chat-send" onClick={() => submit(text)} disabled={busy || !text.trim()} aria-label="送信">
          {busy ? '…' : '送信'}
        </button>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const settingsOpen = useChatStore((s) => s.settingsOpen);
  return (
    <div className="chat">
      <ModeBar />
      {settingsOpen && <Settings />}
      <Messages />
      <Composer />
    </div>
  );
}

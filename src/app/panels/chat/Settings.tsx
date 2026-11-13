import { useState } from 'react';
import { DEFAULT_GEMINI_MODEL } from '@core/ai';
import { useChatStore } from '../../store/chatStore';

const mask = (k: string) => (k.length <= 8 ? '••••••••' : `${k.slice(0, 7)}…••••${k.slice(-4)}`);

export function Settings() {
  const apiKey = useChatStore((s) => s.apiKey);
  const model = useChatStore((s) => s.model);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [modelDraft, setModelDraft] = useState(model);
  const [replacing, setReplacing] = useState(false);
  const st = useChatStore.getState;

  const saveKey = () => {
    if (!draft.trim()) return;
    st().setApiKey(draft);
    setDraft('');
    setShow(false);
    setReplacing(false);
  };

  return (
    <div className="chat-settings">
      <label className="chat-label" htmlFor="chat-apikey">
        Gemini API キー
      </label>
      {apiKey && !replacing ? (
        <div className="chat-key-row">
          <span className="mono chat-key-mask" data-testid="key-mask">
            {mask(apiKey)}
          </span>
          <button className="btn small" onClick={() => setReplacing(true)}>
            変更
          </button>
          <button
            className="btn small"
            onClick={() => {
              st().setApiKey('');
              setReplacing(false);
            }}
          >
            削除
          </button>
        </div>
      ) : (
        <div className="chat-key-row">
          <input
            id="chat-apikey"
            className="text-input"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="AIza..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <button className="btn small" onClick={() => setShow((v) => !v)} aria-pressed={show}>
            {show ? '隠す' : '表示'}
          </button>
          <button className="btn small primary" onClick={saveKey} disabled={!draft.trim()}>
            保存
          </button>
          {apiKey && (
            <button className="btn small" onClick={() => (setReplacing(false), setDraft(''))}>
              戻る
            </button>
          )}
        </div>
      )}

      <label className="chat-label" htmlFor="chat-model">
        モデル
      </label>
      <div className="chat-key-row">
        <input
          id="chat-model"
          className="text-input"
          type="text"
          autoCapitalize="off"
          spellCheck={false}
          value={modelDraft}
          placeholder={DEFAULT_GEMINI_MODEL}
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={() => {
            st().setModel(modelDraft);
            setModelDraft(st().model);
          }}
        />
      </div>

      <p className="muted">
        キーはこのブラウザの localStorage にだけ保存され、generativelanguage.googleapis.com へ直接送信されます（このアプリのサーバは経由しません）。キーは Google AI Studio（aistudio.google.com/apikey）で取得できます。共有端末では使わないでください。キーを設定しない間はデモモード（定型文のみ）で動きます。
      </p>
    </div>
  );
}

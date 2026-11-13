import { useRef, useState } from "react";
import { library } from "@core/library";
import type { LibraryItemId } from "@core/ir";
import { addFromLibrary } from "./addEquipment";
import { KIND_EMOJI, KIND_LABEL } from "./ui";
import { addModelFromFile, addSampleModel } from "../assets/addModel";
import { useUserLibrary } from "../assets/userLibrary";
import type { UserLibraryEntry } from "../assets/userLibrary";
import { CAD_CATEGORIES, CAD_SOURCES } from "../assets/cadSources";

function addUserEntry(e: UserLibraryEntry) {
  const item: LibraryItemId =
    e.kind === "inspection_station" ? "inspection_cell" : e.kind;
  addFromLibrary(item, {
    name: e.label,
    params: e.params,
    visual: e.visual,
    semantics: { status: "confirmed", source: "user" },
  });
}

export function LibraryPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const entries = useUserLibrary((s) => s.entries);
  const removeEntry = useUserLibrary((s) => s.remove);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lib-wrap">
      <div className="lib-grid">
        <button
          className="lib-card lib-upload"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <span className="lib-icon" aria-hidden>
            📥
          </span>
          <span className="lib-text">
            <span className="lib-label">3Dモデルを追加 (GLB)</span>
            <span className="lib-desc">
              手持ちの .glb / .gltf を読み込み、設備として使う
            </span>
          </span>
          <span className="lib-add" aria-hidden>
            ＋
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          data-testid="glb-input"
          accept=".glb,.gltf,model/gltf-binary"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void wrap(() => addModelFromFile(f, f.name));
          }}
        />
        <button
          className="lib-card"
          disabled={busy}
          onClick={() => void wrap(addSampleModel)}
        >
          <span className="lib-icon" aria-hidden>
            🧪
          </span>
          <span className="lib-text">
            <span className="lib-label">サンプルモデルで試す</span>
            <span className="lib-desc">ベルトコンベヤ風の GLB を読み込む</span>
          </span>
          <span className="lib-add" aria-hidden>
            ＋
          </span>
        </button>
      </div>

      {entries.length > 0 && (
        <>
          <h3 className="lib-h">マイ設備</h3>
          <div className="lib-grid">
            {entries.map((e) => (
              <div key={e.id} className="lib-card user-card">
                <button className="lib-main" onClick={() => addUserEntry(e)}>
                  <span className="lib-icon" aria-hidden>
                    {KIND_EMOJI[e.kind] ?? "⚙️"}
                  </span>
                  <span className="lib-text">
                    <span className="lib-label">{e.label}</span>
                    <span className="lib-desc">
                      {KIND_LABEL[e.kind]} (3D モデル)
                    </span>
                  </span>
                </button>
                <button
                  className="lib-del"
                  aria-label={`${e.label} をマイ設備から削除`}
                  onClick={() =>
                    window.confirm(
                      `「${e.label}」をマイ設備から削除しますか？`,
                    ) && removeEntry(e.id)
                  }
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="lib-h">標準ライブラリ</h3>
      <div className="lib-grid">
        {library.map((item) => (
          <button
            key={item.id}
            className="lib-card"
            onClick={() => addFromLibrary(item.id)}
          >
            <span className="lib-icon" aria-hidden>
              {KIND_EMOJI[item.id] ?? "⚙️"}
            </span>
            <span className="lib-text">
              <span className="lib-label">{item.label}</span>
              <span className="lib-desc">{item.description}</span>
            </span>
            <span className="lib-add" aria-hidden>
              ＋
            </span>
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <>
          <h3 className="lib-h">マイ設備</h3>
          <p className="muted">
            確認済みの 3D
            モデル設備を「マイ設備に保存」すると、ここから再利用できます。
          </p>
        </>
      )}

      <h3 className="lib-h">メーカーの3D CADを入手</h3>
      <p className="muted">
        各社の公式ページを新しいタブで開きます。CAD データは再配布不可のため本アプリには同梱していません。
      </p>
      {CAD_CATEGORIES.map((cat) => (
        <div key={cat} className="cad-group">
          <div className="cad-cat">{cat}</div>
          <div className="lib-grid">
            {CAD_SOURCES.filter((c) => c.category === cat).map((c) => (
              <a
                key={c.name}
                className="lib-card cad-card"
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="lib-text">
                  <span className="lib-label">{c.name}</span>
                  <span className="lib-desc">
                    {c.formats} ・ {c.note}
                  </span>
                </span>
                <span className="lib-add" aria-hidden>
                  ↗
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
      <ol className="cad-steps">
        <li>
          メーカーサイトで型式を選び、STEP などをダウンロードします (利用規約は各社に従ってください。再配布不可のため本アプリには同梱していません)。
        </li>
        <li>
          GLB に変換します。無料の方法: FreeCAD で STEP を開き「ファイル → エクスポート」で .glb を保存 / Open Cascade の CAD Assistant で STEP を開き glTF/GLB へエクスポート。
        </li>
        <li>
          上の「3Dモデルを追加 (GLB)」でアップロードし、「設備として使う」で種別・搬送方向を確認して確定します。アップロードしたファイルはこのブラウザ内にだけ保存されます。
        </li>
      </ol>
    </div>
  );
}

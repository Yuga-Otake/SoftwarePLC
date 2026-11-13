import { library } from '@core/library';
import { addFromLibrary } from './addEquipment';
import { KIND_EMOJI } from './ui';

export function LibraryPanel() {
  return (
    <div className="lib-grid">
      {library.map((item) => (
        <button key={item.id} className="lib-card" onClick={() => addFromLibrary(item.id)}>
          <span className="lib-icon" aria-hidden>
            {KIND_EMOJI[item.id] ?? '⚙️'}
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
  );
}

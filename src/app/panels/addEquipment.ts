import type { Equipment, LibraryItemId, PatchOp } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';

/** ライブラリ項目をスマートな既定位置へ追加する */
export function addFromLibrary(item: LibraryItemId) {
  const { ir, selectedId, dispatch, select } = useLineStore.getState();
  const ui = useUiStore.getState();
  const convs = ir.equipment.filter((e): e is Extract<Equipment, { kind: 'conveyor' }> => e.kind === 'conveyor');
  const hasOut = (id: string) => ir.connections.some((c) => c.from.equipmentId === id && c.from.portId === 'out');
  const hasIn = (id: string) => ir.connections.some((c) => c.to.equipmentId === id && c.to.portId === 'in');
  const sel = ir.equipment.find((e) => e.id === selectedId);

  let ops: PatchOp[];
  switch (item) {
    case 'conveyor': {
      const tail = [...convs].reverse().find((c) => !hasOut(c.id));
      ops = tail
        ? [{ op: 'add', item, after: tail.id }]
        : [{ op: 'add', item, transform: { position: [0, 0, convs.length * 0.7] } }];
      break;
    }
    case 'source': {
      const target = convs.find((c) => !hasIn(c.id));
      if (!target) {
        ui.toast(convs.length ? '接続できるコンベヤの入口がありません' : '先にコンベヤを配置してください', 'error');
        return;
      }
      const used = new Set(ir.equipment.map((e) => e.id));
      let n = 1;
      while (used.has(`SRC${n}`)) n++;
      const id = `SRC${n}`;
      ops = [
        { op: 'add', item, id },
        { op: 'connect', from: { equipmentId: id, portId: 'out' }, to: { equipmentId: target.id, portId: 'in' } },
      ];
      break;
    }
    case 'sensor':
    case 'stopper':
    case 'inspection_cell': {
      let conv: (typeof convs)[number] | undefined;
      if (sel?.kind === 'conveyor') conv = sel;
      else if (sel && 'mount' in sel) conv = convs.find((c) => c.id === sel.mount.conveyorId);
      else if (convs.length === 1) conv = convs[0];
      if (!conv) {
        ui.toast(convs.length ? 'コンベヤを選択してください' : '先にコンベヤを配置してください', 'error');
        return;
      }
      ops = [{ op: 'add', item, mount: { conveyorId: conv.id, offsetM: Math.round((conv.params.lengthM / 2) * 100) / 100 } }];
      break;
    }
    case 'generic': {
      const n = ir.equipment.filter((e) => e.kind === 'generic').length;
      ops = [{ op: 'add', item, transform: { position: [0, 0, convs.length || n ? -(0.8 + 0.4 * n) : 0] } }];
      break;
    }
  }

  const res = dispatch(ops, '設備を追加');
  if (res.errors.length) {
    ui.toast(res.errors[0], 'error');
    return;
  }
  const added = res.changes.find((c) => c.type === 'added');
  if (added) select(added.equipmentId);
  ui.toast(res.changes.find((c) => c.type === 'added')?.summary ?? '追加しました');
}

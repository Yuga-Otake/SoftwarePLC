/** 標準ライン: CV1 (2 m) + SRC1 + 検査セル ST1 (CV1 の 1.0 m 地点) */
import { applyPatch, emptyLine } from '../ir';
import type { LineIR, PatchOp } from '../ir';

export function standardLineOps(): PatchOp[] {
  return [
    { op: 'rename_line', name: '標準ライン' },
    { op: 'add', item: 'conveyor', id: 'CV1', params: { lengthM: 2.0 } },
    { op: 'add', item: 'source', id: 'SRC1' },
    { op: 'connect', from: { equipmentId: 'SRC1', portId: 'out' }, to: { equipmentId: 'CV1', portId: 'in' } },
    { op: 'add', item: 'inspection_cell', id: 'ST1', mount: { conveyorId: 'CV1', offsetM: 1.0 } },
  ];
}

export function buildStandardLine(): LineIR {
  const r = applyPatch(emptyLine('標準ライン'), standardLineOps());
  if (r.errors.length) throw new Error(`標準ラインの構築に失敗: ${r.errors.join(' / ')}`);
  return r.ir;
}

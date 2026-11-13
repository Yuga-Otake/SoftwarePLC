import { saveAsset, AssetError } from './assetStore';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';

/** 既存設備と重ならない空き位置 (Z 方向の手前側へ置く) */
function freeSpot(sizeM: [number, number, number]): [number, number, number] {
  const { ir } = useLineStore.getState();
  const placed = ir.equipment.filter((e) => 'transform' in e);
  if (placed.length === 0) return [0, 0, 0];
  let minZ = Infinity;
  for (const e of placed) {
    if (!('transform' in e)) continue;
    let half = 0.3;
    if (e.visual.type === 'glb' && e.visual.meta) half = Math.max(...e.visual.meta.sizeM) / 2;
    minZ = Math.min(minZ, e.transform.position[2] - half);
  }
  const r = Math.max(sizeM[0], sizeM[2]) / 2;
  return [0, 0, Math.round((minZ - 0.5 - r) * 20) / 20];
}

/** ファイルを保存し、generic (glb 視覚) として床に置く。成功時は選択してプロパティを開く */
export async function addModelFromFile(file: File | Blob, fileName: string): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const meta = await saveAsset(file, fileName);
    const { dispatch, select } = useLineStore.getState();
    const res = dispatch(
      [
        {
          op: 'add',
          item: 'generic',
          name: fileName.replace(/\.[^.]+$/, ''),
          transform: { position: freeSpot(meta.sizeM) },
          visual: {
            type: 'glb',
            assetId: meta.id,
            fit: { position: [0, 0, 0], rotationYDeg: 0, scale: 1 },
            meta: { fileName: meta.fileName, sizeM: meta.sizeM, nodeNames: meta.nodeNames },
          },
        },
      ],
      '3D モデルを追加',
    );
    if (res.errors.length) {
      ui.toast(res.errors[0], 'error');
      return false;
    }
    const added = res.changes.find((c) => c.type === 'added');
    if (added) select(added.equipmentId);
    ui.setTab('properties');
    ui.setSheetOpen(true);
    ui.requestFit();
    ui.toast(`${fileName} を追加しました。「設備として使う」で種別を確認してください`);
    return true;
  } catch (e) {
    ui.toast(e instanceof AssetError ? e.message : 'モデルの追加に失敗しました', 'error');
    return false;
  }
}

export async function addSampleModel(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/belt_conveyor.glb`);
    if (!res.ok) throw new Error(String(res.status));
    return await addModelFromFile(await res.blob(), 'belt_conveyor.glb');
  } catch {
    useUiStore.getState().toast('サンプルモデルを取得できませんでした', 'error');
    return false;
  }
}

/**
 * GLB/GLTF アセットの保存 (IndexedDB) と読込。
 * IR には assetId と meta (外形・ノード名) だけを持たせ、バイナリはブラウザ内にのみ置く。
 */
import { createStore, del, get, keys, set } from 'idb-keyval';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MAX_ASSET_BYTES = 30 * 1024 * 1024;
const MAX_NODE_NAMES = 30;

export interface AssetMeta {
  id: string;
  fileName: string;
  /** モデル外形 (m, 作成時の座標のまま。X/Y/Z) */
  sizeM: [number, number, number];
  nodeNames: string[];
  createdAt: number;
}
interface AssetRecord extends AssetMeta {
  bytes: ArrayBuffer;
}

let store: ReturnType<typeof createStore> | null = null;
const getStore = () => (store ??= createStore('cfb-assets', 'assets'));

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class AssetError extends Error {}

/** GLB は先頭 'glTF'、それ以外は JSON の .gltf として扱う */
const isGlb = (b: ArrayBuffer) => b.byteLength >= 4 && new DataView(b).getUint32(0, true) === 0x46546c67;

function parseGltf(bytes: ArrayBuffer): Promise<Group> {
  return new Promise((resolve, reject) => {
    let input: ArrayBuffer | string = bytes;
    if (!isGlb(bytes)) {
      const text = new TextDecoder().decode(bytes);
      let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      try {
        json = JSON.parse(text);
      } catch {
        return reject(new AssetError('GLB / GLTF として読み込めませんでした。'));
      }
      const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((x) => x.uri && !x.uri.startsWith('data:'));
      if (external) return reject(new AssetError('外部ファイルを参照する .gltf は読み込めません。.glb か、データ埋め込みの .gltf を使ってください。'));
      input = text;
    }
    new GLTFLoader().parse(
      input,
      '',
      (gltf) => resolve(gltf.scene),
      (err) => reject(new AssetError(`モデルを読み込めませんでした (${(err as unknown as { message?: string })?.message ?? String(err)})`)),
    );
  });
}

export function measure(scene: Group): { box: Box3; sizeM: [number, number, number] } {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const s = box.getSize(new Vector3());
  return { box, sizeM: [round3(s.x), round3(s.y), round3(s.z)] };
}

function collectNames(scene: Group): string[] {
  const out: string[] = [];
  scene.traverse((o) => {
    const n = o.name?.trim();
    if (o !== scene && n && !out.includes(n) && out.length < MAX_NODE_NAMES) out.push(n);
  });
  return out;
}

const cache = new Map<string, Promise<Group>>();

/** ファイルを検証して保存し、メタ情報を返す */
export async function saveAsset(file: File | Blob, fileName: string): Promise<AssetMeta> {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) throw new AssetError('対応形式は .glb / .gltf です。');
  if (file.size > MAX_ASSET_BYTES) throw new AssetError('ファイルが大きすぎます (30 MB まで)。');
  const bytes = await file.arrayBuffer();
  const scene = await parseGltf(bytes);
  const { sizeM } = measure(scene);
  if (!sizeM.every((v) => Number.isFinite(v)) || sizeM.every((v) => v === 0)) throw new AssetError('モデルに形状がありません。');
  const meta: AssetMeta = {
    id: `asset_${crypto.randomUUID().slice(0, 12)}`,
    fileName,
    sizeM,
    nodeNames: collectNames(scene),
    createdAt: Date.now(),
  };
  try {
    await set(meta.id, { ...meta, bytes } satisfies AssetRecord, getStore());
  } catch {
    throw new AssetError('ブラウザへの保存に失敗しました (容量不足またはプライベートモードの可能性)。');
  }
  cache.set(meta.id, Promise.resolve(scene));
  return meta;
}

/** パース済みシーン (インスタンスごとに clone して使うこと)。無ければ null */
export function loadAssetScene(assetId: string): Promise<Group | null> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const p = (async () => {
    const rec = (await get(assetId, getStore())) as AssetRecord | undefined;
    if (!rec) throw new AssetError('missing');
    return parseGltf(rec.bytes);
  })();
  cache.set(assetId, p);
  return p.catch(() => {
    cache.delete(assetId); // 失敗は保持しない (後から保存されるかもしれない)
    return null;
  });
}

export async function listAssets(): Promise<AssetMeta[]> {
  const ks = await keys(getStore());
  const out: AssetMeta[] = [];
  for (const k of ks) {
    const rec = (await get(k, getStore())) as AssetRecord | undefined;
    if (rec) {
      const { bytes: _b, ...meta } = rec;
      out.push(meta);
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(id: string): Promise<void> {
  const p = cache.get(id);
  cache.delete(id);
  await del(id, getStore());
  try {
    const scene = await p;
    scene?.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
      }
    });
  } catch {
    /* ignore */
  }
}

/** assetId の存在確認 (バイナリは読まない) */
export async function hasAsset(id: string): Promise<boolean> {
  return (await keys(getStore())).includes(id);
}

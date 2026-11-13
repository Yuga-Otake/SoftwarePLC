/** 手続き生成テクスチャ (ネットワーク不使用)。DOM が必要なので呼び出し時に生成する */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, repeat: boolean) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** ベルト: 細かい織目 + 薄い継ぎ目 (レーシング) + 控えめな進行方向マーク。512px = 1.0 m (U) x 0.5 m (V) */
export function makeBeltTexture(): CanvasTexture {
  const { c, g } = canvas(512, 256);
  const r = rng(7);
  g.fillStyle = '#25292f';
  g.fillRect(0, 0, 512, 256);
  const img = g.getImageData(0, 0, 512, 256);
  const d = img.data;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const weave = (((x >> 1) + (y >> 1)) & 1 ? 7 : -5) + (x % 6 < 1 ? 4 : 0) + (y % 6 < 1 ? 4 : 0);
      const n = (r() - 0.5) * 10;
      d[i] += weave + n;
      d[i + 1] += weave + n;
      d[i + 2] += weave + n + 1;
    }
  }
  g.putImageData(img, 0, 0);
  // 継ぎ目 (レーシング): 薄い破線
  g.fillStyle = 'rgba(150,158,168,0.30)';
  for (let y = 4; y < 256; y += 12) g.fillRect(0, y, 7, 6);
  g.fillStyle = 'rgba(10,12,15,0.5)';
  g.fillRect(8, 0, 2, 256);
  // 進行方向マーク (+U)
  g.fillStyle = 'rgba(170,180,192,0.34)';
  g.beginPath();
  g.moveTo(232, 100);
  g.lineTo(264, 100);
  g.lineTo(292, 128);
  g.lineTo(264, 156);
  g.lineTo(232, 156);
  g.lineTo(260, 128);
  g.closePath();
  g.fill();
  return finish(c, true);
}

/** エポキシ塗床コンクリート。512px = 4 m タイル (縁に目地) */
export function makeFloorTexture(): CanvasTexture {
  const { c, g } = canvas(512, 512);
  const r = rng(11);
  g.fillStyle = '#56606a';
  g.fillRect(0, 0, 512, 512);
  // 大きなムラ
  for (let i = 0; i < 46; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 40 + r() * 120;
    const lighter = r() > 0.5;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, lighter ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const img = g.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 16;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 目地 (ソーカット)
  g.fillStyle = 'rgba(20,24,28,0.55)';
  g.fillRect(0, 0, 512, 3);
  g.fillRect(0, 0, 3, 512);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, 3, 512, 2);
  g.fillRect(3, 0, 2, 512);
  return finish(c, true);
}

/** 背景の縦グラデーション */
export function makeSkyTexture(): CanvasTexture {
  const { c, g } = canvas(4, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0d1217');
  grd.addColorStop(0.55, '#1c242d');
  grd.addColorStop(1, '#2c3641');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  return finish(c, false);
}

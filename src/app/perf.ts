/** 端末性能に応じた描画設定。?shadows=1/0 で強制できる (検証用) */
function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
const forced = param('shadows');

/** 影の有効/無効: 低性能 (コア数 4 以下) では既定で無効 */
export const SHADOWS_ON: boolean = forced === '1' ? true : forced === '0' ? false : cores > 4;
export const SHADOW_MAP_SIZE = cores >= 8 ? 2048 : 1024;
export const DEBUG_GL = param('debug') === '1';

/**
 * メーカー公式の 3D CAD 入手ページへのリンク集。
 * 各社の CAD データは再配布不可のため本アプリには同梱しない (利用規約は各社に従う)。
 * verified: 検索結果等で当該 URL (または同一サイト内の該当ページ) の存在を確認済み。
 * false は公式トップ等へのフォールバック (CAD ページを個別に確認できなかったもの)。
 */
export type CadCategory = 'コンベヤ' | 'センサ' | 'ストッパ/エア機器' | '画像検査' | '集約サイト';

export interface CadSource {
  name: string;
  category: CadCategory;
  url: string;
  formats: string;
  note: string;
  verified: boolean;
}

export const CAD_CATEGORIES: CadCategory[] = ['コンベヤ', 'センサ', 'ストッパ/エア機器', '画像検査', '集約サイト'];

export const CAD_SOURCES: CadSource[] = [
  { name: 'MISUMI inCAD Library', category: 'コンベヤ', url: 'https://jp.misumi-ec.com/ec/incadlibrary/detail/000525.html', formats: 'IGES / Parasolid / SAT ほか', note: '簡易平ベルトコンベヤの設計事例 (一括取得)。利用規定の確認が必要', verified: true },
  { name: 'Dorner (DTools)', category: 'コンベヤ', url: 'https://tools.dornerconveyors.com/', formats: 'STEP ほか', note: 'コンベヤを構成して 3D CAD をメールで受け取る', verified: true },
  { name: 'FlexLink', category: 'コンベヤ', url: 'https://flexlink.freshdesk.com/support/solutions/articles/35000186738-tutorial-getting-cad-models-from-flexlink-tools', formats: '複数形式', note: 'CAD モデル入手手順のチュートリアル (PARTcommunity 経由)', verified: true },
  { name: 'Interroll', category: 'コンベヤ', url: 'https://www.interroll.com/products/rollers-and-wheels/series-1700-universal', formats: 'STEP / IGES / SAT / DWG', note: '各製品ページの CAD タブ (例: Series 1700)', verified: true },
  { name: '丸安機械', category: 'コンベヤ', url: 'http://www.maruyasukikai.co.jp/', formats: '要確認', note: '公式トップ (CAD ページは未確認。問い合わせ先から)', verified: false },
  { name: 'OMRON (FA)', category: 'センサ', url: 'https://www.fa.omron.co.jp/download/cad3ds/', formats: '3D CAD (ZIP)', note: 'I-Web メンバーズ (無料登録) が必要', verified: true },
  { name: 'KEYENCE', category: 'センサ', url: 'https://www.keyence.co.jp/ss/general/siteguide/download_cd-ma-so.jsp', formats: 'IGES / DXF ほか', note: '製品ページのダウンロード欄から CAD を選ぶ。一部は製品シリアルが必要', verified: true },
  { name: 'Panasonic Industry', category: 'センサ', url: 'https://industrial.panasonic.com/jp/downloads/cad-download', formats: '3D / 2D CAD', note: '品番検索から。利用条件の同意が必要 (一部は会員登録)', verified: true },
  { name: 'SICK', category: 'センサ', url: 'https://www.sick.com/', formats: '要確認', note: '公式トップ。品番で検索し、製品ページの CAD 寸法モデルを入手 (CAD ページ自体は未確認)', verified: false },
  { name: 'SMC 2D/3D CAD ライブラリ', category: 'ストッパ/エア機器', url: 'https://www.smcworld.com/cadlib/en-jp/', formats: 'STEP / IGES / Parasolid ほか', note: '会員登録 (無料) が必要', verified: true },
  { name: 'CKD', category: 'ストッパ/エア機器', url: 'https://www.ckd.co.jp/kiki/jp/download/3dcad/?p=6', formats: '3D CAD', note: 'ストッパシリンダ STK など。CKD plus 会員限定', verified: true },
  { name: 'コガネイ', category: 'ストッパ/エア機器', url: 'https://product.koganei.co.jp/product/CDA', formats: 'STEP / IGES / Parasolid / DXF', note: '製品詳細ページ (例: CDA) からログインして取得', verified: true },
  { name: 'Festo', category: 'ストッパ/エア機器', url: 'https://www.festo.com/us/en/e/online-shop-id_1669107', formats: 'STEP / IGES / glTF ほか', note: 'オンラインショップ (Express アカウントで CAD 取得可)', verified: true },
  { name: 'OMRON 画像センサ', category: '画像検査', url: 'https://www.fa.omron.co.jp/products/family/1934/download/cad.html', formats: '3D / 2D CAD', note: 'FZD シリーズの CAD ページ。ログインが必要', verified: true },
  { name: 'KEYENCE 画像センサ', category: '画像検査', url: 'https://www.keyence.co.jp/products/vision/vision-sensor/cv-5000/downloads/?mode=ma', formats: 'IGES / DXF ほか', note: 'CV-5000 のダウンロードページ (CAD 欄を選択)', verified: true },
  { name: 'Cognex', category: '画像検査', url: 'https://support.cognex.com/en/resources/cadstep-file/all-in-sight-3900-cad-files/english/TkWW5hwWQryVKZDUe_97Xw', formats: 'STEP', note: 'In-Sight 3900 の STEP (他シリーズも同サイトにあり)', verified: true },
  { name: 'Basler', category: '画像検査', url: 'https://www.baslerweb.com/en/sales-support/downloads/document-downloads/basler-ace-2-camera-link-c-mount-cad-technical-drawing/', formats: '3D モデル + 2D 図 (ZIP)', note: 'カメラごとの CAD ページ (例: ace 2)。形式は ZIP 内で確認', verified: true },
  { name: 'TraceParts', category: '集約サイト', url: 'https://www.traceparts.com/en', formats: 'STEP / IGES / STL ほか', note: '無料会員登録でダウンロード。多数のメーカーカタログを横断検索', verified: true },
  { name: 'PARTcommunity (CADENAS)', category: '集約サイト', url: 'https://www.partcommunity.com/', formats: '多数 (STEP 等)', note: '無料会員登録が必要。公式トップへのリンク (個別ページは未確認)', verified: false },
  { name: '3D ContentCentral', category: '集約サイト', url: 'https://www.3dcontentcentral.com/', formats: 'SOLIDWORKS / STEP ほか', note: '無料。登録が必要な場合あり (公式トップへのリンク)', verified: false },
];

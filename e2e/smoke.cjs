// E2E smoke test: デモモード (APIキーなし) で DEMO.md のシーン 1-4 を通す。
// 使い方: npm run build && npm run e2e
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const ART = path.join(__dirname, 'artifacts');
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log(`✓ ${m} (${((Date.now() - T0) / 1000).toFixed(1)}s)`);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('vite preview が起動しません');
}

async function poll(fn, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`タイムアウト: ${what}`);
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const killServer = () => {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  };
  process.on('exit', killServer);

  let browser;
  let page;
  const errors = [];
  let code = 0;
  try {
    await waitForServer();
    ok('vite preview 起動');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/WebGL|swiftshader|GPU stall|GL Driver|ReadPixels/i.test(t)) return;
      errors.push(`console.error: ${t}`);
    });
    const checkErrors = () => {
      if (errors.length) throw new Error(`ブラウザエラー:\n  ${errors.join('\n  ')}`);
    };

    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    ok('アプリ読込 (localStorage クリア)');

    await page.getByRole('tab', { name: 'チャット' }).click();
    await page.getByText('デモモード').first().waitFor();
    await page.getByLabel('メッセージ').fill('2メートルのコンベヤで箱を流して、真ん中で2秒検査するラインを作って');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByTestId('proposal-card').first().waitFor({ timeout: 15000 });
    ok('シーン1: 提案カード表示');
    await page.getByRole('button', { name: '適用', exact: true }).click();
    await page.getByText('✔ 適用済み').first().waitFor();
    ok('シーン1: 適用');

    await page.getByRole('button', { name: '実行', exact: true }).click();
    await page.getByRole('button', { name: '速度 x4' }).click();
    const completed = async () => {
      const t = await page.locator('.hud-row', { hasText: '完成数' }).locator('b').first().textContent().catch(() => null);
      const n = t ? parseInt(t, 10) : NaN;
      return Number.isNaN(n) ? 0 : n;
    };
    await poll(async () => (await completed()) >= 3, 60000, 'HUD 完成数 >= 3');
    ok(`シーン2: 実行 x4、完成数 ${await completed()}`);

    await page.getByRole('tab', { name: '制御' }).click();
    const st = await page.locator('.ctl').textContent();
    if (!st.includes('PROGRAM') || !st.includes('CV1_Run')) throw new Error('STコードに PROGRAM / CV1_Run が見つかりません');
    ok('シーン2: STコードに PROGRAM / CV1_Run');

    await page.getByRole('button', { name: '固着OFF' }).first().click();
    await poll(async () => (await page.locator('.run-chip').textContent()).includes('異常停止'), 60000, '異常停止');
    ok('シーン4: 在荷センサ固着OFF -> 異常停止');

    await page.getByRole('button', { name: 'すべて解除' }).click();
    await page.getByRole('button', { name: 'アラームリセット' }).click();
    await poll(async () => (await page.locator('.alarm-banner').count()) === 0, 10000, 'アラームバナー消失');
    const before = await completed();
    await poll(async () => (await completed()) > before, 60000, '復帰後に完成数増加');
    ok(`シーン4: 復帰、完成数 ${before} -> ${await completed()}`);

    await page.getByRole('tab', { name: 'チャット' }).click();
    await page.getByLabel('メッセージ').fill('検査を1.5秒にして、コンベヤを1.5倍速にして');
    await page.getByRole('button', { name: '送信' }).click();
    await poll(async () => (await page.getByRole('button', { name: '適用', exact: true }).count()) > 0, 15000, '2件目の提案カード');
    await page.getByRole('button', { name: '適用', exact: true }).click();
    ok('シーン3: 変更提案を適用');

    await page.getByRole('tab', { name: '比較' }).click();
    await page.getByRole('button', { name: '比較を実行' }).click();
    await page.locator('.cmp-table').waitFor({ timeout: 60000 });
    const delta = await page.locator('.cmp-table tbody tr', { hasText: 'サイクルタイム' }).locator('td').nth(3).textContent();
    if (!/−|-/.test(delta)) throw new Error(`サイクルタイムの差が負ではありません: ${delta}`);
    ok(`シーン3: 比較結果 サイクルタイム差 ${delta.trim()}`);

    checkErrors();
    ok('ブラウザエラーなし');
  } catch (e) {
    code = 1;
    console.error(`✗ 失敗: ${e.message}`);
    if (errors.length && !String(e.message).includes('ブラウザエラー')) console.error(`  (ブラウザエラー)\n  ${errors.join('\n  ')}`);
    if (page) {
      fs.mkdirSync(ART, { recursive: true });
      const f = path.join(ART, 'failure.png');
      await page.screenshot({ path: f }).catch(() => {});
      console.error(`  screenshot: ${f}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killServer();
  }
  console.log(`${code ? 'FAIL' : 'PASS'} 合計 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
  process.exit(code);
}

main();

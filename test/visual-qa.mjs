// 可视化验收：用 CDP 驱动无头 Chrome，走完真实创作流程后逐视图截图。
// 仅开发工具，不在发布包内。用法：node dev/shoot.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const NO_KEY_BASE = process.env.NO_KEY_BASE || '';
const OUT = new URL('../test/.shots/', import.meta.url).pathname.replace(/^\//, '');
const PROFILE = process.env.TEMP + '\\mimo-cdp-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--font-render-hinting=none', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--window-size=1440,980', 'about:blank'
], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = e => {
          const msg = JSON.parse(e.data);
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
        };
        return;
      }
    } catch (e) { }
    await sleep(250);
  }
  throw new Error('无法连接 Chrome CDP');
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
  return r.result.value;
}
async function shot(name, url, waitMs = 1400, view = '') {
  await send('Page.navigate', { url });
  // 仅 hash 不同时是同文档导航，不会重建页面：显式点击导航按钮保证截到目标工作站
  if (view) await js(`(() => { const b = document.querySelector('.nav-btn[data-view="${view}"]'); if (b) b.click(); return 1; })()`);
  await sleep(waitMs);
  const img = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name + '.png', Buffer.from(img.data, 'base64'));
  const errs = consoleErrs.filter(l => !l.includes(url));
  console.log('  → test/.shots/' + name + '.png' + (errs.length ? '  ⚠ 控制台错误: ' + errs.length : ''));
}
const consoleErrs = [];
function watchErrors() {
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrs.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
  });
}

const WAV = `(() => {
  const sr = 24000, n = sr, bytes = new ArrayBuffer(44 + n * 2), v = new DataView(bytes);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4, 36 + n*2, true); ws(8,'WAVE'); ws(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true);
  v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,n*2,true);
  for (let i=0;i<n;i++) v.setInt16(44+i*2, Math.round(Math.sin(i/40)*9000), true);
  const dt = new DataTransfer(); dt.items.add(new File([bytes], '录音棚样本.wav', { type: 'audio/wav' }));
  const inp = document.querySelector('#fileInput'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  return 'ok';
})()`;

try {
  await new Promise(r => setTimeout(r, 800));
  await connect();
  watchErrors();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => { });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });

  // 1) 朗读：填文本 → 真实合成 → 截图（含生成结果面板与底部播放器）
  await shot('01-read-empty', BASE + '/?s=1#read', 1800, 'read');
  await js(`(() => { const ta=document.querySelector('#ttsText'); ta.value='(磁性)夜已经深了，城市还在呼吸。欢迎收听午夜电台。'; ta.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#btnSamples').click(); return 'ok'; })()`);
  await shot('02-read-menu', BASE + '/?s=1#read', 1600, 'read');
  await js(`(() => { const ta=document.querySelector('#ttsText'); ta.value='(磁性)夜已经深了，城市还在呼吸。欢迎收听《午夜电台》。\\n\\n第二章。天亮时，他提着行李箱站在门口，回头看了最后一眼。'; ta.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#btnQueueRead').click(); return 'ok'; })()`);
  await sleep(1200);
  await shot('03-read-queue', BASE + '/?s=1#read', 1000, 'read');
  await sleep(9000);
  await shot('04-read-done', BASE + '/?s=1#read', 1600, 'read');

  // 2) 音色设计
  await js(`(() => { document.querySelector('.nav-btn[data-view=design]').click(); document.querySelector('#designTplRow .chip').click(); document.querySelector('#btnGenDesign').click(); return 'ok'; })()`);
  await sleep(6500);
  await shot('05-design', BASE + '/?s=2#design', 1600, 'design');

  // 3) 音色克隆：上传样本 → 保存 → 克隆合成
  await js(`(() => { document.querySelector('.nav-btn[data-view=clone]').click(); return 'ok'; })()`);
  await js(WAV);
  await sleep(1500);
  await shot('06-clone-upload', BASE + '/?s=2#clone', 1200, 'clone');
  await js(`(() => { document.querySelector('#btnSaveSample').click(); return 'ok'; })()`);
  await sleep(1200);
  await js(`(() => { const ta=document.querySelector('#cloneText'); ta.value='（轻笑）用你的声音，说这句话。'; ta.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#btnGenClone').click(); return 'ok'; })()`);
  await sleep(6500);
  await shot('07-clone-done', BASE + '/?s=2#clone', 1600, 'clone');

  // 4) 媒体库（批量选择）
  await js(`(() => { document.querySelector('.nav-btn[data-view=library]').click(); return 'ok'; })()`);
  await sleep(1500);
  await js(`(() => { const c=document.querySelectorAll('#libBody .lib-check'); c[0].click(); c[1].click(); return 'ok'; })()`);
  await shot('08-library', BASE + '/?s=2#library', 1400, 'library');

  // 5) 设置
  await shot('09-settings', BASE + '/?s=2#settings', 1600, 'settings');

  // 6) 暗色主题
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await shot('10-dark-read', BASE + '/?s=3&theme=dark#read', 1800, 'read');
  await shot('11-dark-library', BASE + '/?s=3&theme=dark#library', 1600, 'library');

  // 7) 移动端
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 880, deviceScaleFactor: 1, mobile: true });
  await shot('12-mobile-read', BASE + '/?s=3&theme=dark#read', 1800, 'read');
  await shot('13-mobile-library', BASE + '/?s=3#library', 1600, 'library');

  // 8) 首次访问引导（无服务端密钥的实例）
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  if (NO_KEY_BASE) await shot('14-setup', NO_KEY_BASE + '/?u=1#read', 2600, 'read');

  // 9) 末态检查
  const state = await js(`JSON.stringify({ theme: document.documentElement.dataset.theme, rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width), overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, svc: document.querySelector('#svcPill').textContent.trim() })`);
  console.log('  末态：' + state);
  console.log(consoleErrs.length ? '  ⚠ 控制台问题:\n   ' + consoleErrs.slice(0, 8).join('\n   ') : '  ✓ 全程无控制台错误与未捕获异常');
} catch (e) {
  console.error('截图流程失败：' + (e.message || e));
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (e) { }
  chrome.kill();
}

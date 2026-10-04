// 端到端检查：静态资源 + 函数校验分支 + 非流式与 SSE 流式透传。
// 用法：node dev/check.mjs http://127.0.0.1:4173 [期望 serverKey=true|false]
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const WANT_SERVER_KEY = process.argv[3] !== 'false';
const FN = BASE + '/functions/v1/app';
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
async function post(body, signal) {
  const res = await fetch(FN + '?action=tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal
  });
  return res;
}

// 1. 静态资源
const home = await fetch(BASE + '/');
const html = await home.text();
ok('首页 200 + HTML', home.status === 200 && html.includes('<title>MiMo 语音工坊') && html.includes('type="module"'), home.status);
for (const p of ['/css/studio.css', '/js/app.js', '/js/data.js', '/icon.svg']) {
  const r = await fetch(BASE + p);
  const t = await r.text();
  ok('静态资源 ' + p, r.status === 200 && t.length > 200 && !/^\s*<\/?html/.test(t), r.status + ' ' + (r.headers.get('content-type') || ''));
}

// 2. ping
const ping = await (await fetch(FN + '?action=ping')).json();
ok('ping 返回服务状态', ping.ok === true && ping.serverKey === WANT_SERVER_KEY && ping.endpoint === 'custom', JSON.stringify(ping));

// 3. 方法 / 路由
ok('未知 action → 404', (await fetch(FN + '?action=nope')).status === 404);
ok('ping 拒绝 POST → 405', (await fetch(FN, { method: 'POST', body: '{}' })).status === 405);

// 4. 入参白名单
const badModel = await post({ model: 'gpt-4', messages: [{ role: 'assistant', content: 'x' }] });
ok('非白名单模型被拒', badModel.status === 400 && (await badModel.json()).error === 'invalid_request');
const badAudio = await post({ model: 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: 'x' }], audio: { voice: '冰糖', temperature: 0.7 } });
ok('audio 未知字段被拒', badAudio.status === 400 && /temperature/.test((await badAudio.json()).message));
const badRole = await post({ model: 'mimo-v2.5-tts', messages: [{ role: 'system', content: 'x' }, { role: 'assistant', content: 'x' }] });
ok('非 user/assistant 角色被拒', badRole.status === 400);
const badMsg = await post({ model: 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }] });
ok('必须只有一条 assistant', badMsg.status === 400);
const badVoice = await post({ model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'assistant', content: 'a' }], audio: { voice: 'data:text/html;base64,AA==' } });
ok('非音频 data URL 被拒', badVoice.status === 400);
const emptyMsg = await post({ model: 'mimo-v2.5-tts', messages: [] });
ok('空 messages 被拒', emptyMsg.status === 400);
const designOnly = await post({
  model: 'mimo-v2.5-tts-voicedesign', apiKey: WANT_SERVER_KEY ? undefined : 'sk-visitor-key',
  messages: [{ role: 'user', content: '低沉醇厚的男声' }], audio: { optimize_text_preview: true, format: 'wav' }
});
ok('音色设计允许只有描述（无 assistant 文本）', designOnly.status === 200, designOnly.status);

// 5. 密钥缺失
if (!WANT_SERVER_KEY) {
  const noKey = await post({ model: 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: '测试' }] });
  const j = await noKey.json();
  ok('无密钥 → 401 key_required', noKey.status === 401 && j.error === 'key_required', JSON.stringify(j));
}

// 6. 非流式：服务端密钥路径
const one = await post({
  model: 'mimo-v2.5-tts', apiKey: WANT_SERVER_KEY ? undefined : 'sk-visitor-key',
  messages: [{ role: 'user', content: '平静' }, { role: 'assistant', content: '连接测试。' }],
  audio: { voice: 'mimo_default', format: 'wav' }, endpoint: 'auto', baseUrl: 'https://evil.example.com/v1'
});
const j1 = await one.json();
ok('非流式合成成功（忽略浏览器 baseUrl）', one.status === 200 && !!j1.choices?.[0]?.message?.audio?.data, one.status);
ok('转发的是本地假上游', j1.echo && j1.echo.format === 'wav' && j1.echo.messages.length === 2, JSON.stringify(j1.echo || {}));

// 7. 访客密钥路径 + 克隆样本透传
const clone = await post({
  model: 'mimo-v2.5-tts-voiceclone', apiKey: 'sk-visitor-key',
  messages: [{ role: 'assistant', content: '克隆测试。' }],
  audio: { voice: 'data:audio/wav;base64,' + 'AAAB'.repeat(64), format: 'wav' }
});
const j2 = await clone.json();
ok('访客密钥 + 样本 data URL 通过', clone.status === 200 && j2.echo && j2.echo.voice.startsWith('data:audio/wav;base64,'), clone.status + ' ' + JSON.stringify(j2.message || ''));

// 8. SSE 流式透传
const sres = await post({
  model: 'mimo-v2.5-tts', apiKey: WANT_SERVER_KEY ? undefined : 'sk-visitor-key',
  messages: [{ role: 'assistant', content: '流式测试。' }],
  audio: { voice: '冰糖', format: 'pcm16' }, stream: true
});
ok('流式响应为 event-stream', sres.status === 200 && /text\/event-stream/.test(sres.headers.get('content-type') || ''), sres.headers.get('content-type'));
const reader = sres.body.getReader(), dec = new TextDecoder();
let buf = '', events = [], done = false;
while (!done) {
  const r = await reader.read(); if (r.done) break;
  buf += dec.decode(r.value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line.startsWith('data:')) continue;
    const d = line.slice(5).trim();
    if (d === '[DONE]') { done = true; break; }
    const parsed = JSON.parse(d);
    if (parsed.choices?.[0]?.delta?.audio?.data) events.push(parsed.choices[0].delta.audio.data.length);
  }
}
ok('SSE 分片完整透传（3 段 pcm16）', events.length === 3 && events.every(n => n > 100), JSON.stringify(events));

// 9. 取消：abort 不应让服务崩溃
const ac = new AbortController();
const p = post({ model: 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: '取消测试。' }], audio: { format: 'pcm16' }, stream: true }, ac.signal);
ac.abort();
let aborted = false;
try { await p; } catch (e) { aborted = e.name === 'AbortError'; }
ok('客户端中断可处理', aborted);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/* 服务端转发入口：默认同源服务端函数，可指向自建代理（GitHub Pages / 静态托管用） */

import { state } from './state.js';
import { b64ToBlob } from './audio.js';

export function fnUrl() {
  const custom = (state.proxyUrl || '').trim();
  if (custom) return custom.replace(/\/+$/, '');
  return new URL('functions/v1/app', document.baseURI).href;
}

export function isCustomProxy() { return Boolean((state.proxyUrl || '').trim()); }

async function errorFrom(res) {
  let msg = '服务请求失败（' + res.status + '）';
  let code = '';
  try {
    const j = await res.json();
    code = j.error || '';
    if (j.message) msg = j.message;
    else if (j.error && j.error.message) msg = j.error.message;
    if (j.detail) msg += ' · ' + String(j.detail).slice(0, 220);
  } catch (e) { /* 非 JSON 错误体 */ }
  const err = new Error(msg);
  err.code = code;
  err.status = res.status;
  return err;
}

export function buildPayload(cfg, useStream) {
  const audio = Object.assign({}, cfg.audioOpts, { format: useStream ? 'pcm16' : 'wav' });
  const p = { model: cfg.model, messages: cfg.messages, audio };
  if (useStream) p.stream = true;
  if (state.apiKey) p.apiKey = state.apiKey;
  p.endpoint = state.keyTypeSel;
  return p;
}

export async function* sseChat(payload, signal) {
  const res = await fetch(fnUrl() + '?action=tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal
  });
  if (!res.ok) throw await errorFrom(res);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.indexOf('data:') !== 0) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch (e) { /* 分片边界，忽略 */ }
    }
  }
  const tail = buf.trim();
  if (tail.indexOf('data:') === 0) {
    const data = tail.slice(5).trim();
    if (data && data !== '[DONE]') { try { yield JSON.parse(data); } catch (e) { } }
  }
}

export async function callOnce(payload, signal) {
  const res = await fetch(fnUrl() + '?action=tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal
  });
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json().catch(() => ({}));
  const b64 = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.audio && j.choices[0].message.audio.data;
  if (!b64) throw new Error('接口未返回音频数据，请检查 API Key 与文本内容');
  return b64ToBlob(b64, 'audio/wav');
}

export async function pingService() {
  try {
    const res = await fetch(fnUrl() + '?action=ping');
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch (e) { return null; }
}

/* 一次性连通性测试：返回 {ok, blob?, message?, detail?} */
export async function requestOnce() {
  const payload = {
    model: 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: '连接测试。' }],
    audio: { format: 'wav', voice: 'mimo_default' }, endpoint: state.keyTypeSel
  };
  if (state.apiKey) payload.apiKey = state.apiKey;
  const res = await fetch(fnUrl() + '?action=tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await res.json().catch(() => ({}));
  const data = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.audio && j.choices[0].message.audio.data;
  if (res.ok && data) return { ok: true, blob: b64ToBlob(data, 'audio/wav') };
  return { ok: false, message: j.message || (j.error && j.error.message) || ('请求失败 ' + res.status), detail: j.detail || '' };
}

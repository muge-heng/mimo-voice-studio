/* 设置：凭证、转发地址、连通性测试与本地存储用量 */

import { state } from '../lib/state.js';
import { requestOnce, pingService } from '../lib/api.js';
import { setSetting } from '../lib/db.js';
import { $, fmtBytes } from '../lib/utils.js';
import { toast } from '../ui/toast.js';
import { updateApiPill, updateKeyBadge, renderSvcState } from '../ui/status.js';
import { Player } from '../ui/player.js';

export async function saveSettings() {
  state.apiKey = $('#apiKeyInput').value.trim();
  state.keyTypeSel = $('#keyType').value;
  const proxy = $('#proxyInput').value.trim();
  if (proxy && !/^https?:\/\//i.test(proxy)) {
    toast('转发地址需是 http(s) 开头的完整地址', 'err');
    return false;
  }
  state.proxyUrl = proxy;
  await setSetting('apiKey', state.apiKey);
  await setSetting('keyType', state.keyTypeSel);
  await setSetting('proxyUrl', state.proxyUrl);
  updateApiPill();
  updateKeyBadge();
  toast(state.apiKey ? '凭证与转发地址已保存到本机' : '已清空本机 Key' + (state.serverKey ? '，将使用站点内置密钥' : ''), 'ok');
  return true;
}

export async function testConnection() {
  if (!(await saveSettings())) return;
  const btn = $('#btnTestKey');
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const r = await requestOnce();
    if (r.ok) {
      toast('连接成功，接口已返回音频 · ' + fmtBytes(r.blob.size), 'ok', 4600);
      Player.load({ blob: r.blob, title: '连接测试', voiceLabel: '测试合成', duration: 0 });
    } else {
      toast('连接失败：' + r.message + (r.detail ? ' · ' + String(r.detail).slice(0, 140) : ''), 'err', 6000);
    }
  } catch (e) {
    toast('连接失败：' + (e.message || e), 'err', 6000);
  }
  btn.disabled = false;
  btn.textContent = '测试连接';
}

export async function forgetKey() {
  $('#apiKeyInput').value = '';
  state.apiKey = '';
  await setSetting('apiKey', '');
  updateApiPill();
  updateKeyBadge();
  toast('已清除本机 API Key', 'ok');
}

/* 重新探测转发服务（切换自建地址后调用） */
export async function refreshService() {
  const svc = await pingService();
  state.svc = svc;
  state.serverKey = !!(svc && svc.serverKey);
  renderSvcState();
  updateApiPill();
  updateKeyBadge();
  return svc;
}

export async function updateStorage() {
  try {
    const e = await navigator.storage.estimate();
    $('#storageInfo').textContent = '本地存储（IndexedDB）已用 ' + fmtBytes(e.usage || 0) + ' / 配额约 ' + fmtBytes(e.quota || 0);
  } catch (e) {
    $('#storageInfo').textContent = '浏览器不支持存储用量统计';
  }
}

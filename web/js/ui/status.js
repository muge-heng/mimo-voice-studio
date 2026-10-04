/* 顶栏状态胶囊、密钥徽标与服务状态（纯展示，供各功能模块调用） */

import { state, detectKeyType } from '../lib/state.js';
import { $, esc } from '../lib/utils.js';
import { I } from '../data.js';

export function updateApiPill() {
  const p = $('#apiPill');
  if (state.apiKey) { p.className = 'pill ok'; p.innerHTML = '<span class="dot"></span>API 已配置'; }
  else if (state.serverKey) { p.className = 'pill ok'; p.innerHTML = '<span class="dot"></span>API 站点内置'; }
  else { p.className = 'pill warn'; p.innerHTML = '<span class="dot"></span>API 未配置'; }
}

export function updateDirPill() {
  const p = $('#dirPill');
  if (!state.exportDir) { p.className = 'pill'; p.innerHTML = I.folder + ' 未设导出目录'; }
  else { p.className = 'pill ' + (state.dirGranted ? 'ok' : 'warn'); p.innerHTML = I.folder + ' ' + esc(state.exportDir.name); }
}

export function updateKeyBadge() {
  const b = $('#keyBadge'), k = $('#apiKeyInput').value.trim();
  if (!k) {
    if (state.serverKey) { b.className = 'key-badge ok'; b.textContent = '本机未填 Key · 将使用站点服务端内置密钥'; }
    else { b.className = 'key-badge warn'; b.textContent = '尚未填写 Key，且站点未配置内置密钥 —— 无法合成'; }
    return;
  }
  const eff = state.keyTypeSel === 'auto' ? detectKeyType(k) : state.keyTypeSel;
  if (state.keyTypeSel === 'auto' && !eff) {
    b.className = 'key-badge warn';
    b.textContent = '无法根据前缀识别（sk- / tp-），将默认走按量付费接口';
    return;
  }
  const name = eff === 'token' ? 'Token Plan（tp-）' : '按量付费（sk-）';
  const host = eff === 'token' ? 'token-plan-cn.xiaomimimo.com/v1' : 'api.xiaomimimo.com/v1';
  b.className = 'key-badge ok';
  b.textContent = name + ' · ' + host + ' · 经 ' + ((state.proxyUrl || '').trim() || '同源服务函数') + ' 转发';
}

export function renderSvcState() {
  const box = $('#svcState');
  if (!state.svc) {
    box.className = 'svc-state err';
    box.innerHTML = I.warn + '<span>未检测到可用的转发服务：静态托管（如 GitHub Pages）只发布前端，请在「设置 · 转发地址」填写自建代理地址，或本地运行仓库自带的转发服务。</span>';
    return;
  }
  box.className = 'svc-state ok';
  box.innerHTML = I.check + '<span>服务在线 · 接入点 ' + (state.svc.endpoint === 'custom' ? '自定义' : 'MiMo 官方') +
    ' · 服务端内置密钥 ' + (state.svc.serverKey ? '已配置' : '未配置') + '</span>';
}

export function renderServicePill() {
  const rail = $('#svcPill');
  if (state.svc) {
    rail.className = 'svc-line ok';
    rail.innerHTML = '<span class="dot"></span>' + (state.serverKey ? '服务就绪 · 内置密钥' : '服务就绪 · 需自备 Key');
  } else {
    rail.className = 'svc-line warn';
    rail.innerHTML = '<span class="dot"></span>未检测到转发服务';
  }
}

export function openSetup() {
  $('#setupOverlay').classList.add('show');
  if (state.apiKey) $('#setupKey').value = state.apiKey;
}

export function closeSetup() { $('#setupOverlay').classList.remove('show'); }

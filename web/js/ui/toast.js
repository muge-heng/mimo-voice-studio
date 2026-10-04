/* 轻提示与弹窗 */

import { $, esc } from '../lib/utils.js';
import { I } from '../data.js';

export function toast(msg, type, ms) {
  type = type || 'info';
  ms = ms || 3400;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = (type === 'ok' ? I.check : type === 'err' || type === 'warn' ? I.warn : I.info) + '<span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

export function openModal(inner) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = '<div class="modal">' + inner + '</div>';
  $('#modalRoot').appendChild(mask);
  const close = () => { mask.classList.add('out'); setTimeout(() => mask.remove(), 220); };
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  return { mask, close };
}

export function confirmBox(o) {
  return new Promise(res => {
    const m = openModal('<div class="m-head"><h3>' + esc(o.title) + '</h3></div><div class="m-body">' + (o.html || esc(o.body || '')) + '</div>' +
      '<div class="m-foot"><button class="btn btn-ghost" data-close>' + esc(o.cancel || '取消') + '</button>' +
      '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(o.ok || '确定') + '</button></div>');
    m.mask.querySelector('[data-ok]').onclick = () => { m.close(); res(true); };
    m.mask.querySelector('[data-close]').onclick = () => { m.close(); res(false); };
  });
}

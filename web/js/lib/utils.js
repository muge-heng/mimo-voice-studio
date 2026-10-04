/* 通用工具：DOM 选择、格式化、命名与下载 */

export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; };
export const fmtDur = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
export const fmtBytes = b => { if (!b) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; };
export const fmtDate = ts => { const d = new Date(ts), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
export function tsName(d) { d = d || new Date(); const p = n => String(n).padStart(2, '0'); return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
export const tsNameFromDate = ts => tsName(new Date(ts));
export const safeName = s => (String(s || 'audio').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)) || 'audio';
export function makeTitle(t, n) { n = n || 16; t = String(t || '').replace(/^[(（\[][^)）\]]*[)）\]]/, '').replace(/\s+/g, ' ').trim(); return t.slice(0, n) || '未命名'; }
export function splitSegments(text) {
  return String(text || '').split(/\n\s*\n+/).map(s => s.trim()).filter(s => s.length > 0);
}
export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/* 音色指纹：由 id 决定的稳定条形图案 */
export function voiceSpark(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 14; i++) { h = (h * 1103515245 + 12345) >>> 0; out += '<i style="height:' + (22 + (h % 78)) + '%"></i>'; }
  return '<div class="v-spark">' + out + '</div>';
}

/* 列表与面板渲染：音色网格、样本库、设计库、媒体库、统计、标签面板 */

import { $, $$, esc, fmtDur, fmtBytes, fmtDate, debounce, splitSegments, voiceSpark } from '../lib/utils.js';
import { dbAll, dbGet, setSetting } from '../lib/db.js';
import { state } from '../lib/state.js';
import { nav } from './nav.js';
import { toast, openModal } from './toast.js';
import { I, VOICES, STYLE_TAGS, AUDIO_TAGS, GROUP_COLOR, KINDS } from '../data.js';

/* ---------- 朗读 / 克隆编辑器计数 ---------- */
export function updateCounts() {
  const t = $('#ttsText').value;
  $('#charCount').textContent = t.length;
  $('#estDur').textContent = fmtDur(t.length / 4.3);
  const segs = splitSegments(t);
  const n = Math.max(1, segs.length);
  $('#segCount').textContent = n;
  $('#queueSegN').textContent = n;
  $('#btnQueueRead').disabled = n < 2;
  $('#cloneCharCount').textContent = $('#cloneText').value.length;
}

/* ---------- 括号标签面板 ---------- */
function startTags(ta) {
  const m = String(ta.value).match(/^[(（\[]([^)）\]]*)[)）\]]/);
  return m ? m[1].trim().split(/[\s,，、·]+/).filter(Boolean) : [];
}
function toggleStartStyle(ta, style) {
  const v = ta.value, m = v.match(/^[(（\[]([^)）\]]*)[)）\]]/);
  if (m) {
    const parts = m[1].trim().split(/[\s,，、·]+/).filter(Boolean);
    const i = parts.indexOf(style);
    if (i >= 0) parts.splice(i, 1); else parts.push(style);
    ta.value = (parts.length ? '(' + parts.join(' ') + ')' : '') + v.slice(m[0].length);
  } else ta.value = '(' + style + ')' + v;
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const pos = s + text.length;
  ta.setSelectionRange(pos, pos);
}
export function renderTagPanel(container, taId) {
  let mode = 'style';
  container.innerHTML = '<div class="tag-head"><div class="tag-tabs">' +
    '<button class="tag-tab active" data-m="style">风格标签 (…)</button>' +
    '<button class="tag-tab" data-m="audio">音频标签 (…)</button></div>' +
    '<input class="tag-search" placeholder="搜索标签…" aria-label="搜索标签"></div>' +
    '<div class="tag-body"></div>' +
    '<div class="tag-tip">风格标签放<b>文本开头</b>（点击叠加或移除，如 <code>(温柔 慵懒)</code>）；音频标签插<b>光标处</b>；括号支持 <code>()</code> / <code>（）</code> / <code>[]</code>。</div>';
  const body = container.querySelector('.tag-body'), search = container.querySelector('.tag-search');
  function draw() {
    const ta = document.getElementById(taId);
    const active = mode === 'style' ? startTags(ta) : [];
    const q = (search.value || '').trim().toLowerCase();
    const groups = mode === 'style' ? STYLE_TAGS : AUDIO_TAGS;
    let html = '';
    for (const gname in groups) {
      const hit = q ? groups[gname].filter(t => t.toLowerCase().indexOf(q) >= 0) : groups[gname];
      if (!hit.length) continue;
      html += '<div class="tag-group" style="--c:var(' + (GROUP_COLOR[gname] || '--g-emotion') + ')"><h4>' + esc(gname) + '</h4><div>' +
        hit.map(t => '<button class="chip' + ((t === '唱歌' || t === 'sing' || t === 'singing') ? ' special' : '') +
          (active.indexOf(t) >= 0 ? ' on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div></div>';
    }
    body.innerHTML = html || '<div class="tag-empty">没有匹配的标签</div>';
  }
  container.addEventListener('click', e => {
    const tab = e.target.closest('.tag-tab');
    if (tab) {
      mode = tab.dataset.m;
      container.querySelectorAll('.tag-tab').forEach(t => t.classList.toggle('active', t === tab));
      draw();
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      const ta = document.getElementById(taId);
      if (mode === 'style') toggleStartStyle(ta, chip.dataset.tag);
      else insertAtCursor(ta, '（' + chip.dataset.tag + '）');
      ta.focus();
      updateCounts();
      draw();
    }
  });
  search.addEventListener('input', debounce(draw, 120));
  draw();
  container._redraw = draw;
}
export function redrawTagPanels() { $$('.tag-panel').forEach(p => p._redraw && p._redraw()); }

/* ---------- 音色网格 ---------- */
export function renderVoices() {
  $('#voiceGrid').innerHTML = VOICES.map(v =>
    '<div class="voice-item' + (state.voice === v.id ? ' sel' : '') + '" data-id="' + esc(v.id) + '" role="button" tabindex="0">' +
    '<div class="v-name">' + esc(v.name) + '</div>' +
    '<div class="v-badges"><span class="v-lang">' + esc(v.lang) + '</span><span class="v-g ' + v.g + '">' + esc(v.gender) + '</span></div>' +
    voiceSpark(v.id) + '</div>').join('');
}
export function voiceName(id) { const v = VOICES.filter(x => x.id === id)[0]; return v ? v.name : id; }

/* ---------- 侧栏：样本 / 设计 ---------- */
export async function renderSamples() {
  const list = await dbAll('samples');
  list.sort((a, b) => b.createdAt - a.createdAt);
  $('#sampleCount').textContent = list.length ? list.length + ' 个' : '';
  const box = $('#sampleList');
  if (!list.length) { box.innerHTML = '<div class="empty small">' + I.mic + '<p>还没有克隆样本，上传或现场录一段</p></div>'; return; }
  box.innerHTML = list.map(s =>
    '<div class="side-item' + (state.selectedSample === s.id ? ' sel' : '') + '" data-id="' + s.id + '">' +
    '<label class="radio"><input type="radio" name="sr"' + (state.selectedSample === s.id ? ' checked' : '') + ' aria-label="选择样本"></label>' +
    '<div class="si-main"><b>' + esc(s.name) + '</b><span>' + fmtDur(s.duration) + ' · ' + fmtBytes(s.size) + ' · ' + fmtDate(s.createdAt) + '</span></div>' +
    '<div class="si-acts"><button class="icon-btn" data-act="play" title="试听">' + I.play + '</button>' +
    '<button class="icon-btn" data-act="dl" title="下载">' + I.dl + '</button>' +
    '<button class="icon-btn danger" data-act="del" title="删除">' + I.trash + '</button></div></div>').join('');
}
export async function updateCloneSel() {
  const el = $('#cloneSelInfo');
  if (!state.selectedSample) { el.textContent = '未选择样本'; el.className = 'card-sub warn'; return; }
  const s = await dbGet('samples', state.selectedSample);
  if (!s) { el.textContent = '未选择样本'; el.className = 'card-sub warn'; return; }
  el.textContent = '当前样本：' + s.name + ' · ' + fmtDur(s.duration) + ' · ' + fmtBytes(s.size);
  el.className = 'card-sub ok';
}
export async function renderDesigns() {
  const list = await dbAll('designs');
  list.sort((a, b) => b.createdAt - a.createdAt);
  $('#designCount').textContent = list.length ? list.length + ' 个' : '';
  const box = $('#designList');
  if (!list.length) { box.innerHTML = '<div class="empty small">' + I.waveBig + '<p>还没有音色设计</p></div>'; return; }
  box.innerHTML = list.map(d =>
    '<div class="side-item" data-id="' + d.id + '">' +
    '<div class="si-main"><b>' + esc(d.name) + '</b><span class="clamp2">' + esc(d.description) + '</span></div>' +
    '<div class="si-acts"><button class="icon-btn" data-act="preview" title="试听预览">' + I.play + '</button>' +
    '<button class="icon-btn" data-act="use" title="载入描述重新生成">' + I.refresh + '</button>' +
    '<button class="icon-btn danger" data-act="del" title="删除">' + I.trash + '</button></div></div>').join('');
}

/* ---------- 媒体库 ---------- */
export const lib = { tab: 'audio', sort: 'new', sel: new Set() };

function sortList(list) {
  const by = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    dur: (a, b) => (b.duration || 0) - (a.duration || 0),
    size: (a, b) => (b.size || 0) - (a.size || 0),
    name: (a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'zh')
  }[lib.sort];
  return list.sort(by);
}
function matchQ(r, q) {
  return !q || ((r.title || '') + (r.name || '') + (r.text || '') + (r.voiceLabel || '') + (r.description || '') + (r.instr || '')).toLowerCase().indexOf(q) >= 0;
}
export async function renderStats() {
  const [audio, samples, designs] = await Promise.all([dbAll('audio'), dbAll('samples'), dbAll('designs')]);
  const total = audio.reduce((s, r) => s + (r.duration || 0), 0);
  const bytes = audio.reduce((s, r) => s + (r.size || 0), 0) + samples.reduce((s, r) => s + (r.size || 0), 0);
  const exp = audio.filter(r => r.exported).length;
  const cards = [
    ['accent', audio.length, '生成音频'], ['', fmtDur(total), '总时长'],
    ['', samples.length, '克隆样本'], ['', designs.length, '音色设计'],
    ['', fmtBytes(bytes), '占用体积'], ['', exp + ' / ' + audio.length, '已落盘']
  ];
  $('#libStats').innerHTML = cards.map(c =>
    '<div class="stat ' + c[0] + '"><b>' + esc(String(c[1])) + '</b><span>' + esc(c[2]) + '</span></div>').join('');
}
function emptyFor(tab, q) {
  if (q) return '<div class="empty small">' + I.info + '<p>没有匹配「' + esc(q) + '」的条目</p></div>';
  const map = {
    audio: [I.waveBig, '还没有音频记录', 'read', '去创作第一段语音'],
    samples: [I.mic, '还没有克隆样本', 'clone', '去上传声音样本'],
    designs: [I.waveBig, '还没有音色设计', 'design', '去设计一个音色']
  }[tab];
  return '<div class="empty">' + map[0] + '<p>' + map[1] + '</p><button class="btn btn-primary" data-goto="' + map[2] + '">' + map[3] + '</button></div>';
}
export async function renderLibrary() {
  const body = $('#libBody');
  const q = ($('#libSearch').value || '').trim().toLowerCase();
  if (lib.tab === 'audio') {
    const f = $('#libFilter').value;
    let list = await dbAll('audio');
    if (f !== 'all') list = list.filter(r => r.kind === f);
    list = sortList(list.filter(r => matchQ(r, q)));
    body.innerHTML = list.length ? list.map(r => {
      const k = KINDS[r.kind] || { label: r.kind, cls: '' };
      return '<div class="lib-item' + (lib.sel.has(r.id) ? ' sel' : '') + '" data-id="' + r.id + '">' +
        '<button class="lib-check' + (lib.sel.has(r.id) ? ' on' : '') + '" data-act="sel" title="选择" aria-label="选择">' + I.check + '</button>' +
        '<button class="lib-play" data-act="play" title="播放">' + I.play + '</button>' +
        '<div class="lib-main"><div class="lib-title">' + esc(r.title) +
        '<span class="kbadge ' + k.cls + '">' + esc(k.label) + '</span>' +
        (r.seg ? '<span class="lib-seg">段 ' + String(r.seg).padStart(2, '0') + '</span>' : '') +
        (r.exported ? '<span class="kbadge k-exp">已导出</span>' : '') + '</div>' +
        '<div class="lib-sub">' + esc(r.voiceLabel || r.model) + ' · ' + fmtDur(r.duration) + ' · ' + fmtBytes(r.size) + ' · ' + fmtDate(r.createdAt) + '</div></div>' +
        '<div class="lib-acts"><button class="icon-btn" data-act="dl" title="下载">' + I.dl + '</button>' +
        '<button class="icon-btn" data-act="export" title="导出到目录">' + I.folder + '</button>' +
        '<button class="icon-btn" data-act="use" title="载入到编辑器">' + I.edit + '</button>' +
        '<button class="icon-btn" data-act="info" title="详情">' + I.info + '</button>' +
        '<button class="icon-btn danger" data-act="del" title="删除">' + I.trash + '</button></div></div>';
    }).join('') : emptyFor('audio', q);
  } else if (lib.tab === 'samples') {
    const list = sortList((await dbAll('samples')).filter(s => matchQ(s, q)));
    body.innerHTML = list.length ? list.map(s =>
      '<div class="lib-item' + (lib.sel.has(s.id) ? ' sel' : '') + '" data-id="' + s.id + '">' +
      '<button class="lib-check' + (lib.sel.has(s.id) ? ' on' : '') + '" data-act="sel" title="选择" aria-label="选择">' + I.check + '</button>' +
      '<button class="lib-play" data-act="play" title="播放">' + I.play + '</button>' +
      '<div class="lib-main"><div class="lib-title">' + esc(s.name) + '<span class="kbadge k-clone">克隆样本</span></div>' +
      '<div class="lib-sub">' + (s.mime.indexOf('mpeg') >= 0 ? 'MP3' : 'WAV') + ' · ' + fmtDur(s.duration) + ' · ' + fmtBytes(s.size) + ' · ' + fmtDate(s.createdAt) + '</div></div>' +
      '<div class="lib-acts"><button class="icon-btn" data-act="dl" title="下载">' + I.dl + '</button>' +
      '<button class="icon-btn" data-act="archive" title="存档到导出目录">' + I.folder + '</button>' +
      '<button class="icon-btn" data-act="use" title="选为当前样本">' + I.check + '</button>' +
      '<button class="icon-btn danger" data-act="del" title="删除">' + I.trash + '</button></div></div>').join('') : emptyFor('samples', q);
  } else {
    const list = sortList((await dbAll('designs')).filter(d => matchQ(d, q)));
    body.innerHTML = list.length ? list.map(d =>
      '<div class="lib-item' + (lib.sel.has(d.id) ? ' sel' : '') + '" data-id="' + d.id + '">' +
      '<button class="lib-check' + (lib.sel.has(d.id) ? ' on' : '') + '" data-act="sel" title="选择" aria-label="选择">' + I.check + '</button>' +
      '<button class="lib-play" data-act="preview" title="试听预览">' + I.play + '</button>' +
      '<div class="lib-main"><div class="lib-title">' + esc(d.name) + '<span class="kbadge k-design">音色设计</span></div>' +
      '<div class="lib-sub clamp2">' + esc(d.description) + '</div></div>' +
      '<div class="lib-acts"><button class="icon-btn" data-act="use" title="载入并重新生成">' + I.refresh + '</button>' +
      '<button class="icon-btn danger" data-act="del" title="删除">' + I.trash + '</button></div></div>').join('') : emptyFor('designs', q);
  }
  updateBatchBar();
}
export function updateBatchBar() {
  $('#libBatch').hidden = lib.sel.size === 0;
  $('#batchN').textContent = lib.sel.size;
  $('#btnBatchExport').style.display = lib.tab === 'designs' ? 'none' : '';
  $('#btnBatchDl').style.display = lib.tab === 'designs' ? 'none' : '';
}
export async function selectedRecords() {
  const store = lib.tab === 'audio' ? 'audio' : lib.tab === 'samples' ? 'samples' : 'designs';
  return (await dbAll(store)).filter(r => lib.sel.has(r.id));
}
export function showRecInfo(r) {
  const k = KINDS[r.kind] || { label: r.kind };
  const rows = [['类型', k.label], ['模型', r.model], ['音色', r.voiceLabel || '—'], ['时长', fmtDur(r.duration)],
    ['大小', fmtBytes(r.size)], ['创建时间', fmtDate(r.createdAt)], ['导出状态', r.exported ? '已导出到目录' : '未导出']];
  if (r.seg) rows.splice(2, 0, ['排队段落', '第 ' + r.seg + ' 段']);
  openModal('<div class="m-head"><h3>' + esc(r.title) + '</h3></div><div class="m-body">' +
    '<table class="m-table">' + rows.map(x => '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>').join('') + '</table>' +
    '<div class="m-sec"><label>合成文本</label><div>' + esc(r.text || '—') + '</div></div>' +
    (r.instr ? '<div class="m-sec"><label>导演指令 / 音色描述</label><div>' + esc(r.instr) + '</div></div>' : '') +
    '</div><div class="m-foot"><button class="btn btn-primary" data-close>关闭</button></div>');
}
export async function loadIntoEditor(r) {
  if (r.kind === 'clone') {
    $('#cloneText').value = r.text || '';
    $('#cloneInstr').value = r.instr || '';
    if (r.sampleId) {
      state.selectedSample = r.sampleId;
      await setSetting('selectedSample', r.sampleId);
      await renderSamples();
      await updateCloneSel();
    }
    nav.go('clone');
  } else if (r.kind === 'design') {
    $('#designDesc').value = r.instr || '';
    $('#designText').value = r.text === '（智能润色）' ? '' : (r.text || '');
    nav.go('design');
  } else {
    $('#ttsText').value = r.text || '';
    $('#ttsInstr').value = r.instr || '';
    if (r.voiceId && VOICES.some(v => v.id === r.voiceId)) {
      state.voice = r.voiceId;
      await setSetting('voice', state.voice);
      renderVoices();
    }
    updateCounts();
    redrawTagPanels();
    nav.go('read');
  }
  toast('已载入到编辑器，可修改后再次合成', 'info');
}
export async function refreshAfterDataChange() {
  await Promise.all([renderLibrary(), renderSamples(), renderDesigns(), renderStats(), updateCloneSel()]);
}

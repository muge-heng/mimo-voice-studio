/* 应用装配：视图切换、事件绑定与启动流程 */

import { $, $$, esc, debounce, safeName, downloadBlob, tsName } from './lib/utils.js';
import { getSetting, setSetting, dbGet, dbDel, dbClear } from './lib/db.js';
import { state } from './lib/state.js';
import { fnUrl } from './lib/api.js';
import { I, SAMPLES, INSTR_PRESETS, DIR_TPL, DESIGN_TPLS } from './data.js';
import { toast, confirmBox } from './ui/toast.js';
import { STATIONS, nav, applyTheme } from './ui/nav.js';
import { Player } from './ui/player.js';
import { updateApiPill, updateKeyBadge, renderSvcState, renderServicePill, openSetup, closeSetup } from './ui/status.js';
import {
  updateCounts, redrawTagPanels, renderTagPanel, renderVoices, renderSamples, updateCloneSel,
  renderDesigns, renderLibrary, renderStats, updateBatchBar, selectedRecords, showRecInfo, loadIntoEditor, lib
} from './ui/render.js';
import {
  pickExportDir, ensureDirPerm, writeFileToDir, exportRecordToFile, archiveSample, requireDir,
  renderDirInfo, exportAllRaw, exportSharePackage, importSharePackage
} from './features/export.js';
import { handleFile, toggleMic, stopMic } from './features/mic.js';
import { generateRead, queueRead, generateDesign, generateClone } from './features/generate.js';
import { saveSettings, testConnection, forgetKey, refreshService, updateStorage } from './features/settings.js';

/* ---------- 视图切换（注入 nav.go，供其他模块调用） ---------- */
function switchView(v) {
  state.view = v;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  const st = STATIONS[v] || ['', ''];
  $('#crumbNo').textContent = st[0];
  $('#crumbName').textContent = st[1];
  if (v === 'library') { renderLibrary(); renderStats(); }
  if (v === 'clone') { renderSamples(); updateCloneSel(); }
  if (v === 'design') renderDesigns();
  if (v === 'settings') { updateStorage(); renderDirInfo(); updateKeyBadge(); renderSvcState(); }
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  const active = document.querySelector('.nav-btn.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
nav.go = switchView;
window.addEventListener('hashchange', () => {
  const v = (location.hash || '').slice(1);
  if (STATIONS[v] && v !== state.view) switchView(v);
});

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('.nav-btn');
    if (b) switchView(b.dataset.view);
  });
  $('#apiPill').onclick = () => switchView('settings');
  $('#dirPill').onclick = () => switchView('settings');
  $('#themeBtn').onclick = async () => {
    const t = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    await setSetting('theme', t);
    Player.renderWave(Player.progress());
    toast(t === 'dark' ? '已切换到录音棚（暗色）主题' : '已切换到纸质（亮色）主题', 'info', 1800);
  };

  /* 01 朗读 */
  $('#ttsText').addEventListener('input', updateCounts);
  $('#cloneText').addEventListener('input', updateCounts);
  $('#btnClearText').onclick = () => { $('#ttsText').value = ''; updateCounts(); redrawTagPanels(); };
  $('#btnDirector').onclick = () => {
    $('#ttsInstr').value = DIR_TPL;
    toast('已填入导演模式模板：按 角色 / 场景 / 指导 三段填写', 'info');
  };
  $('#btnGenRead').onclick = generateRead;
  $('#btnQueueRead').onclick = queueRead;
  $('#sampleMenu').innerHTML = SAMPLES.map((s, i) =>
    '<button class="menu-item" data-i="' + i + '"><b>' + esc(s.name) + '</b><span>' + esc(s.text.replace(/\n+/g, ' ').slice(0, 30)) + '…</span></button>').join('');
  $('#btnSamples').onclick = e => { e.stopPropagation(); $('#sampleMenu').classList.toggle('show'); };
  $('#sampleMenu').addEventListener('click', e => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    const s = SAMPLES[+b.dataset.i];
    $('#ttsText').value = s.text;
    $('#ttsInstr').value = s.instr || '';
    updateCounts();
    redrawTagPanels();
    $('#sampleMenu').classList.remove('show');
    toast('已载入示例「' + s.name + '」', 'info');
  });
  document.addEventListener('click', () => $('#sampleMenu').classList.remove('show'));
  $('#instrPresets').innerHTML = INSTR_PRESETS.map((p, i) =>
    '<button class="chip" data-i="' + i + '" style="--c:var(--g-tone)">' + esc(p.slice(0, 16)) + '…</button>').join('');
  $('#instrPresets').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $('#ttsInstr').value = INSTR_PRESETS[+c.dataset.i];
    toast('已填入指令示例', 'info');
  });
  $('#voiceGrid').addEventListener('click', async e => {
    const it = e.target.closest('.voice-item');
    if (!it) return;
    state.voice = it.dataset.id;
    await setSetting('voice', state.voice);
    renderVoices();
  });
  $('#voiceGrid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const it = e.target.closest('.voice-item');
    if (!it) return;
    e.preventDefault();
    state.voice = it.dataset.id;
    setSetting('voice', state.voice);
    renderVoices();
  });

  /* 02 音色设计 */
  $('#designTplRow').innerHTML = DESIGN_TPLS.map((t, i) =>
    '<button class="chip" data-i="' + i + '" style="--c:var(--g-tone)">' + esc(t.name) + '</button>').join('');
  $('#designTplRow').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $('#designDesc').value = DESIGN_TPLS[+c.dataset.i].text;
    toast('已载入模板「' + DESIGN_TPLS[+c.dataset.i].name + '」', 'info');
  });
  $('#btnGenDesign').onclick = generateDesign;
  $('#designList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    const item = btn && btn.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id, act = btn.dataset.act;
    if (act === 'preview') {
      const d = await dbGet('designs', id);
      if (d && d.previewAudioId) {
        const r = await dbGet('audio', d.previewAudioId);
        if (r) { Player.load(r); return; }
      }
      toast('该设计暂无预览音频', 'warn');
    } else if (act === 'use') {
      const d = await dbGet('designs', id);
      if (!d) return;
      $('#designDesc').value = d.description;
      switchView('design');
      toast('已载入描述，可直接重新生成', 'info');
    } else if (act === 'del') {
      const d = await dbGet('designs', id);
      const ok = await confirmBox({ title: '删除音色设计？', body: '「' + (d ? d.name : '') + '」将被移除（预览音频保留在生成记录中）。', ok: '删除', danger: true });
      if (ok) { await dbDel('designs', id); renderDesigns(); renderLibrary(); renderStats(); toast('已删除', 'ok'); }
    }
  });

  /* 03 音色克隆 */
  $('#sourceTabs').addEventListener('click', e => {
    const b = e.target.closest('.src-tab');
    if (!b) return;
    $$('.src-tab').forEach(x => x.classList.toggle('active', x === b));
    $('#srcFile').hidden = b.dataset.src !== 'file';
    $('#srcMic').hidden = b.dataset.src !== 'mic';
    if (b.dataset.src !== 'mic') stopMic();
  });
  const dz = $('#dropzone');
  $('#dzIc').innerHTML = I.upload;
  dz.onclick = () => $('#fileInput').click();
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  $('#fileInput').onchange = e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; };
  $('#recBtn').onclick = toggleMic;
  $('#btnGenClone').onclick = generateClone;
  $('#sampleList').addEventListener('click', async e => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.closest('.radio')) {
      state.selectedSample = id;
      await setSetting('selectedSample', id);
      renderSamples();
      updateCloneSel();
      return;
    }
    const s = await dbGet('samples', id);
    if (!s) return;
    const act = btn.dataset.act;
    if (act === 'play') Player.load({ blob: s.blob, title: s.name, voiceLabel: '克隆样本 · ' + s.name, duration: s.duration });
    else if (act === 'dl') downloadBlob(s.blob, safeName(s.name) + (s.mime.indexOf('mpeg') >= 0 ? '.mp3' : '.wav'));
    else if (act === 'del') {
      const ok = await confirmBox({ title: '删除克隆样本？', body: '「' + s.name + '」将从样本库移除。', ok: '删除', danger: true });
      if (ok) {
        await dbDel('samples', id);
        if (state.selectedSample === id) { state.selectedSample = null; await setSetting('selectedSample', null); }
        renderSamples(); updateCloneSel(); renderStats();
        toast('已删除', 'ok');
      }
    }
  });

  /* 04 媒体库 */
  $('#libTabs').addEventListener('click', e => {
    const b = e.target.closest('.lib-tab');
    if (!b) return;
    lib.tab = b.dataset.tab;
    lib.sel.clear();
    $$('.lib-tab').forEach(x => x.classList.toggle('active', x === b));
    $('#libFilter').style.display = lib.tab === 'audio' ? '' : 'none';
    renderLibrary();
  });
  $('#libSearch').addEventListener('input', debounce(renderLibrary, 220));
  $('#libFilter').addEventListener('change', renderLibrary);
  $('#libSort').addEventListener('change', e => { lib.sort = e.target.value; renderLibrary(); });
  $('#btnBatchClear').onclick = () => { lib.sel.clear(); renderLibrary(); };
  $('#btnBatchDel').onclick = async () => {
    const store = lib.tab === 'audio' ? 'audio' : 'samples';
    const n = lib.sel.size;
    const ok = await confirmBox({ title: '删除所选 ' + n + ' 项？', body: '将从媒体库移除（已导出到目录的文件不受影响），此操作不可恢复。', ok: '全部删除', danger: true });
    if (!ok) return;
    for (const id of lib.sel) await dbDel(store, id);
    if (store === 'samples' && lib.sel.has(state.selectedSample)) {
      state.selectedSample = null;
      await setSetting('selectedSample', null);
    }
    lib.sel.clear();
    await Promise.all([renderLibrary(), renderSamples(), renderStats(), updateCloneSel()]);
    toast('已删除 ' + n + ' 项', 'ok');
  };
  $('#btnBatchDl').onclick = async () => {
    const list = await selectedRecords();
    toast('正在准备 ' + list.length + ' 个下载，浏览器若询问是否允许多文件，请选择允许', 'info', 4200);
    for (const r of list) {
      if (!r.blob) continue;
      downloadBlob(r.blob, safeName(r.title || r.name) + (r.mime && r.mime.indexOf('mpeg') >= 0 ? '.mp3' : '.wav'));
      await new Promise(res => setTimeout(res, 320));
    }
  };
  $('#btnBatchExport').onclick = async () => {
    if (!requireDir()) return;
    if (!(await ensureDirPerm())) { toast('未获得目录写入权限', 'err'); renderDirInfo(); return; }
    const list = await selectedRecords();
    let done = 0, failed = 0;
    for (const r of list) {
      try {
        if (lib.tab === 'audio') await exportRecordToFile(r);
        else await archiveSample(r);
        done++;
      } catch (e) { failed++; }
    }
    renderLibrary();
    toast('已导出 ' + done + ' 项' + (failed ? '，' + failed + ' 项失败' : ''), failed ? 'warn' : 'ok', 4200);
  };
  $('#libBody').addEventListener('click', async e => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { switchView(goto.dataset.goto); return; }
    const btn = e.target.closest('[data-act]');
    const item = btn && btn.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id, act = btn.dataset.act;
    if (act === 'sel') {
      if (lib.sel.has(id)) lib.sel.delete(id); else lib.sel.add(id);
      item.classList.toggle('sel', lib.sel.has(id));
      btn.classList.toggle('on', lib.sel.has(id));
      updateBatchBar();
      return;
    }
    if (lib.tab === 'audio') {
      const rec = await dbGet('audio', id);
      if (!rec) return;
      if (act === 'play') Player.load(rec);
      else if (act === 'dl') downloadBlob(rec.blob, safeName(rec.title) + '.wav');
      else if (act === 'export') {
        if (!requireDir()) return;
        if (!(await ensureDirPerm())) { toast('未获得目录写入权限', 'err'); renderDirInfo(); return; }
        try { await exportRecordToFile(rec); renderLibrary(); toast('已导出到「' + state.exportDir.name + '」', 'ok'); }
        catch (err) { toast('导出失败：' + (err.message || err), 'err'); }
      }
      else if (act === 'use') loadIntoEditor(rec);
      else if (act === 'info') showRecInfo(rec);
      else if (act === 'del') {
        const ok = await confirmBox({ title: '删除这条音频？', body: '「' + rec.title + '」将从媒体库移除（不影响已导出到目录的文件）。', ok: '删除', danger: true });
        if (ok) { lib.sel.delete(id); await dbDel('audio', id); renderLibrary(); renderStats(); toast('已删除', 'ok'); }
      }
    } else if (lib.tab === 'samples') {
      const s = await dbGet('samples', id);
      if (!s) return;
      if (act === 'play') Player.load({ blob: s.blob, title: s.name, voiceLabel: '克隆样本 · ' + s.name, duration: s.duration });
      else if (act === 'dl') downloadBlob(s.blob, safeName(s.name) + (s.mime.indexOf('mpeg') >= 0 ? '.mp3' : '.wav'));
      else if (act === 'use') {
        state.selectedSample = id;
        await setSetting('selectedSample', id);
        renderSamples(); updateCloneSel(); switchView('clone');
        toast('已选为当前克隆样本', 'ok');
      }
      else if (act === 'archive') {
        if (!requireDir()) return;
        if (!(await ensureDirPerm())) { toast('未获得目录写入权限', 'err'); renderDirInfo(); return; }
        try { await archiveSample(s); toast('已存档到 voice-samples/', 'ok'); } catch (err) { toast('存档失败：' + (err.message || err), 'err'); }
      }
      else if (act === 'del') {
        const ok = await confirmBox({ title: '删除克隆样本？', body: '「' + s.name + '」将从样本库移除。', ok: '删除', danger: true });
        if (ok) {
          lib.sel.delete(id);
          await dbDel('samples', id);
          if (state.selectedSample === id) { state.selectedSample = null; await setSetting('selectedSample', null); }
          await Promise.all([renderLibrary(), renderSamples(), renderStats(), updateCloneSel()]);
          toast('已删除', 'ok');
        }
      }
    } else {
      const d = await dbGet('designs', id);
      if (!d) return;
      if (act === 'preview') {
        if (d.previewAudioId) {
          const r = await dbGet('audio', d.previewAudioId);
          if (r) { Player.load(r); return; }
        }
        toast('该设计暂无预览音频', 'warn');
      }
      else if (act === 'use') { $('#designDesc').value = d.description; switchView('design'); toast('已载入描述', 'info'); }
      else if (act === 'del') {
        const ok = await confirmBox({ title: '删除音色设计？', body: '「' + d.name + '」将被移除。', ok: '删除', danger: true });
        if (ok) { lib.sel.delete(id); await dbDel('designs', id); renderDesigns(); renderLibrary(); renderStats(); toast('已删除', 'ok'); }
      }
    }
  });
  $('#btnExportRaw').onclick = exportAllRaw;
  $('#btnExportRaw2').onclick = exportAllRaw;
  $('#btnExportShare').onclick = exportSharePackage;
  $('#btnExportShare2').onclick = exportSharePackage;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { const f = e.target.files[0]; if (f) importSharePackage(f); e.target.value = ''; };

  /* 05 设置 */
  $('#btnEye').innerHTML = I.eye;
  $('#btnEye').onclick = () => {
    const inp = $('#apiKeyInput');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('#btnEye').innerHTML = show ? I.eyeOff : I.eye;
  };
  $('#apiKeyInput').addEventListener('input', updateKeyBadge);
  $('#apiKeyInput').addEventListener('change', updateKeyBadge);
  $('#keyType').addEventListener('change', function () { state.keyTypeSel = this.value; updateKeyBadge(); });
  $('#proxyInput').addEventListener('input', updateKeyBadge);
  $('#btnSaveKey').onclick = async () => { if (await saveSettings()) await refreshService(); };
  $('#btnTestKey').onclick = testConnection;
  $('#btnForget').onclick = async () => {
    const ok = await confirmBox({ title: '清除本机 API Key？', body: '只影响这台浏览器的保存结果，已生成的音频与样本不会丢失。', ok: '清除', danger: true });
    if (ok) await forgetKey();
  };
  $('#btnPickDir').onclick = pickExportDir;
  $('#btnReperm').onclick = async () => {
    if (!state.exportDir) { toast('请先选择目录', 'warn'); return; }
    const ok = await ensureDirPerm();
    renderDirInfo();
    toast(ok ? '已获得目录权限' : '未授权', ok ? 'ok' : 'err');
  };
  const bindToggle = (id, get, set) => {
    const el = document.getElementById(id);
    el.checked = !!get();
    el.addEventListener('change', async () => { await set(el.checked); });
  };
  bindToggle('streamToggle', () => state.streamMode, async v => { state.streamMode = v; await setSetting('streamMode', v); $('#streamModeT').checked = v; });
  bindToggle('streamModeT', () => state.streamMode, async v => { state.streamMode = v; await setSetting('streamMode', v); $('#streamToggle').checked = v; });
  bindToggle('autoExportT', () => state.autoExport, async v => { state.autoExport = v; await setSetting('autoExport', v); });
  bindToggle('autoArchiveT', () => state.autoArchive, async v => { state.autoArchive = v; await setSetting('autoArchive', v); });
  bindToggle('keepInstrT', () => state.keepText, async v => { state.keepText = v; await setSetting('keepText', v); });
  $('#btnClearAll').onclick = async () => {
    const ok = await confirmBox({ title: '清空全部数据？', body: '将删除媒体库中的全部生成音频、克隆样本与音色设计，此操作不可恢复。', ok: '全部清空', danger: true });
    if (!ok) return;
    await dbClear('audio');
    await dbClear('samples');
    await dbClear('designs');
    state.selectedSample = null;
    lib.sel.clear();
    await setSetting('selectedSample', null);
    await Promise.all([renderLibrary(), renderSamples(), renderDesigns(), renderStats(), updateCloneSel()]);
    toast('已清空全部媒体数据', 'ok');
  };

  /* 播放器 */
  $('#pPlay').innerHTML = I.play;
  $('#pDl').innerHTML = I.dl;
  $('#pExport').innerHTML = I.folder;
  $('#pClose').innerHTML = I.x;
  $('#pPlay').onclick = () => Player.toggle();
  $('#pWave').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - r.left) / r.width, a = Player.audio;
    if (a.duration) {
      a.currentTime = Math.max(0, Math.min(a.duration - .05, ratio * a.duration));
      Player.renderWave(ratio);
    }
  });
  const RATES = [1, 1.25, 1.5, 2, .75];
  $('#pRate').onclick = () => {
    let i = RATES.indexOf(Player.audio.playbackRate);
    if (i < 0) i = 0;
    Player.setRate(RATES[(i + 1) % RATES.length]);
  };
  $('#pLoop').onclick = () => {
    Player.audio.loop = !Player.audio.loop;
    $('#pLoop').classList.toggle('on', Player.audio.loop);
    $('#pLoop').setAttribute('aria-pressed', String(Player.audio.loop));
  };
  $('#pVol').addEventListener('input', e => { Player.audio.volume = e.target.value / 100; });
  $('#pDl').onclick = () => { const r = Player.rec; if (r) downloadBlob(r.blob, safeName(r.title) + '.wav'); };
  $('#pExport').onclick = async () => {
    const r = Player.rec;
    if (!r) { toast('当前没有可导出的音频', 'warn'); return; }
    if (!requireDir()) return;
    if (!(await ensureDirPerm())) { toast('未获得目录写入权限', 'err'); renderDirInfo(); return; }
    try {
      if (r.id && r.kind) { await exportRecordToFile(r); renderLibrary(); }
      else await writeFileToDir(state.exportDir, [tsName() + '-' + safeName(r.title) + '.wav'], r.blob);
      toast('已导出到「' + state.exportDir.name + '」', 'ok');
    } catch (err) { toast('导出失败：' + (err.message || err), 'err'); }
  };
  $('#pClose').onclick = () => Player.close();

  /* 首次配置 */
  $('#setupSave').onclick = async () => {
    const k = $('#setupKey').value.trim();
    if (!k) { toast('请输入 API Key', 'warn'); return; }
    $('#apiKeyInput').value = k;
    if (await saveSettings()) { closeSetup(); toast('API Key 已配置，开始创作吧', 'ok'); }
  };
  $('#setupSkip').onclick = closeSetup;

  /* 快捷键 */
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (state.view === 'read') generateRead();
      else if (state.view === 'design') generateDesign();
      else if (state.view === 'clone') generateClone();
      return;
    }
    if (typing || state.view === 'settings') return;
    if (e.key === ' ' && Player.rec) { e.preventDefault(); Player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Player.seek(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); Player.seek(5); }
    else if (e.key === 'l' || e.key === 'L') $('#pLoop').click();
    else if (e.key === 'm' || e.key === 'M') {
      Player.audio.muted = !Player.audio.muted;
      $('#pVol').value = Player.audio.muted ? 0 : Math.round(Player.audio.volume * 100);
      toast(Player.audio.muted ? '已静音' : '已取消静音', 'info', 1400);
    }
  });
  window.addEventListener('resize', () => { Player.sizeCanvas(); Player.renderWave(Player.progress()); });
}

/* ---------- 启动 ---------- */
(async function boot() {
  try {
    const saved = await getSetting('theme', null);
    const urlTheme = new URLSearchParams(location.search).get('theme');
    applyTheme(urlTheme === 'dark' || urlTheme === 'light' ? urlTheme : saved || (window.matchMedia && matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
  } catch (e) { applyTheme('light'); }

  renderTagPanel($('#tagPanelRead'), 'ttsText');
  renderTagPanel($('#tagPanelClone'), 'cloneText');
  bindEvents();

  state.apiKey = await getSetting('apiKey', '') || '';
  state.keyTypeSel = await getSetting('keyType', 'auto');
  state.proxyUrl = await getSetting('proxyUrl', '');
  state.streamMode = await getSetting('streamMode', true);
  state.keepText = await getSetting('keepText', true);
  state.autoExport = await getSetting('autoExport', true);
  state.autoArchive = await getSetting('autoArchive', true);
  state.voice = await getSetting('voice', 'mimo_default');
  state.selectedSample = await getSetting('selectedSample', null);
  try {
    const h = await getSetting('exportDirHandle', null);
    if (h && h.queryPermission) {
      state.exportDir = h;
      state.dirGranted = (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    }
  } catch (e) { /* 目录句柄无法恢复时保持未授权状态 */ }

  $('#keyType').value = state.keyTypeSel;
  $('#apiKeyInput').value = state.apiKey;
  $('#proxyInput').value = state.proxyUrl;
  $('#proxyInput').placeholder = '留空即同源 ' + fnUrl().replace(location.origin, '') + '；自建转发填完整 https 地址';
  $('#streamToggle').checked = state.streamMode;
  $('#streamModeT').checked = state.streamMode;
  $('#autoExportT').checked = state.autoExport;
  $('#autoArchiveT').checked = state.autoArchive;
  $('#keepInstrT').checked = state.keepText;

  updateApiPill();
  updateKeyBadge();
  renderDirInfo();
  renderVoices();
  await Promise.all([renderSamples(), renderDesigns(), renderLibrary(), renderStats(), updateCloneSel()]);
  updateCounts();
  updateStorage();

  const startView = (location.hash || '').slice(1);
  if (STATIONS[startView]) switchView(startView);

  await refreshService();
  renderServicePill();
  if (!state.apiKey && !state.serverKey) setTimeout(openSetup, 700);
})();

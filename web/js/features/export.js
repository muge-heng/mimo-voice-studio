/* 导出目录（File System Access）与全量导出 / 分享包 */

import { state } from '../lib/state.js';
import { dbAll, dbPut, setSetting } from '../lib/db.js';
import { $, esc, tsName, tsNameFromDate, safeName, downloadBlob, uid } from '../lib/utils.js';
import { blobToB64, b64ToBlob } from '../lib/audio.js';
import { toast } from '../ui/toast.js';
import { nav } from '../ui/nav.js';
import { updateDirPill } from '../ui/status.js';
import { renderLibrary, renderSamples, renderDesigns, renderStats } from '../ui/render.js';
import { I } from '../data.js';

export async function pickExportDir() {
  if (!window.showDirectoryPicker) { toast('当前浏览器不支持目录选择，请使用 Chrome / Edge', 'err'); return; }
  try {
    const h = await window.showDirectoryPicker({ id: 'mimo-studio-export', mode: 'readwrite', startIn: 'documents' });
    state.exportDir = h;
    state.dirGranted = (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    await setSetting('exportDirHandle', h);
    renderDirInfo();
    updateDirPill();
    toast('导出目录已设定：' + h.name, 'ok');
  } catch (e) { if (e && e.name !== 'AbortError') toast('选择目录失败：' + (e.message || e), 'err'); }
}

export async function ensureDirPerm() {
  if (!state.exportDir) return false;
  try {
    if (await state.exportDir.queryPermission({ mode: 'readwrite' }) === 'granted') { state.dirGranted = true; return true; }
    const p = await state.exportDir.requestPermission({ mode: 'readwrite' });
    state.dirGranted = p === 'granted';
    return state.dirGranted;
  } catch (e) { return false; }
}

export async function writeFileToDir(dirHandle, path, blob) {
  let d = dirHandle;
  for (let i = 0; i < path.length - 1; i++) d = await d.getDirectoryHandle(path[i], { create: true });
  const fh = await d.getFileHandle(path[path.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

export async function exportRecordToFile(rec) {
  const name = tsName() + '-' + safeName(rec.title) + '.wav';
  await writeFileToDir(state.exportDir, [name], rec.blob);
  rec.exported = true;
  await dbPut('audio', rec);
}

export async function archiveSample(s) {
  const ext = s.mime.indexOf('mpeg') >= 0 ? 'mp3' : 'wav';
  await writeFileToDir(state.exportDir, ['voice-samples', tsName() + '-' + safeName(s.name) + '.' + ext], s.blob);
}

export function requireDir() {
  if (!state.exportDir) {
    toast('请先在「设置」中选择导出目录', 'warn');
    nav.go('settings');
    return false;
  }
  return true;
}

export function renderDirInfo() {
  const box = $('#dirInfo');
  if (!state.exportDir) {
    box.innerHTML = '<div class="dir-empty">尚未选择导出目录 —— 选择后，生成的音频会自动写入该目录，克隆样本与全量数据也可存档于此。该能力依赖浏览器的文件系统访问授权，仅在本机生效。</div>';
    updateDirPill();
    return;
  }
  const g = state.dirGranted;
  box.innerHTML = '<div class="dir-row ' + (g ? 'ok' : 'warn') + '"><div class="dir-ic">' + I.folder + '</div>' +
    '<div class="dir-main"><b>' + esc(state.exportDir.name) + '</b><span>' +
    (g ? '已授权 · 自动导出已就绪' : '需要重新授权（浏览器安全策略）') + '</span></div></div>';
  updateDirPill();
}

const metaOf = r => ({
  id: r.id, kind: r.kind, model: r.model, title: r.title, voiceLabel: r.voiceLabel, voiceId: r.voiceId || '',
  text: r.text, instr: r.instr, mime: r.mime, size: r.size, duration: r.duration, createdAt: r.createdAt,
  sampleId: r.sampleId || null, seg: r.seg || 0
});

export async function exportAllRaw() {
  const dir = state.exportDir;
  if (!dir) { nav.go('settings'); toast('请先在「设置」中选择导出目录', 'warn'); return; }
  if (!(await ensureDirPerm())) { toast('未获得目录写入权限', 'err'); renderDirInfo(); return; }
  const audio = await dbAll('audio'), samples = await dbAll('samples'), designs = await dbAll('designs');
  if (!audio.length && !samples.length && !designs.length) { toast('暂无可导出的数据', 'warn'); return; }
  toast('正在导出，文件较多时请稍候…', 'info', 1800);
  try {
    const root = await dir.getDirectoryHandle('MiMo-Studio-Export-' + tsName(), { create: true });
    const manifest = {
      app: 'mimo-voice-studio', version: 2, exportedAt: new Date().toISOString(),
      counts: { audio: audio.length, voiceSamples: samples.length, voiceDesigns: designs.length },
      audio: [], voiceSamples: [], voiceDesigns: []
    };
    for (const r of audio) {
      const fn = tsNameFromDate(r.createdAt) + '-' + safeName(r.title) + '.wav';
      await writeFileToDir(root, ['audio', fn], r.blob);
      manifest.audio.push(Object.assign(metaOf(r), { file: 'audio/' + fn }));
    }
    for (const s of samples) {
      const ext = s.mime.indexOf('mpeg') >= 0 ? 'mp3' : 'wav';
      const fn = tsNameFromDate(s.createdAt) + '-' + safeName(s.name) + '.' + ext;
      await writeFileToDir(root, ['voice-samples', fn], s.blob);
      manifest.voiceSamples.push({ name: s.name, mime: s.mime, size: s.size, duration: s.duration, createdAt: s.createdAt, file: 'voice-samples/' + fn });
    }
    manifest.voiceDesigns = designs.map(d => ({ name: d.name, description: d.description, createdAt: d.createdAt, previewAudioId: d.previewAudioId }));
    await writeFileToDir(root, ['manifest.json'], new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    toast('已导出到「' + root.name + '」：' + audio.length + ' 段音频 · ' + samples.length + ' 个样本 · ' + designs.length + ' 个设计', 'ok', 4600);
    renderLibrary();
  } catch (e) { toast('导出失败：' + (e.message || e), 'err'); }
}

export async function exportSharePackage() {
  const audio = await dbAll('audio'), samples = await dbAll('samples'), designs = await dbAll('designs');
  if (!audio.length && !samples.length && !designs.length) { toast('暂无可导出的数据', 'warn'); return; }
  toast('正在打包分享包，音频较多时请稍候…', 'info', 1800);
  try {
    const pkg = { app: 'mimo-voice-studio', version: 2, exportedAt: new Date().toISOString(), audio: [], voiceSamples: [], voiceDesigns: [] };
    for (const r of audio) pkg.audio.push(Object.assign(metaOf(r), { data: await blobToB64(r.blob) }));
    for (const s of samples) pkg.voiceSamples.push({ name: s.name, mime: s.mime, size: s.size, duration: s.duration, createdAt: s.createdAt, data: await blobToB64(s.blob) });
    for (const d of designs) pkg.voiceDesigns.push({ name: d.name, description: d.description, createdAt: d.createdAt, previewAudioId: d.previewAudioId });
    const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
    const name = 'mimo-studio-share-' + tsName() + '.json';
    if (state.exportDir && await ensureDirPerm()) {
      await writeFileToDir(state.exportDir, [name], blob);
      toast('分享包已写入「' + state.exportDir.name + '/' + name + '」（不含 API Key）', 'ok', 4600);
    } else {
      downloadBlob(blob, name);
      toast('分享包已开始下载（不含 API Key）', 'ok');
    }
  } catch (e) { toast('打包失败：' + (e.message || e), 'err'); }
}

export async function importSharePackage(file) {
  try {
    const pkg = JSON.parse(await file.text());
    if (pkg.app !== 'mimo-voice-studio') throw new Error('不是 MiMo 语音工坊的分享包');
    const idMap = {};
    let na = 0, ns = 0, nd = 0;
    for (const a of (pkg.audio || [])) {
      if (!a.data) continue;
      const nid = uid();
      idMap[a.id] = nid;
      await dbPut('audio', {
        id: nid, kind: a.kind || 'tts', model: a.model || '', title: a.title || '导入音频',
        voiceLabel: a.voiceLabel || '', voiceId: a.voiceId || '', text: a.text || '', instr: a.instr || '',
        mime: 'audio/wav', size: a.size || 0, duration: a.duration || 0, createdAt: a.createdAt || Date.now(),
        exported: false, sampleId: a.sampleId || null, seg: a.seg || 0, blob: b64ToBlob(a.data, 'audio/wav')
      });
      na++;
    }
    for (const s of (pkg.voiceSamples || [])) {
      if (!s.data) continue;
      await dbPut('samples', { id: uid(), name: s.name || '导入样本', blob: b64ToBlob(s.data, s.mime || 'audio/wav'), mime: s.mime || 'audio/wav', size: s.size || 0, duration: s.duration || 0, createdAt: s.createdAt || Date.now() });
      ns++;
    }
    for (const d of (pkg.voiceDesigns || [])) {
      await dbPut('designs', { id: uid(), name: d.name || '导入设计', description: d.description || '', createdAt: d.createdAt || Date.now(), previewAudioId: idMap[d.previewAudioId] || null });
      nd++;
    }
    await Promise.all([renderLibrary(), renderSamples(), renderDesigns(), renderStats()]);
    toast('导入完成：' + na + ' 段音频 · ' + ns + ' 个样本 · ' + nd + ' 个设计', 'ok', 4200);
  } catch (e) { toast('导入失败：' + (e.message || e), 'err'); }
}

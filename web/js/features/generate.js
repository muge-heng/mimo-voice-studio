/* 合成引擎：单次 / 排队生成、入库、结果面板与三个工作站的入口 */

import { state } from '../lib/state.js';
import { buildPayload, sseChat, callOnce } from '../lib/api.js';
import { SR, b64ToInt16, pcm16ToWav, audioDuration, blobToB64 } from '../lib/audio.js';
import { liveStart, liveFeed, liveStop, takeLive, vizStart } from '../lib/stream.js';
import { dbGet, dbPut } from '../lib/db.js';
import { $, uid, makeTitle, splitSegments, downloadBlob, safeName } from '../lib/utils.js';
import { toast } from '../ui/toast.js';
import { openSetup } from '../ui/status.js';
import { nav } from '../ui/nav.js';
import { makePanel } from '../ui/panel.js';
import { Player } from '../ui/player.js';
import { renderLibrary, renderStats, renderDesigns, updateCounts, loadIntoEditor, voiceName } from '../ui/render.js';
import { exportRecordToFile } from './export.js';

let genAbort = null;

function cancelGen() {
  if (genAbort) genAbort.abort();
  state.queueCancel = true;
}

const actions = {
  play: rec => Player.load(rec),
  download: rec => downloadBlob(rec.blob, safeName(rec.title) + '.wav'),
  edit: rec => loadIntoEditor(rec),
  retry: cfg => runGeneration(cfg),
  goto: view => nav.go(view),
  cancel: cancelGen
};

export const panels = {
  read: makePanel($('#genPanelRead'), actions),
  design: makePanel($('#genPanelDesign'), actions),
  clone: makePanel($('#genPanelClone'), actions)
};

function requireKey() {
  if (state.apiKey || state.serverKey) return true;
  toast('请先配置 API Key', 'warn');
  openSetup();
  return false;
}

async function synthesize(cfg, onProgress) {
  const useStream = !!state.streamMode;
  const payload = buildPayload(cfg, useStream);
  if (!useStream) {
    const blob = await callOnce(payload, genAbort.signal);
    return { blob, duration: await audioDuration(blob) };
  }
  liveStart();
  vizStart(panels[cfg.view].root.querySelector('canvas'));
  let got = 0;
  for await (const ev of sseChat(payload, genAbort.signal)) {
    const a = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.audio;
    if (a && a.data) {
      const i16 = b64ToInt16(a.data);
      liveFeed(i16);
      got += i16.length;
      if (onProgress) onProgress(got / SR);
    }
  }
  const { chunks, samples } = takeLive();
  await liveStop(false);
  if (!samples) throw new Error('接口未返回音频数据，请检查 API Key 与文本内容');
  return { blob: pcm16ToWav(chunks, SR), duration: samples / SR };
}

async function finalize(cfg, blob, dur, quiet) {
  const m = cfg.meta || {};
  const rec = {
    id: uid(), kind: m.kind || 'tts', model: cfg.model, title: m.title || '未命名', voiceLabel: m.voiceLabel || '',
    voiceId: m.voiceId || '', text: m.text || '', instr: m.instr || '', mime: 'audio/wav', size: blob.size,
    duration: dur || 0, createdAt: Date.now(), blob, exported: false, sampleId: m.sampleId || null, seg: m.seg || 0
  };
  await dbPut('audio', rec);
  if (m.kind === 'design') {
    await dbPut('designs', { id: uid(), name: m.title || '音色设计', description: m.instr || '', createdAt: Date.now(), previewAudioId: rec.id });
    renderDesigns();
  }
  let exported = false;
  if (state.exportDir && state.dirGranted && state.autoExport) {
    try { await exportRecordToFile(rec); exported = true; } catch (e) { toast('自动导出失败：' + (e.message || e), 'err'); }
  }
  if (!quiet) Player.load(rec);
  renderLibrary();
  renderStats();
  if (!quiet && state.keepText === false && cfg.view === 'read') { $('#ttsText').value = ''; updateCounts(); }
  return { rec, exported };
}

export async function runGeneration(cfg) {
  if (state.genBusy) { toast('当前有合成任务进行中，可先取消', 'warn'); return; }
  if (!requireKey()) return;
  const panel = panels[cfg.view];
  panel.last = cfg;
  panel.idle();
  state.genBusy = true;
  state.queueCancel = false;
  genAbort = new AbortController();
  panel.loading('正在连接转发服务…');
  try {
    const out = await synthesize(cfg, sec => panel.progress(sec));
    const { rec, exported } = await finalize(cfg, out.blob, out.duration);
    panel.result(rec, exported);
    toast('合成完成，已存入媒体库' + (exported ? '并自动导出' : ''), 'ok', 3800);
  } catch (err) {
    await liveStop(true);
    if (err && err.name === 'AbortError') {
      panel.idle();
      toast('已取消本次合成', 'info');
    } else {
      panel.error((err && err.message) || String(err));
      if (err && (err.code === 'key_required' || err.status === 404)) openSetup();
      console.error(err);
    }
  } finally {
    state.genBusy = false;
    genAbort = null;
  }
}

function rebuildMessages(cfg, text) {
  const msgs = [];
  if (cfg.instrText) msgs.push({ role: 'user', content: cfg.instrText });
  msgs.push({ role: 'assistant', content: text });
  return msgs;
}

export async function runQueue(cfgBase, segs) {
  if (state.genBusy) { toast('当前有合成任务进行中，可先取消', 'warn'); return; }
  if (!requireKey()) return;
  const panel = panels[cfgBase.view];
  panel.last = null;
  panel.queue(segs);
  state.genBusy = true;
  state.queueCancel = false;
  let ok = 0, bad = 0, last = null;
  for (let i = 0; i < segs.length; i++) {
    if (state.queueCancel) break;
    panel.queueStep(i, segs.length, 'run');
    genAbort = new AbortController();
    const cfg = Object.assign({}, cfgBase, {
      messages: rebuildMessages(cfgBase, segs[i]),
      meta: Object.assign({}, cfgBase.meta, {
        title: makeTitle(segs[i]) + ' · ' + String(i + 1).padStart(2, '0'), text: segs[i], seg: i + 1
      })
    });
    try {
      const out = await synthesize(cfg, sec => panel.queueNote('第 ' + (i + 1) + ' 段流式接收中 · ' + sec.toFixed(1) + ' 秒'));
      const { rec } = await finalize(cfg, out.blob, out.duration, true);
      last = rec;
      ok++;
      panel.queueStep(i, segs.length, 'done', '✓');
    } catch (err) {
      await liveStop(true);
      if (err && err.name === 'AbortError') { bad = -1; break; }
      bad++;
      panel.queueStep(i, segs.length, 'fail', '!');
      toast('第 ' + (i + 1) + ' 段失败：' + ((err && err.message) || err), 'err', 4200);
    }
  }
  state.genBusy = false;
  genAbort = null;
  if (bad === -1) {
    panel.idle();
    toast('已取消排队合成', 'info');
    return;
  }
  panel.queueEnd(ok, bad, last);
  if (state.keepText === false && cfgBase.view === 'read') { $('#ttsText').value = ''; updateCounts(); }
  toast(ok ? '逐段合成完成：' + ok + ' 段已入库' + (last ? '，最后一段可直接试听' : '') : '全部段落合成失败', ok ? 'ok' : 'err', 4600);
}

/* ---------- 三个工作站的入口 ---------- */
export async function generateRead() {
  const text = $('#ttsText').value.trim();
  if (!text) { toast('请输入要朗读的文本', 'warn'); $('#ttsText').focus(); return; }
  const instr = $('#ttsInstr').value.trim();
  await runGeneration({
    view: 'read', model: 'mimo-v2.5-tts',
    messages: instr ? [{ role: 'user', content: instr }, { role: 'assistant', content: text }] : [{ role: 'assistant', content: text }],
    audioOpts: { voice: state.voice }, instrText: instr,
    meta: { kind: 'tts', title: makeTitle(text), voiceLabel: voiceName(state.voice), voiceId: state.voice, text, instr }
  });
}

export async function queueRead() {
  const segs = splitSegments($('#ttsText').value);
  if (segs.length < 2) { toast('文本中没有空行分段，直接单次合成即可', 'warn'); return; }
  if (!requireKey()) return;
  const instr = $('#ttsInstr').value.trim();
  await runQueue({
    view: 'read', model: 'mimo-v2.5-tts', audioOpts: { voice: state.voice }, instrText: instr,
    meta: { kind: 'tts', voiceLabel: voiceName(state.voice), voiceId: state.voice, instr }
  }, segs);
}

export async function generateDesign() {
  const desc = $('#designDesc').value.trim();
  if (!desc) { toast('请先填写音色描述', 'warn'); $('#designDesc').focus(); return; }
  const text = $('#designText').value.trim();
  const messages = [{ role: 'user', content: desc }];
  if (text) messages.push({ role: 'assistant', content: text });
  const audioOpts = {};
  if ($('#designOpt').checked) audioOpts.optimize_text_preview = true;
  await runGeneration({
    view: 'design', model: 'mimo-v2.5-tts-voicedesign', messages, audioOpts,
    meta: { kind: 'design', title: makeTitle(desc, 18), voiceLabel: '音色设计', text: text || '（智能润色）', instr: desc }
  });
}

export async function generateClone() {
  const text = $('#cloneText').value.trim();
  if (!text) { toast('请输入要用克隆音色朗读的文本', 'warn'); $('#cloneText').focus(); return; }
  if (!state.selectedSample) { toast('请先在样本库中选择一个样本', 'warn'); return; }
  const s = await dbGet('samples', state.selectedSample);
  if (!s) { toast('所选样本不存在', 'err'); return; }
  const instr = $('#cloneInstr').value.trim();
  const b64 = await blobToB64(s.blob);
  const mime = s.mime.indexOf('mpeg') >= 0 ? 'audio/mpeg' : 'audio/wav';
  const voice = 'data:' + mime + ';base64,' + b64;
  if (voice.length > 14 * 1024 * 1024) { toast('样本 Base64 后超过接口 10 MB 限制，请改用更短的音频', 'err'); return; }
  await runGeneration({
    view: 'clone', model: 'mimo-v2.5-tts-voiceclone',
    messages: instr ? [{ role: 'user', content: instr }, { role: 'assistant', content: text }] : [{ role: 'assistant', content: text }],
    audioOpts: { voice },
    meta: { kind: 'clone', title: makeTitle(text), voiceLabel: '克隆 · ' + s.name, text, instr, sampleId: s.id }
  });
}


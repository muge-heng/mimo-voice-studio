/* 克隆样本来源：文件上传与麦克风现场录制（统一转成 24 kHz 单声道 WAV） */

import { state } from '../lib/state.js';
import { dbPut, setSetting } from '../lib/db.js';
import { $, $$, esc, uid, fmtDur, fmtBytes, fmtDate } from '../lib/utils.js';
import { audioDuration, toMonoWavAt, decodeCtx } from '../lib/audio.js';
import { toast } from '../ui/toast.js';
import { Player } from '../ui/player.js';
import { renderSamples, updateCloneSel, renderStats } from '../ui/render.js';
import { archiveSample } from './export.js';

let pending = null;

export function hasPending() { return Boolean(pending); }

export async function handleFile(file) {
  const name = file.name || 'sample';
  const okType = /\.(mp3|wav)$/i.test(name) || ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].indexOf(file.type) >= 0;
  if (!okType) { toast('仅支持 MP3 / WAV 格式的音频样本', 'err'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('样本文件不能超过 10 MB', 'err'); return; }
  const mime = (/mp3/i.test(name) || file.type.indexOf('mpeg') >= 0) ? 'audio/mpeg' : 'audio/wav';
  const blob = new Blob([file], { type: mime });
  pending = { name: name.replace(/\.[^.]+$/, ''), blob, dur: await audioDuration(blob), size: blob.size, mime };
  renderUploadPreview();
}

const Mic = { rec: null, stream: null, chunks: [], raf: null, timer: null, started: 0, analyser: null };

export async function toggleMic() {
  if (Mic.rec && Mic.rec.state === 'recording') { stopMic(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('当前浏览器不支持麦克风录制', 'err'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    toast('麦克风未授权：' + (e.message || e.name), 'err');
    return;
  }
  Mic.stream = stream;
  Mic.chunks = [];
  const rec = new MediaRecorder(stream);
  Mic.rec = rec;
  rec.ondataavailable = e => { if (e.data && e.data.size) Mic.chunks.push(e.data); };
  rec.onstop = onMicStopped;
  const ctx = decodeCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  Mic.analyser = analyser;
  rec.start();
  Mic.started = Date.now();
  $('#recBtn').classList.add('recording');
  $('#recTime').textContent = '0:00';
  $('#recLevel').classList.add('live');
  $('#recTip').textContent = '正在录制 · 再次点击停止（建议 10–30 秒，最长 60 秒）';
  const bars = $$('#recLevel i'), data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    bars.forEach((b, idx) => {
      const v = Math.max(.08, Math.min(1, peak * (1.15 - idx * .03) + Math.random() * .12));
      b.style.height = Math.round(v * 26) + 'px';
    });
    $('#recTime').textContent = fmtDur((Date.now() - Mic.started) / 1000);
    Mic.raf = requestAnimationFrame(tick);
  };
  tick();
  Mic.timer = setTimeout(() => {
    if (Mic.rec && Mic.rec.state === 'recording') { toast('已达 60 秒上限，自动停止', 'info'); stopMic(); }
  }, 60000);
}

export function stopMic() {
  if (Mic.rec && Mic.rec.state === 'recording') Mic.rec.stop();
  cancelAnimationFrame(Mic.raf);
  clearTimeout(Mic.timer);
  $('#recBtn').classList.remove('recording');
  $('#recLevel').classList.remove('live');
  $$('#recLevel i').forEach(b => b.style.height = '3px');
}

async function onMicStopped() {
  const sec = (Date.now() - Mic.started) / 1000;
  if (Mic.stream) Mic.stream.getTracks().forEach(t => t.stop());
  $('#recTip').textContent = '录制结束，正在转成样本…';
  try {
    const raw = new Blob(Mic.chunks, { type: (Mic.rec && Mic.rec.mimeType) || 'audio/webm' });
    if (!raw.size) throw new Error('没有采到音频');
    if (sec < 2) throw new Error('录制太短（' + sec.toFixed(1) + ' 秒），请至少录 3 秒');
    const out = await toMonoWavAt(raw, 24000);
    pending = { name: '现场录制 ' + fmtDate(Date.now()), blob: out.blob, dur: out.duration, size: out.blob.size, mime: 'audio/wav' };
    $('#recTime').textContent = fmtDur(sec);
    $('#recTip').textContent = '已生成 24 kHz 单声道 WAV 样本，确认名称后保存到样本库。';
    renderUploadPreview();
    toast('录音已就绪，可试听后保存', 'ok');
  } catch (e) {
    $('#recTip').textContent = '录制失败：' + ((e && e.message) || e) + ' —— 可重试或改为上传文件。';
    toast('录制失败：' + ((e && e.message) || e), 'err');
  }
}

export function renderUploadPreview() {
  const box = $('#uploadPreview');
  if (!pending) { box.innerHTML = ''; return; }
  const u = pending;
  box.innerHTML = '<div class="up-card"><div class="up-info"><b>' + esc(u.name) + '</b>' +
    '<span>' + fmtDur(u.dur) + ' · ' + fmtBytes(u.size) + ' · ' + (u.mime.indexOf('mpeg') >= 0 ? 'MP3' : 'WAV') + ' · 待保存</span></div>' +
    '<input id="sampleName" class="input" value="' + esc(u.name) + '" placeholder="样本名称" aria-label="样本名称">' +
    '<button class="btn btn-ghost btn-sm" id="btnPlayUp">试听</button>' +
    '<button class="btn btn-primary btn-sm" id="btnSaveSample">保存到样本库</button>' +
    '<button class="btn btn-ghost btn-sm" id="btnDropUp">放弃</button></div>';
  $('#btnPlayUp').onclick = () => Player.load({ blob: u.blob, title: u.name + '（待保存）', voiceLabel: '克隆样本试听', duration: u.dur });
  $('#btnSaveSample').onclick = saveSample;
  $('#btnDropUp').onclick = () => { pending = null; renderUploadPreview(); };
}

export async function saveSample() {
  const u = pending;
  if (!u) return;
  const name = ($('#sampleName').value.trim()) || u.name;
  const s = { id: uid(), name, blob: u.blob, mime: u.mime, size: u.size, duration: u.dur, createdAt: Date.now() };
  await dbPut('samples', s);
  state.selectedSample = s.id;
  await setSetting('selectedSample', s.id);
  let archived = false;
  if (state.exportDir && state.dirGranted && state.autoArchive) {
    try { await archiveSample(s); archived = true; } catch (e) { toast('样本存档失败：' + (e.message || e), 'err'); }
  }
  pending = null;
  renderUploadPreview();
  await renderSamples();
  await updateCloneSel();
  await renderStats();
  toast('样本已保存' + (archived ? '，并同步存档到导出目录' : ''), 'ok');
}

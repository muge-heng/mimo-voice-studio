/* 底部全局播放器：波形绘制、进度、倍速、循环 */

import { $, fmtDur, fmtBytes } from '../lib/utils.js';
import { wavPeaks, decodedPeaks } from '../lib/audio.js';
import { I } from '../data.js';

export const Player = {
  audio: new Audio(), rec: null, url: null, peaks: null, playing: false, raf: null, ctx: null, w: 0, h: 0,
  load(rec) {
    this.rec = rec;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(rec.blob);
    this.audio.src = this.url;
    this.audio.playbackRate = 1;
    this.audio.loop = false;
    $('#pRate').textContent = '1×';
    $('#pLoop').classList.remove('on');
    $('#pLoop').setAttribute('aria-pressed', 'false');
    $('#pTitle').textContent = rec.title || '未命名';
    $('#pMeta').textContent = [rec.voiceLabel, rec.duration ? fmtDur(rec.duration) : '', fmtBytes(rec.blob.size)].filter(Boolean).join(' · ');
    $('#playerBar').classList.add('show');
    document.body.classList.add('has-player');
    this.sizeCanvas();
    this.peaks = null;
    this.renderWave(0);
    this.drawPeaks();
    this.audio.play().catch(() => { });
  },
  sizeCanvas() {
    const cv = $('#pWave'), dpr = window.devicePixelRatio || 1;
    this.w = cv.clientWidth;
    this.h = cv.clientHeight;
    cv.width = this.w * dpr;
    cv.height = this.h * dpr;
    this.ctx = cv.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },
  async drawPeaks() {
    if (!this.rec) return;
    const N = Math.max(48, Math.min(200, Math.floor((this.w || 460) / 5)));
    const blob = this.rec.blob;
    let res = null;
    try { res = await wavPeaks(blob, N); } catch (e) { res = null; }
    if (!res) { try { res = await decodedPeaks(blob, N); } catch (e) { res = null; } }
    if (!res) return;
    this.peaks = res.peaks;
    if (!this.rec.duration) this.rec.duration = res.duration;
    this.renderWave(this.progress());
  },
  progress() { const a = this.audio; return a.duration ? a.currentTime / a.duration : 0; },
  cssVar(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; },
  renderWave(p) {
    if (!this.ctx) return;
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    const idle = this.cssVar('--line-2', '#E0D5C0');
    if (!this.peaks) { c.fillStyle = idle; c.fillRect(0, h / 2 - 1, w, 2); return; }
    const n = this.peaks.length, bw = w / n, hot = this.cssVar('--brand', '#D2552B');
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2, this.peaks[i] * h * .92);
      c.fillStyle = (i / n <= p) ? hot : idle;
      const x = i * bw + .7, ww = Math.max(1.4, bw - 1.4), y = (h - bh) / 2;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, ww, bh, 2); else c.rect(x, y, ww, bh);
      c.fill();
    }
  },
  toggle() { if (this.audio.paused) this.audio.play(); else this.audio.pause(); },
  seek(sec) {
    const a = this.audio;
    if (a.duration) a.currentTime = Math.max(0, Math.min(a.duration - .05, a.currentTime + sec));
  },
  setRate(r) { this.audio.playbackRate = r; $('#pRate').textContent = r + '×'; },
  close() {
    this.audio.pause();
    $('#playerBar').classList.remove('show');
    document.body.classList.remove('has-player');
  }
};

Player.audio.addEventListener('play', () => {
  Player.playing = true;
  $('#pPlay').innerHTML = I.pause;
  const loop = () => {
    if (!Player.playing) return;
    Player.renderWave(Player.progress());
    $('#pTime').textContent = fmtDur(Player.audio.currentTime) + ' / ' + fmtDur(Player.audio.duration || (Player.rec && Player.rec.duration) || 0);
    Player.raf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(Player.raf);
  loop();
});
Player.audio.addEventListener('pause', () => {
  Player.playing = false;
  $('#pPlay').innerHTML = I.play;
  cancelAnimationFrame(Player.raf);
  Player.renderWave(Player.progress());
});
Player.audio.addEventListener('ended', () => {
  Player.playing = false;
  $('#pPlay').innerHTML = I.play;
  Player.renderWave(1);
});

/* 流式合成期间的实时播放与频谱可视化 */

import { SR, decodeCtx } from './audio.js';

let live = null, vizRaf = null;

export function liveStart() {
  const ctx = decodeCtx();
  const gain = ctx.createGain(), analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  gain.connect(analyser);
  analyser.connect(ctx.destination);
  ctx.resume();
  live = { ctx, gain, analyser, next: ctx.currentTime + 0.15, srcs: [], samples: 0, chunks: [] };
}

export function liveFeed(i16) {
  if (!live) return;
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  const buf = live.ctx.createBuffer(1, f32.length, SR);
  buf.copyToChannel(f32, 0);
  const src = live.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(live.gain);
  if (live.next < live.ctx.currentTime) live.next = live.ctx.currentTime + 0.05;
  src.start(live.next);
  live.next += buf.duration;
  live.srcs.push(src);
  live.samples += i16.length;
  live.chunks.push(i16);
}

export async function liveStop(cancel) {
  if (!live) return;
  if (cancel) live.srcs.forEach(s => { try { s.stop(); } catch (e) { } });
  live = null;
  if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
}

export function takeLive() {
  if (!live) return { chunks: [], samples: 0 };
  return { chunks: live.chunks.slice(), samples: live.samples };
}

export function vizStart(cv) {
  if (!cv || !live) return;
  if (vizRaf) cancelAnimationFrame(vizRaf);
  const c = cv._ctx2d, W = cv.clientWidth, H = cv.clientHeight, data = new Uint8Array(live.analyser.frequencyBinCount);
  const draw = () => {
    if (!live) { vizRaf = null; return; }
    live.analyser.getByteFrequencyData(data);
    c.clearRect(0, 0, W, H);
    const n = 40, bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = data[Math.min(data.length - 1, Math.floor(i * data.length / n / 1.3))] / 255;
      const bh = Math.max(3, v * H * .92);
      c.fillStyle = 'hsl(' + (12 + i * 1.05) + ' 68% ' + (44 + v * 16) + '%)';
      const x = i * bw + 1.5, w = Math.max(2, bw - 3), y = (H - bh) / 2;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, bh, 2); else c.rect(x, y, w, bh);
      c.fill();
    }
    vizRaf = requestAnimationFrame(draw);
  };
  draw();
}

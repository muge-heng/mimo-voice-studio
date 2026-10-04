/* 音频编解码：Base64 / PCM16 / WAV 互转与波形峰值 */

export const SR = 24000;

export function b64ToInt16(b64) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return new Int16Array(u.buffer, u.byteOffset, Math.floor(n / 2)); }
export function b64ToBlob(b64, mime) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); }
export function blobToB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); }); }

function wavHeader(v, len, sr) {
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len, true);
}

export function pcm16ToWav(chunks, sr) {
  sr = sr || SR;
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
  const ab = new ArrayBuffer(44 + total * 2), v = new DataView(ab);
  wavHeader(v, total * 2, sr);
  const arr = new Int16Array(ab, 44, total);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) { arr.set(chunks[i], off); off += chunks[i].length; }
  return new Blob([ab], { type: 'audio/wav' });
}

export function floatToWav(f32, sr) {
  const ab = new ArrayBuffer(44 + f32.length * 2), v = new DataView(ab);
  wavHeader(v, f32.length * 2, sr);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([ab], { type: 'audio/wav' });
}

export function audioDuration(blob) {
  return new Promise(res => {
    const u = URL.createObjectURL(blob), a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { URL.revokeObjectURL(u); res(a.duration || 0); };
    a.onerror = () => { URL.revokeObjectURL(u); res(0); };
    a.src = u;
  });
}

let _decodeCtx = null;
export function decodeCtx() {
  if (!_decodeCtx || _decodeCtx.state === 'closed') _decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _decodeCtx;
}

/* 直接从 16-bit WAV 取峰值：不依赖 AudioContext，解码器缺失的环境也能画出波形 */
export async function wavPeaks(blob, N) {
  const ab = await blob.arrayBuffer();
  if (ab.byteLength < 44) return null;
  const v = new DataView(ab);
  if (v.getUint32(0, false) !== 0x52494646) return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= ab.byteLength) {
    const id = v.getUint32(off, false), size = v.getUint32(off + 4, true);
    if (id === 0x666d7420) fmt = { ch: v.getUint16(off + 10, true), sr: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
    else if (id === 0x64617461) data = { off: off + 8, size: Math.min(size, ab.byteLength - off - 8) };
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || !fmt.ch || !fmt.sr) return null;
  const frames = Math.floor(data.size / 2 / fmt.ch), blk = Math.max(1, Math.floor(frames / N)), pk = [];
  for (let i = 0; i < N; i++) {
    let m = 0;
    const st = i * blk;
    for (let j = 0; j < blk; j += 2) {
      const idx = data.off + (st + j) * fmt.ch * 2;
      if (idx + 1 >= ab.byteLength) break;
      const a = Math.abs(v.getInt16(idx, true));
      if (a > m) m = a;
    }
    pk.push(m / 32768);
  }
  return { peaks: pk, duration: frames / fmt.sr };
}

export async function decodedPeaks(blob, N) {
  const buf = await decodeCtx().decodeAudioData(await blob.arrayBuffer());
  const ch = buf.getChannelData(0), blk = Math.max(1, Math.floor(ch.length / N)), pk = [];
  for (let i = 0; i < N; i++) {
    let m = 0;
    const st = i * blk;
    for (let j = 0; j < blk; j += 2) { const v = Math.abs(ch[st + j] || 0); if (v > m) m = v; }
    pk.push(m);
  }
  return { peaks: pk, duration: buf.duration };
}

/* 任意浏览器可解码的音频 → 目标采样率单声道 WAV（麦克风采样用） */
export async function toMonoWavAt(blob, targetSr) {
  const buf = await decodeCtx().decodeAudioData(await blob.arrayBuffer());
  const ch = buf.numberOfChannels > 1
    ? (() => { const mix = new Float32Array(buf.length); const a = buf.getChannelData(0), b = buf.getChannelData(1); for (let i = 0; i < mix.length; i++) mix[i] = (a[i] + b[i]) / 2; return mix; })()
    : buf.getChannelData(0);
  const ratio = buf.sampleRate / targetSr, outLen = Math.max(1, Math.floor(buf.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio, i0 = Math.floor(p), i1 = Math.min(buf.length - 1, i0 + 1);
    out[i] = ch[i0] + (ch[i1] - ch[i0]) * (p - i0);
  }
  return { blob: floatToWav(out, targetSr), duration: outLen / targetSr };
}

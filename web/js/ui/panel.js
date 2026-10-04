/* 生成结果面板：加载 / 进度 / 结果 / 失败 / 排队五种状态。
   行为通过 actions 注入，面板本身不依赖生成引擎，避免循环引用。 */

import { $, esc, fmtDur, fmtBytes } from '../lib/utils.js';
import { I } from '../data.js';

export function makePanel(root, actions) {
  const P = {
    root,
    last: null,
    idle() { root.classList.remove('show'); root.innerHTML = ''; },
    loading(msg) {
      root.classList.add('show');
      root.innerHTML = '<div class="gp gp-load"><div class="eq"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="gp-info"><div class="gp-title">正在合成</div><div class="gp-msg">' + esc(msg) + '</div></div>' +
        '<canvas class="gp-viz"></canvas><button class="btn btn-ghost btn-sm" data-act="cancel">取消</button></div>';
      root.querySelector('[data-act=cancel]').onclick = actions.cancel;
      const cv = root.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      cv._ctx2d = cv.getContext('2d');
      cv._ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      return cv;
    },
    progress(sec) {
      const el = root.querySelector('.gp-msg');
      if (el) el.textContent = '流式接收中 · 已接收 ' + sec.toFixed(1) + ' 秒音频';
    },
    result(rec, exported) {
      root.classList.add('show');
      root.innerHTML = '<div class="gp gp-done"><div class="gp-ok">' + I.check + '</div>' +
        '<div class="gp-info"><div class="gp-title">' + esc(rec.title) + '</div>' +
        '<div class="gp-msg">' + fmtDur(rec.duration) + ' · ' + fmtBytes(rec.size) + ' · 已存入媒体库' + (exported ? ' · 已自动导出到目录' : '') + '</div></div>' +
        '<div class="gp-acts"><button class="btn btn-primary btn-sm" data-act="play">' + I.play + ' 播放</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="dl">' + I.dl + ' 下载</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="edit">' + I.edit + ' 改文本再来</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="again">' + I.refresh + ' 再来一次</button></div></div>';
      root.querySelector('[data-act=play]').onclick = () => actions.play(rec);
      root.querySelector('[data-act=dl]').onclick = () => actions.download(rec);
      root.querySelector('[data-act=edit]').onclick = () => actions.edit(rec);
      root.querySelector('[data-act=again]').onclick = () => { if (P.last) actions.retry(P.last); };
    },
    error(msg) {
      root.classList.add('show');
      root.innerHTML = '<div class="gp gp-err"><div class="gp-warn">' + I.warn + '</div>' +
        '<div class="gp-info"><div class="gp-title">合成失败</div><div class="gp-msg">' + esc(msg) + '</div></div>' +
        '<div class="gp-acts"><button class="btn btn-ghost btn-sm" data-act="again">' + I.refresh + ' 重试</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="key">检查凭证</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="dismiss">关闭</button></div></div>';
      root.querySelector('[data-act=again]').onclick = () => { if (P.last) actions.retry(P.last); };
      root.querySelector('[data-act=key]').onclick = () => actions.goto('settings');
      root.querySelector('[data-act=dismiss]').onclick = () => P.idle();
    },
    queue(segs) {
      root.classList.add('show');
      root.innerHTML = '<div class="gp gp-load"><div class="eq"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="gp-info"><div class="gp-title">逐段排队合成</div><div class="gp-msg" data-q>共 ' + segs.length + ' 段，正在处理第 1 段…</div></div>' +
        '<button class="btn btn-ghost btn-sm" data-act="cancel">取消排队</button></div>' +
        '<div class="queue">' + segs.map((s, i) =>
          '<div class="q-item" data-i="' + i + '"><span class="q-no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="q-tx">' + esc(s.slice(0, 60)) + '</span><span class="q-mark">·</span></div>').join('') + '</div>';
      root.querySelector('[data-act=cancel]').onclick = actions.cancel;
    },
    queueStep(i, total, cls, mark) {
      const item = root.querySelector('.q-item[data-i="' + i + '"]');
      if (item) {
        item.className = 'q-item ' + cls;
        const m = item.querySelector('.q-mark');
        m.innerHTML = cls === 'run' ? '<span class="q-spin"></span>' : esc(mark || '✓');
      }
      const q = root.querySelector('[data-q]');
      if (q) q.textContent = '共 ' + total + ' 段 · 正在处理第 ' + (i + 1) + ' 段';
    },
    queueNote(text) {
      const q = root.querySelector('[data-q]');
      if (q) q.textContent = text;
    },
    queueEnd(ok, bad, last) {
      const load = root.querySelector('.gp-load');
      if (load) load.remove();
      root.insertAdjacentHTML('afterbegin', '<div class="gp ' + (bad ? 'gp-err' : 'gp-done') + '">' +
        (bad ? '<div class="gp-warn">' + I.warn + '</div>' : '<div class="gp-ok">' + I.check + '</div>') +
        '<div class="gp-info"><div class="gp-title">排队合成结束</div><div class="gp-msg">成功 ' + ok + ' 段' + (bad ? ' · 失败 ' + bad + ' 段' : '') + '，全部结果已存入媒体库</div></div>' +
        '<div class="gp-acts">' + (last ? '<button class="btn btn-primary btn-sm" data-act="play">' + I.play + ' 播放最后一段</button>' : '') +
        '<button class="btn btn-ghost btn-sm" data-act="lib">查看媒体库</button></div></div>');
      const pb = root.querySelector('[data-act=play]');
      if (pb) pb.onclick = () => actions.play(last);
      root.querySelector('[data-act=lib]').onclick = () => actions.goto('library');
    }
  };
  return P;
}

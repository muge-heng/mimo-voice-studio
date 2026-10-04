/* 工作站导航与主题：nav.go 由 app.js 注入，避免模块互相回指 */

import { state } from '../lib/state.js';
import { $ } from '../lib/utils.js';
import { I } from '../data.js';

export const STATIONS = {
  read: ['01', '文本朗读'], design: ['02', '音色设计'], clone: ['03', '音色克隆'],
  library: ['04', '媒体库'], settings: ['05', '设置']
};

export const nav = {
  go() { /* app.js 覆盖 */ }
};

export function applyTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  $('#themeBtn').innerHTML = t === 'dark' ? I.sun : I.moon;
}

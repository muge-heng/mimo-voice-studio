/* 全局应用状态（单一可变对象，模块间共享） */

export const state = {
  apiKey: '',
  keyTypeSel: 'auto',      // auto | pay | token
  proxyUrl: '',            // 自建转发地址；留空则使用同源服务端函数
  streamMode: true,
  keepText: true,
  exportDir: null,
  dirGranted: false,
  autoExport: true,
  autoArchive: true,
  voice: 'mimo_default',
  selectedSample: null,
  view: 'read',
  theme: 'light',
  serverKey: false,
  svc: null,
  genBusy: false,
  queueCancel: false
};

export function detectKeyType(k) {
  if (/^tp-/.test(k)) return 'token';
  if (/^sk-/.test(k)) return 'pay';
  return null;
}

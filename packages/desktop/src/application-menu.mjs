export const APP_MENU_ACCELERATORS = Object.freeze({
  editAddress: 'CommandOrControl+Shift+L',
  reload: 'CommandOrControl+R',
  zoomIn: 'CommandOrControl+=',
  zoomOut: 'CommandOrControl+-',
  resetZoom: 'CommandOrControl+0',
  togglefullscreen: 'F11',
  macosFullscreen: 'Control+Command+F',
})

const editItems = () => ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map((role) => ({ role }))
const reloadItem = (handlers) => ({ label: '刷新页面', accelerator: APP_MENU_ACCELERATORS.reload, click: handlers.reload })
const zoomItems = (handlers) => [
  { label: '放大', accelerator: APP_MENU_ACCELERATORS.zoomIn, click: handlers.zoomIn },
  { label: '缩小', accelerator: APP_MENU_ACCELERATORS.zoomOut, click: handlers.zoomOut },
  { label: '重置缩放', accelerator: APP_MENU_ACCELERATORS.resetZoom, click: handlers.resetZoom },
 ]
const fullscreenItem = (platform, handlers) => platform === 'darwin'
  ? { label: '全屏', accelerator: APP_MENU_ACCELERATORS.macosFullscreen, role: 'togglefullscreen' }
  : { label: '全屏', accelerator: APP_MENU_ACCELERATORS.togglefullscreen, click: handlers.togglefullscreen }

export function buildMoreMenu({ handlers, connected, host, platform = 'win32' }) {
  const hostLabel = host?.length > 32 ? host.slice(0, 15) + '…' + host.slice(-16) : host
  return [
    ...(hostLabel ? [{ label: '当前站点：' + hostLabel, enabled: false }, { type: 'separator' }] : []),
    { label: connected ? '更换服务器…' : '连接服务器…', accelerator: APP_MENU_ACCELERATORS.editAddress, click: handlers.editAddress },
    reloadItem(handlers),
    { label: '页面缩放', submenu: zoomItems(handlers) },
    fullscreenItem(platform, handlers),
    { label: '编辑', submenu: editItems() },
  ]
}

export function buildApplicationMenu({ appName, platform, handlers, connected }) {
  const more = buildMoreMenu({ handlers, connected, platform })
  if (platform !== 'darwin') return [{ label: '更多', submenu: more }]

  const view = { label: '视图', submenu: [reloadItem(handlers), { type: 'separator' }, ...zoomItems(handlers), { type: 'separator' }, fullscreenItem(platform, handlers)] }
  return [
    { label: appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '更多', submenu: [more[0]] },
    { label: '编辑', submenu: editItems() },
    view,
    { label: '窗口', role: 'windowMenu' },
  ]
}

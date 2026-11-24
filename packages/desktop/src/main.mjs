import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { connectToServer, isCertificateError, parseServerAddress } from './connection.mjs'
import { readServer, saveServer } from './preferences.mjs'
import { attachSite, openWebLink, sandbox } from './site-view.mjs'
import { getWindowChromeOptions, TITLEBAR_HEIGHT } from './window-chrome.mjs'
import { buildApplicationMenu, buildMoreMenu } from './application-menu.mjs'

const ui = new URL('../ui/index.html', import.meta.url)
const preload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const docs = 'https://github.com/Asheblog/Ai-Chat-web-UI#快速部署'
let window
let site
let saved
let attempt = 0
let state = { mode: 'form', address: '' }
let confirmedOrigin = null

function render(next) {
  const connectionChanged = (state.mode === 'connected') !== (next.mode === 'connected')
  state = next
  if (window && !window.isDestroyed()) window.webContents.send('connection:state', state)
  if (connectionChanged) menu()
}

function closeSite() {
  const previous = site
  site = undefined
  previous?.close()
}

function editAddress() {
  attempt++
  closeSite()
  render({ mode: 'form', address: state.address || saved?.origin || '' })
  window?.webContents.focus()
}

function fail(address, kind) {
  closeSite()
  render({ mode: 'error', address, kind })
  window?.webContents.focus()
}

async function connect(input) {
  if (state.mode === 'checking' || state.mode === 'connected') return
  const parsed = parseServerAddress(input)
  if (!parsed.ok) return fail(typeof input === 'string' ? input : '', 'invalid')

  const id = ++attempt
  const targetWindow = window
  const { origin, insecure } = parsed
  const current = () => id === attempt && window === targetWindow && !targetWindow.isDestroyed()
  render({ mode: 'checking', address: origin })
  if (insecure && origin !== saved?.origin && origin !== confirmedOrigin) {
    const { response } = await dialog.showMessageBox(targetWindow, {
      type: 'warning', title: '未加密的连接', message: '此服务器使用未加密的 HTTP。',
      detail: '其他人可能在网络上读取或修改账号和聊天内容。仅在你信任的网络中继续。\n' + origin,
      buttons: ['修改地址', '继续连接'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (!current()) return
    if (response !== 1) return editAddress()
    confirmedOrigin = origin
  }

  const probe = await connectToServer(origin, { fetch: (...args) => session.fromPartition('connection-probe').fetch(...args), allowInsecure: insecure })
  if (!current()) return
  if (!probe.ok) return fail(origin, probe.kind)

  const candidate = attachSite(targetWindow, origin)
  site = candidate
  let active = false
  candidate.contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!active || !current() || site !== candidate || !isMainFrame || code === -3) return
    fail(origin, isCertificateError(description) ? 'certificate' : 'unreachable')
  })
  candidate.contents.on('render-process-gone', () => {
    if (current() && site === candidate) fail(origin, 'unreachable')
  })
  try {
    await candidate.contents.loadURL(origin)
  } catch (error) {
    if (current() && site === candidate) fail(origin, isCertificateError(error) ? 'certificate' : 'unreachable')
    return
  }
  if (!current() || site !== candidate) return
  try {
    if (saved?.origin !== origin) await saveServer(join(app.getPath('userData'), 'server.json'), parsed)
  } catch (error) {
    console.error('Could not save server address:', error.message)
    if (current()) fail(origin, 'storage')
    return
  }
  if (!current() || site !== candidate) return
  saved = parsed
  active = true
  render({ mode: 'connected', address: origin })
  candidate.show()
}

function runOnContent(method, siteOnly = false) {
  return () => {
    const contents = site?.contents ?? (siteOnly ? undefined : window?.webContents)
    if (contents && !contents.isDestroyed()) method(contents)
  }
}

const menuHandlers = {
  editAddress,
  reload: runOnContent((contents) => contents.reload()),
  zoomIn: runOnContent((contents) => contents.setZoomLevel(contents.getZoomLevel() + 0.5), true),
  zoomOut: runOnContent((contents) => contents.setZoomLevel(contents.getZoomLevel() - 0.5), true),
  resetZoom: runOnContent((contents) => contents.setZoomLevel(0), true),
  togglefullscreen: () => window?.setFullScreen(!window.isFullScreen()),
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenu({ appName: app.name, platform: process.platform, handlers: menuHandlers, connected: state.mode === 'connected' })))
  if (process.platform !== 'darwin') window?.setMenuBarVisibility(false)
}

function openMoreMenu({ right, compact } = {}) {
  if (!window || window.isDestroyed()) return
  const [width] = window.getContentSize()
  if (!Number.isFinite(right) || right <= 0 || right > width) return
  const connected = state.mode === 'connected'
  const host = connected && compact === true ? new URL(state.address).host : undefined
  const popup = Menu.buildFromTemplate(buildMoreMenu({ handlers: menuHandlers, connected, host, platform: process.platform }))
  popup.once('menu-will-show', () => window?.webContents.send('connection:menu-state', true))
  popup.once('menu-will-close', () => {
    window?.webContents.send('connection:menu-state', false)
    if (state.mode === 'connected') site?.contents.focus()
  })
  if (connected) site?.contents.focus()
  popup.popup({ window, x: Math.max(0, Math.round(right - 275)), y: TITLEBAR_HEIGHT })
}

function createWindow() {
  const options = { width: 920, height: 650, minWidth: 400, minHeight: 490, title: 'AI Chat', show: false, backgroundColor: process.platform === 'darwin' ? '#222629' : '#F5F5F2', webPreferences: { ...sandbox, preload, partition: 'desktop-shell' }, ...getWindowChromeOptions(process.platform) }
  if (process.platform !== 'darwin') {
    options.icon = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : fileURLToPath(new URL('../build/icon.png', import.meta.url))
  }
  const created = new BrowserWindow(options)
  window = created
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.once('ready-to-show', () => created.show())
  created.on('close', () => { attempt++; closeSite() })
  created.on('closed', () => { if (window === created) window = undefined })
  state = { mode: 'form', address: saved?.origin ?? '' }
  menu()
  void created.loadURL(ui.href).then(() => {
    if (window === created && saved) return connect(saved.origin)
  }).catch((error) => console.error('Could not initialize connection window:', error.message))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('org.asheblog.aichat.desktop')
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('activate', () => { if (!window && app.isReady()) createWindow() })
  app.whenReady().then(async () => {
    saved = await readServer(join(app.getPath('userData'), 'server.json'))
    for (const [name, handler] of Object.entries({
      get: () => state,
      connect,
      edit: editAddress,
      guide: () => openWebLink(docs),
      menu: openMoreMenu,
      'shell-info': () => ({ platform: process.platform }),
    })) {
      ipcMain.handle('connection:' + name, (event, ...args) => {
        if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== ui.href) {
          throw new Error('Only the local connection screen can use this operation')
        }
        return handler(...args)
      })
    }
    if (!window) createWindow()
  }).catch((error) => { console.error(error); app.quit() })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getWindowChromeOptions, getSiteViewBounds, TITLEBAR_HEIGHT } from '../src/window-chrome.mjs'
import { APP_MENU_ACCELERATORS, buildApplicationMenu, buildMoreMenu } from '../src/application-menu.mjs'

test('defines one 44px titlebar and reserves native Windows controls without an Alt menu bar', () => {
  assert.equal(TITLEBAR_HEIGHT, 44)
  assert.deepEqual(getWindowChromeOptions('win32'), {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F5F5F2', symbolColor: '#1B2023', height: 44 },
    autoHideMenuBar: false,
  })
})

test('keeps macOS traffic lights native on the dark titlebar', () => {
  assert.deepEqual(getWindowChromeOptions('darwin'), {
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#222629',
    trafficLightPosition: { x: 15, y: 15 },
  })
  assert.equal(APP_MENU_ACCELERATORS.macosFullscreen, 'Control+Command+F')
})

test('places the site viewport below chrome through resize and fullscreen bounds', () => {
  assert.deepEqual(getSiteViewBounds(1280, 800), { x: 0, y: 44, width: 1280, height: 756 })
  assert.deepEqual(getSiteViewBounds(400, 500), { x: 0, y: 44, width: 400, height: 456 })
  assert.deepEqual(getSiteViewBounds(1, 20), { x: 0, y: 44, width: 1, height: 0 })
})

test('builds a current-site and server/view menu with working handlers', () => {
  const handlers = Object.fromEntries(['editAddress', 'reload', 'zoomIn', 'zoomOut', 'resetZoom', 'togglefullscreen'].map((name) => [name, () => name]))
  const items = buildMoreMenu({ handlers, connected: true, host: 'chat.example.com' })
  assert.deepEqual(items.map(({ label }) => label ?? '-'), ['当前站点：chat.example.com', '-', '更换服务器…', '刷新页面', '页面缩放', '全屏', '编辑'])
  assert.equal(items[2].click(), 'editAddress')
  assert.equal(items[3].click(), 'reload')
  assert.equal(items[4].submenu[0].click(), 'zoomIn')
  assert.equal(items.at(-1).submenu[3].role, 'copy')
  assert.equal(items[5].accelerator, 'F11')
  assert.equal(APP_MENU_ACCELERATORS.editAddress, 'CommandOrControl+Shift+L')
  assert.equal(buildMoreMenu({ handlers, connected: false })[0].label, '连接服务器…')
  assert.equal(buildMoreMenu({ handlers, connected: true, host: 'a'.repeat(70) })[0].label.length <= 43, true)
})

test('anchors the native More popup to the button right edge and titlebar', () => {
  const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes('right - 275'))
  assert.ok(source.includes('y: TITLEBAR_HEIGHT'))
})

test('keeps CSS titlebar geometry, Windows caption space, and narrow layout in sync', () => {
  const css = readFileSync(new URL('../ui/connection.css', import.meta.url), 'utf8')
  assert.ok(css.includes('height: 44px'))
  assert.ok(css.includes('@media (max-width: 520px)'))
  assert.ok(css.includes('max(12px, calc('))
  assert.ok(!css.includes('max(138px'))
})

test('keeps standard macOS app, edit, view, and window menus', () => {
  const noop = () => undefined
  const handlers = Object.fromEntries(['editAddress', 'reload', 'zoomIn', 'zoomOut', 'resetZoom', 'togglefullscreen'].map((name) => [name, noop]))
  const menu = buildApplicationMenu({ appName: 'AI Chat', platform: 'darwin', handlers, connected: true })
  assert.deepEqual(menu.map(({ label }) => label), ['AI Chat', '更多', '编辑', '视图', '窗口'])
  assert.deepEqual(menu[1].submenu.map(({ label }) => label), ['更换服务器…'])
  assert.equal(menu[0].submenu.at(-1).role, 'quit')
  assert.equal(menu.at(-1).role, 'windowMenu')
  assert.equal(menu[3].submenu.at(-1).accelerator, 'Control+Command+F')
  assert.equal(menu[3].submenu.at(-1).role, 'togglefullscreen')
})

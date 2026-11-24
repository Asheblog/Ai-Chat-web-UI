import { BrowserWindow, WebContentsView, session, shell } from 'electron'
import { classifyNavigation, externalWebUrl } from './connection.mjs'
import { getSiteViewBounds } from './window-chrome.mjs'

export const sandbox = Object.freeze({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })

export function openWebLink(value) {
  const url = externalWebUrl(value)
  if (url) void shell.openExternal(url.href).catch((error) => console.error('Could not open browser:', error.message))
}

function configureSite(contents, origin, window, options, previews) {
  contents.on('will-navigate', (event) => {
    const route = classifyNavigation(origin, event.url)
    if (route !== 'site') event.preventDefault()
    if (route === 'external') openWebLink(event.url)
  })
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame && classifyNavigation(origin, event.url) !== 'site') event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    const route = classifyNavigation(origin, url)
    if (route === 'external') openWebLink(url)
    if (route === 'site' && previews.size === 0) {
      const popup = new BrowserWindow({ parent: window, width: 900, height: 700, webPreferences: options })
      previews.add(popup)
      popup.on('closed', () => previews.delete(popup))
      configureSite(popup.webContents, origin, window, options, previews)
      void popup.loadURL(url).catch(() => popup.close())
    } else if (route === 'site') {
      const [popup] = previews
      popup.focus()
      void popup.loadURL(url).catch(() => popup.close())
    }
    return { action: 'deny' }
  })
}

export function attachSite(window, origin) {
  const siteSession = session.fromPartition('persist:site-' + encodeURIComponent(origin))
  const clipboard = (permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === origin
  siteSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => clipboard(permission, requestingOrigin))
  siteSession.setPermissionRequestHandler((_contents, permission, done, { requestingUrl }) => {
    done(clipboard(permission, externalWebUrl(requestingUrl)?.origin))
  })
  const webPreferences = { ...sandbox, session: siteSession }
  const view = new WebContentsView({ webPreferences })
  const previews = new Set()
  window.contentView.addChildView(view)
  view.setVisible(false)
  const resize = () => {
    const [width, height] = window.getContentSize()
    view.setBounds(getSiteViewBounds(width, height))
  }
  resize()
  window.on('resize', resize)
  configureSite(view.webContents, origin, window, webPreferences, previews)
  return {
    contents: view.webContents,
    show() {
      resize()
      view.setVisible(true)
      view.webContents.focus()
    },
    close() {
      window.removeListener('resize', resize)
      for (const preview of previews) preview.destroy()
      if (!window.isDestroyed()) window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    },
  }
}

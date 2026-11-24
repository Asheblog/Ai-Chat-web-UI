export const TITLEBAR_HEIGHT = 44

export function getWindowChromeOptions(platform) {
  if (platform === 'darwin') return {
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#222629',
    trafficLightPosition: { x: 15, y: 15 },
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F5F5F2', symbolColor: '#1B2023', height: TITLEBAR_HEIGHT },
    autoHideMenuBar: false,
  }
}

export function getSiteViewBounds(width, height) {
  return { x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) }
}

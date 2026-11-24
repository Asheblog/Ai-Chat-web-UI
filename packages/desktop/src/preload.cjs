const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopConnection', {
  getState: () => ipcRenderer.invoke('connection:get'),
  connect: (address) => ipcRenderer.invoke('connection:connect', address),
  edit: () => ipcRenderer.invoke('connection:edit'),
  openGuide: () => ipcRenderer.invoke('connection:guide'),
  openMenu: (bounds) => ipcRenderer.invoke('connection:menu', bounds),
  shellInfo: () => ipcRenderer.invoke('connection:shell-info'),
  onMenuState: (listener) => ipcRenderer.on('connection:menu-state', (_event, open) => listener(open)),
  onState: (listener) => {
    ipcRenderer.on('connection:state', (_event, state) => listener(state))
  },
})

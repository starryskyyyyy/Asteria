const { contextBridge, ipcRenderer } = require('electron');

// The renderer only ever sees this frozen surface: no Node, no ipcRenderer, no arbitrary channels.
contextBridge.exposeInMainWorld('asteria', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('asteria:bootstrap'),
  getConnections: (paths) => ipcRenderer.invoke('asteria:connections', paths),
  pickFolder: () => ipcRenderer.invoke('asteria:pick-folder'),
  listConversations: () => ipcRenderer.invoke('asteria:list-conversations'),
  getConversation: (id) => ipcRenderer.invoke('asteria:get-conversation', id),
  createConversation: (request) => ipcRenderer.invoke('asteria:create-conversation', request),
  setRoute: (id, route) => ipcRenderer.invoke('asteria:set-route', { id, route }),
  sendMessage: (id, text) => ipcRenderer.invoke('asteria:send-message', { id, text }),
  cancel: (id) => ipcRenderer.invoke('asteria:cancel', id),
  resolveApproval: (id, requestId, choice) => ipcRenderer.invoke('asteria:resolve-approval', { id, requestId, choice }),
  archive: (id) => ipcRenderer.invoke('asteria:archive', id),
  legacyArchive: () => ipcRenderer.invoke('asteria:legacy-archive'),
  openExternal: (url) => ipcRenderer.invoke('asteria:open-external', url),
  onEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('asteria:event', handler);
    return () => ipcRenderer.removeListener('asteria:event', handler);
  },
}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  setUnread(count) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 0) return;
    ipcRenderer.send('unread-count', n);
  },
});

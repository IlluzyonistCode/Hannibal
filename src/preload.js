const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getSettings: () => ipcRenderer.invoke('settings:get-all'),
    saveSettings: (p) => ipcRenderer.invoke('settings:save', p),
    getApiKey: () => ipcRenderer.invoke('settings:get-key'),
    saveApiKey: (key) => ipcRenderer.invoke('settings:save-key', key),
    aiCall: (msgs, temp) => ipcRenderer.invoke('ai:call', { messages: msgs, temperature: temp }),
    lexList: (f) => ipcRenderer.invoke('lexicon:list', f),
    lexAdd: (e) => ipcRenderer.invoke('lexicon:add', e),
    lexDelete: (id) => ipcRenderer.invoke('lexicon:delete', id),
    lexUpdate: (p) => ipcRenderer.invoke('lexicon:update', p),
    lexExport: () => ipcRenderer.invoke('lexicon:export'),
    lexImport: () => ipcRenderer.invoke('lexicon:import'),
    lexClearAll: () => ipcRenderer.invoke('lexicon:clear-all'),
    lexLanguages: () => ipcRenderer.invoke('lexicon:languages')
});

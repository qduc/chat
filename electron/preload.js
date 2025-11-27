const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__API_BASE_URL__', 'http://localhost:3001/api');

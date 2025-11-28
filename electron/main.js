import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';
import { migrate } from '@blackglory/better-sqlite3-migrations';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const IS_DEV = !app.isPackaged;

// Set environment variables for the backend
process.env.SKIP_AUTO_START = "true";
process.env.NODE_ENV = IS_DEV ? 'development' : 'production';
process.env.DATA_DIR = app.getPath('userData');
process.env.DB_URL = `file:${path.join(app.getPath('userData'), 'chat.sqlite')}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'electron-secret-key'; // Should be secure in real app
process.env.PERSIST_TRANSCRIPTS = 'true';

// Backend path
// In dev: ../backend/src/index.js
// In prod: ./backend/src/index.js (we will copy backend folder to app root)
const backendPath = IS_DEV
  ? path.join(__dirname, '../backend/src/index.js')
  : path.join(__dirname, 'backend/src/index.js');
const frontendDistPath = IS_DEV
  ? path.join(__dirname, '../frontend/out')
  : path.join(__dirname, 'frontend/out');

process.env.UI_DIST_PATH = frontendDistPath;

let mainWindow;
let server;
let backendPort; // Will be assigned dynamically

async function startBackend() {
  try {
    console.log("Starting backend from:", backendPath);

    // Inject Database constructor to ensure we use the one built for Electron
    const clientPath = path.join(path.dirname(backendPath), 'db/client.js');
    try {
      const dbClient = await import(clientPath);
      if (dbClient.setDatabaseConstructor) {
        dbClient.setDatabaseConstructor(Database);
        console.log("Injected better-sqlite3 into backend");
      }
    } catch (e) {
      console.error("Failed to inject better-sqlite3:", e);
    }

    // Inject migrate function
    const migrationsPath = path.join(path.dirname(backendPath), 'db/migrations.js');
    try {
      const migrationsMod = await import(migrationsPath);
      if (migrationsMod.setMigrate) {
        migrationsMod.setMigrate(migrate);
        console.log("Injected migrate into backend");
      }
    } catch (e) {
      console.error("Failed to inject migrate:", e);
    }

    const backend = await import(backendPath);
    if (backend.startServer) {
      // Use port 0 to let the OS assign an available port
      server = backend.startServer(0);
      // Get the actual port assigned by the OS
      backendPort = server.address().port;
      console.log(`Backend started on dynamic port ${backendPort}`);
    } else {
      console.error("Backend module does not export startServer");
    }
  } catch (err) {
    console.error("Failed to start backend:", err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Frontend path
  if (IS_DEV) {
    // In dev, we assume Next.js is running on 3000
    // Or we can serve the out directory if built
    // For now, let's try to load localhost:3000 if available, else file
    mainWindow.loadURL("http://localhost:3000").catch(() => {
      console.log("Next.js dev server not found, loading static build...");
      const staticPath = path.join(frontendDistPath, "index.html");
      if (fs.existsSync(staticPath)) {
        mainWindow.loadFile(staticPath);
      }
    });
  } else {
    // In prod, wait for the bundled backend to serve the exported frontend
    const backendUrl = `http://localhost:${backendPort}`;
    const attemptLoad = (retries = 5) => {
      mainWindow.loadURL(backendUrl).catch((err) => {
        if (retries <= 0) {
          console.error("Failed to load backend UI, giving up:", err);
          return;
        }
        setTimeout(() => attemptLoad(retries - 1), 500);
      });
    };
    attemptLoad();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  await startBackend();

  // Set up IPC handler to provide the backend port to the renderer
  ipcMain.handle("get-api-base-url", () => {
    return `http://localhost:${backendPort}/api`;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (server) {
    server.close();
  }
});

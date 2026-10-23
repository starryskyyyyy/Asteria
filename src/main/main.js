import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConversationManager } from './conversation-manager.js';
import { APP_ID, APP_NAME } from './app-info.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Profile isolation must be configured before Electron checks the single-instance lock.
const isolatedDataDir = process.env.ASTERIA_DATA_DIR ? path.resolve(process.env.ASTERIA_DATA_DIR) : null;
if (isolatedDataDir) app.setPath('userData', path.join(isolatedDataDir, 'electron-user-data'));
app.setAppUserModelId(APP_ID);

const hasSingleInstance = app.requestSingleInstanceLock();
const devUrl = process.env.ASTERIA_DEV_URL || '';
let manager;
let mainWindow = null;
let stateRoot = '';
let settingsPath = '';
let readyToQuit = false;

function settingsFile() { return path.join(stateRoot, 'settings.json'); }

async function loadSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8'));
    const cliPaths = parsed?.cliPaths && typeof parsed.cliPaths === 'object' ? parsed.cliPaths : {};
    return { cliPaths: { codex: typeof cliPaths.codex === 'string' ? cliPaths.codex : '', dsh: typeof cliPaths.dsh === 'string' ? cliPaths.dsh : '' } };
  } catch { return { cliPaths: { codex: '', dsh: '' } }; }
}

async function saveSettings(settings) {
  try {
    await mkdir(stateRoot, { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  } catch (error) { console.error('Failed to persist settings', error); }
}

async function boot() {
  stateRoot = isolatedDataDir ? path.join(isolatedDataDir, 'state') : path.join(app.getPath('userData'), 'state');
  settingsPath = settingsFile();
  const settings = await loadSettings();
  manager = new ConversationManager({ root: stateRoot, cliPaths: settings.cliPaths });
  try { await manager.bootstrap(); }
  catch (error) {
    dialog.showErrorBox('Asteria 无法读取本地历史', `对话数据库或备份无法读取。原文件已保留，请先备份或修复后重启。\n\n历史目录：${stateRoot}\n${String(error?.message || error)}`);
    app.exit(1);
    return;
  }
  manager.subscribe((event) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('asteria:event', event); });
  registerIpc();
  createWindow();
}

function registerIpc() {
  // Asteria needs no device permissions at all; deny every request instead of prompting.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('asteria:bootstrap', () => manager.bootstrap());
  ipcMain.handle('asteria:connections', async (_event, paths = {}) => {
    const result = await manager.refreshCatalogs(paths);
    await saveSettings({ cliPaths: manager.cliPaths });
    return result;
  });
  ipcMain.handle('asteria:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('asteria:list-conversations', () => manager.listConversations());
  ipcMain.handle('asteria:get-conversation', (_event, id) => manager.getConversation(id));
  ipcMain.handle('asteria:create-conversation', (_event, request) => manager.createConversation(request));
  ipcMain.handle('asteria:set-route', (_event, request) => manager.setRoute(request.id, request.route));
  ipcMain.handle('asteria:send-message', (_event, request) => manager.sendMessage(request.id, request.text));
  ipcMain.handle('asteria:cancel', (_event, id) => manager.cancel(id));
  ipcMain.handle('asteria:resolve-approval', (_event, request) => manager.resolveApproval(request.id, request.requestId, request.choice));
  ipcMain.handle('asteria:archive', (_event, id) => manager.archive(id));
  ipcMain.handle('asteria:legacy-archive', () => manager.store.listLegacyArchive());
  // Renderer links never navigate the shell; only https/http/mailto reach the OS browser.
  ipcMain.handle('asteria:open-external', async (_event, url) => {
    if (typeof url !== 'string' || url.length > 4096) return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false;
    await shell.openExternal(parsed.href).catch(() => {});
    return true;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 680,
    backgroundColor: '#101319', title: `${APP_NAME} 2.0`, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const entryUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
  const allowedOrigins = new Set([new URL(entryUrl).origin, 'null']);
  if (devUrl) { try { allowedOrigins.add(new URL(devUrl).origin); } catch {} }
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let origin;
    try { origin = new URL(url).origin; } catch { event.preventDefault(); return; }
    if (origin !== new URL(entryUrl).origin && !allowedOrigins.has(origin)) event.preventDefault();
  });
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection in main process', reason); });

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
if (hasSingleInstance) app.whenReady().then(boot); else app.quit();
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && manager) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  readyToQuit = true;
  Promise.resolve(manager?.dispose()).catch(() => {}).finally(() => app.quit());
});

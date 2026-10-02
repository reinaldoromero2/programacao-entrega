const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let updatePromptOpen = false;

function getUpdateWindow() {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
}

async function showUpdateDialog(options) {
  if (updatePromptOpen) return null;
  const win = getUpdateWindow();
  if (!win) return null;

  updatePromptOpen = true;
  try {
    return await dialog.showMessageBox(win, options);
  } finally {
    updatePromptOpen = false;
  }
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('[autoUpdater] Falha ao verificar ou baixar atualização:', error);
  });

  autoUpdater.on('update-available', async (info) => {
    const result = await showUpdateDialog({
      type: 'info',
      title: 'Atualização disponível',
      message: `A versão ${info.version} está disponível.`,
      detail: 'Deseja baixar e instalar agora? O aplicativo pedirá para reiniciar quando o download terminar.',
      buttons: ['Baixar atualização', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result?.response === 0) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        console.error('[autoUpdater] Falha ao baixar atualização:', error);
        const win = getUpdateWindow();
        if (win) {
          await dialog.showMessageBox(win, {
            type: 'error',
            title: 'Erro na atualização',
            message: 'Não foi possível baixar a atualização.',
            detail: 'Verifique sua conexão e tente novamente ao abrir o aplicativo.',
            buttons: ['OK'],
          });
        }
      }
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const result = await showUpdateDialog({
      type: 'info',
      title: 'Atualização pronta',
      message: `A versão ${info.version} foi baixada.`,
      detail: 'Reinicie o aplicativo para concluir a instalação.',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result?.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[autoUpdater] Falha ao verificar atualizações:', error);
    });
  };

  setTimeout(checkForUpdates, 10_000);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
}

ipcMain.handle('print-window', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

  if (!win) return false;

  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    landscape: true,
    pageSize: 'A4',
    margins: {
      marginType: 'custom',
      top: 0.47,
      bottom: 0.47,
      left: 0.39,
      right: 0.39,
    },
  });

  const pdfPath = path.join(app.getPath('temp'), `programacao-entrega-${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  await shell.openPath(pdfPath);
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.webContents.on('before-input-event', (event, input) => {
    const modifiers = input.modifiers || [];
    const hasControl = input.control || input.meta || modifiers.includes('control') || modifiers.includes('meta');
    if (!hasControl || input.type !== 'keyDown') return;

    if (input.key === '+' || input.key === '=' || input.code === 'Equal' || input.code === 'NumpadAdd') {
      event.preventDefault();
      win.webContents.setZoomFactor(Math.min(win.webContents.getZoomFactor() + 0.1, 1.3));
    } else if (input.key === '-' || input.key === '_' || input.code === 'Minus' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      win.webContents.setZoomFactor(Math.max(win.webContents.getZoomFactor() - 0.1, 0.8));
    } else if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
    }
  });

  const indexPath = path.join(__dirname, '../dist/index.html');
  win.loadFile(indexPath).catch((err) => {
    console.error('Erro ao carregar o arquivo:', err);
  });
}

app.whenReady().then(() => {
  createWindow();
  configureAutoUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
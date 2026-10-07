const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
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

const RQC008_SCRIPT = 'C:\\RIPack\\atualizar-rqc008.ps1';
const RQC008_LOG = 'C:\\RIPack\\atualizar-rqc008.log';
const RQC008_TIMEOUT = 12 * 60 * 1000;
let rqc008Running = false;

function readLogLines() {
  try {
    return fs.readFileSync(RQC008_LOG, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  } catch {
    return [];
  }
}

async function rodarRqc008() {
  if (rqc008Running) return { ok: false, exitCode: null, lines: ['Já existe uma atualização em andamento.'] };
  if (!fs.existsSync(RQC008_SCRIPT)) return { ok: false, exitCode: null, lines: [`Script não encontrado: ${RQC008_SCRIPT}`] };

  rqc008Running = true;
  const before = readLogLines().length;
  try {
    const exitCode = await new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RQC008_SCRIPT], { windowsHide: true });
      const timer = setTimeout(() => child.kill(), RQC008_TIMEOUT);
      child.on('error', () => { clearTimeout(timer); resolve(-1); });
      child.on('exit', (code) => { clearTimeout(timer); resolve(code ?? -1); });
    });
    const after = readLogLines();
    // linhas desta execução; se o log foi truncado, mostra só o fim
    const lines = after.length > before ? after.slice(before) : after.slice(-8);
    const last = lines[lines.length - 1] || '';
    return { ok: exitCode === 0 && last.includes('OK:'), exitCode, lines };
  } finally {
    rqc008Running = false;
  }
}

// botão "📗 Atualizar RQ C 008" dentro do app: roda o script e devolve o resultado
ipcMain.handle('rodar-rqc008', () => rodarRqc008());

// O Romaneio roda num iframe da janela principal (rota #/romaneio). Pedidos de nova janela
// dele chegam aqui: o botão "📗 Atualizar RQ C 008" roda o script e o app envia a planilha.
function tratarNovaJanela(win, { url }) {
  if (url.startsWith('ripack-atualizar:')) {
    rodarRqc008().then((r) => {
      if (r.ok && !win.isDestroyed()) win.webContents.send('rqc008-atualizada');
    });
    return { action: 'deny' };
  }
  if (/^https?:/.test(url)) {
    shell.openExternal(url);
    return { action: 'deny' };
  }
  return { action: 'allow' };
}

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
  win.webContents.setWindowOpenHandler((details) => tratarNovaJanela(win, details));
  // o zoom antigo era da janela inteira; agora cada tela guarda o seu
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1));

  win.webContents.on('before-input-event', (event, input) => {
    const modifiers = input.modifiers || [];
    const hasControl = input.control || input.meta || modifiers.includes('control') || modifiers.includes('meta');
    if (!hasControl || input.type !== 'keyDown') return;

    // cada tela (Programação, Romaneio, grade RQ C 008) tem o seu zoom: o app decide qual muda
    let acao = null;
    if (input.key === '+' || input.key === '=' || input.code === 'Equal' || input.code === 'NumpadAdd') acao = '+';
    else if (input.key === '-' || input.key === '_' || input.code === 'Minus' || input.code === 'NumpadSubtract') acao = '-';
    else if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') acao = '0';
    if (acao) {
      event.preventDefault();
      win.webContents.send('atalho-zoom', acao);
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
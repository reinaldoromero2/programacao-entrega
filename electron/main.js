const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { criarOfsAuto } = require('./ofs-auto');

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

// Lançar OFs no sistema (Oracle), a partir do Romaneio: o mesmo das planilhas "Inclusor da OF".
// O script vai como -EncodedCommand (dentro do app instalado ele fica no pacote .asar, que o
// PowerShell não abre) e roda no PowerShell 32 bits, como a conexão Oracle destes PCs.
const OFS_SCRIPT = path.join(__dirname, 'ofs-oracle.ps1');
const OFS_TEMPO = 120 * 1000;

function rodarOfsOracle(entrada) {
  return new Promise((resolve) => {
    let script;
    try {
      script = fs.readFileSync(OFS_SCRIPT, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      resolve({ ok: false, erros: ['Script do lançamento de OFs não encontrado no app.'] });
      return;
    }
    const ps32 = path.join(process.env.WINDIR || 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const exe = fs.existsSync(ps32) ? ps32 : 'powershell.exe';
    const child = spawn(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true,
      env: { ...process.env, RIPACK_OFS_ENTRADA: Buffer.from(JSON.stringify(entrada), 'utf8').toString('base64'), RIPACK_OFS_PASTA: pastaInclusor() || '' },
    });
    let saida = '';
    let erro = '';
    child.stdout.on('data', (d) => { saida += d.toString('utf8'); });
    child.stderr.on('data', (d) => { erro += d.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), OFS_TEMPO);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, erros: [e.message] }); });
    child.on('exit', () => {
      clearTimeout(timer);
      const json = saida.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ ok: false, erros: [(erro || saida || 'Sem resposta do Oracle.').trim().slice(0, 500)] });
      }
    });
  });
}

// a conexão vem das planilhas do Inclusor: sem elas (PC sem o L:), o botão nem aparece
// pasta das planilhas do Inclusor: em qualquer letra de unidade (o L: aqui é o N: em outro PC — a
// mesma pasta de rede) ou, sem unidade mapeada, direto pelo caminho de rede
const OFS_PASTAS = [
  ...'LNDEFGHIJKMOPQRSTUVWXYZ'.split('').map((l) => l + ':\\01 - Inclusor de OF'),
  '\\\\server\\logistica\\01 - Inclusor de OF',
];
const OFS_ARQUIVO_MATRIZ = 'Inclusor da OF na NOTA FISCAL - Matriz.xlsm';
let ofsPastaAchada = null;
function pastaInclusor() {
  if (ofsPastaAchada && fs.existsSync(path.join(ofsPastaAchada, OFS_ARQUIVO_MATRIZ))) return ofsPastaAchada;
  ofsPastaAchada = OFS_PASTAS.find((p) => { try { return fs.existsSync(path.join(p, OFS_ARQUIVO_MATRIZ)); } catch { return false; } }) || null;
  return ofsPastaAchada;
}
// lançamento automático quando um romaneio é criado (ver ofs-auto.js) — só Oracle, sem o servidor/Neon
let ofsAuto = null;
ipcMain.handle('ofs-oracle', (_evento, entrada) => {
  if (entrada && entrada.acao === 'disponivel') return { ok: !!pastaInclusor() };
  if (entrada && entrada.acao === 'auto') return ofsAuto ? ofsAuto.lancar(String(entrada.id), entrada.romaneio || {}) : null;
  if (entrada && entrada.acao === 'status') return ofsAuto ? ofsAuto.status() : {};
  if (entrada && entrada.acao === 'registrar') return ofsAuto ? ofsAuto.registrar(String(entrada.id), entrada.linhas, entrada.completo) : null;
  return rodarOfsOracle(entrada);
});

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
  // "⧉ Abrir em outra tela" da grade RQ C 008: janela própria (para outro monitor), sem Node
  if (/\/romaneio\/index\.html\?grade=1/.test(url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        title: 'RQ C 008 — Programação de Entrega',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      },
    };
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
  // janelas abertas a partir do app (ex.: grade em outra tela) seguem as mesmas regras
  win.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler((details) => tratarNovaJanela(win, details));
  });
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
  ofsAuto = criarOfsAuto({ rodarOfsOracle, pastaDados: app.getPath('userData'), disponivel: () => !!pastaInclusor() });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
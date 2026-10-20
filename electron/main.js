const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { criarOfsAuto } = require('./ofs-auto');

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let updatePromptOpen = false;

function getUpdateWindow() {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win !== janelaAtualizando);
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

// janelinha "Atualizando…" com a barra de progresso (também na barra de tarefas)
let janelaAtualizando = null;
function abrirJanelaAtualizando(versao) {
  if (janelaAtualizando && !janelaAtualizando.isDestroyed()) return;
  const pai = getUpdateWindow();
  janelaAtualizando = new BrowserWindow({
    width: 420, height: 150, resizable: false, minimizable: false, maximizable: false, closable: false,
    frame: false, alwaysOnTop: true, skipTaskbar: true, show: false, parent: pai || undefined, modal: !!pai,
    backgroundColor: '#ffffff', webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#fff;color:#1e293b;border:1px solid #cbd5e1;height:148px;box-sizing:border-box;padding:22px 24px}
    h1{font-size:15px;margin:0 0 4px} p{font-size:12px;color:#64748b;margin:0 0 14px}
    .barra{height:10px;background:#e2e8f0;border-radius:6px;overflow:hidden}
    .cheio{height:100%;width:0;background:#2563eb}
    .num{font-size:12px;color:#334155;margin-top:8px;text-align:right}
  </style></head><body>
    <h1>Atualizando para a versão ${String(versao || '').replace(/[^0-9.]/g, '')}…</h1>
    <p id="msg">Baixando a atualização. Não feche o app.</p>
    <div class="barra"><div class="cheio" id="cheio"></div></div>
    <div class="num" id="num">0%</div>
  </body></html>`;
  janelaAtualizando.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  janelaAtualizando.once('ready-to-show', () => janelaAtualizando && !janelaAtualizando.isDestroyed() && janelaAtualizando.show());
}
function mostrarProgresso(pct, mensagem) {
  const pai = getMainWindowParaProgresso();
  if (pai) pai.setProgressBar(pct >= 100 ? -1 : pct / 100);
  if (!janelaAtualizando || janelaAtualizando.isDestroyed()) return;
  const js = `document.getElementById('cheio').style.width='${pct.toFixed(0)}%';document.getElementById('num').textContent='${pct.toFixed(0)}%';` +
    (mensagem ? `document.getElementById('msg').textContent=${JSON.stringify(mensagem)};` : '');
  janelaAtualizando.webContents.executeJavaScript(js).catch(() => {});
}
function fecharJanelaAtualizando() {
  const pai = getMainWindowParaProgresso();
  if (pai) pai.setProgressBar(-1);
  if (janelaAtualizando && !janelaAtualizando.isDestroyed()) janelaAtualizando.destroy();
  janelaAtualizando = null;
}
function getMainWindowParaProgresso() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== janelaAtualizando) || null;
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('[autoUpdater] Falha ao verificar ou baixar atualização:', error);
  });

  // Uma pergunta só: aceitou, aparece só a barra "Atualizando…"; baixa, o instalador mostra só a
  // barra "Instalando…" (sem perguntas, na mesma pasta de antes) e o app abre de novo sozinho.
  let instalarAoBaixar = false;

  autoUpdater.on('update-available', async (info) => {
    const result = await showUpdateDialog({
      type: 'info',
      title: 'Atualização disponível',
      message: `A versão ${info.version} está disponível.`,
      detail: 'Atualizar agora? O app baixa, instala sozinho e abre de novo em seguida.',
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result?.response !== 0) return;

    instalarAoBaixar = true;
    abrirJanelaAtualizando(info.version);
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[autoUpdater] Falha ao baixar atualização:', error);
      instalarAoBaixar = false;
      fecharJanelaAtualizando();
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
  });

  autoUpdater.on('download-progress', (p) => {
    mostrarProgresso(Math.max(0, Math.min(100, p.percent || 0)));
  });

  autoUpdater.on('update-downloaded', () => {
    if (!instalarAoBaixar) return;
    mostrarProgresso(100, 'Instalando… o app vai abrir de novo sozinho.');
    // a janelinha não fecha pelo X: some antes de o app sair para instalar. O instalador "um clique"
    // mostra só a tela "Instalando, por favor aguarde…" com a barra, na mesma pasta, e reabre o app.
    setTimeout(() => { fecharJanelaAtualizando(); autoUpdater.quitAndInstall(false, true); }, 1200);
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
// O script é copiado do pacote .asar (que o PowerShell não abre) para a pasta de dados do app e
// roda no PowerShell 32 bits, como a conexão Oracle destes PCs.
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
    // o script já passou do limite da linha de comando do Windows (~32 mil caracteres) como
    // -EncodedCommand: vai para um arquivo na pasta de dados do app e roda com -File
    const arquivo = path.join(app.getPath('userData'), 'ofs-oracle.ps1');
    try {
      const conteudo = '\uFEFF' + script;
      let atual = null;
      try { atual = fs.readFileSync(arquivo, 'utf8'); } catch {}
      if (atual !== conteudo) fs.writeFileSync(arquivo, conteudo, 'utf8');
    } catch (e) {
      resolve({ ok: false, erros: ['Não foi possível preparar o script do sistema: ' + e.message] });
      return;
    }
    const ps32 = path.join(process.env.WINDIR || 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const exe = fs.existsSync(ps32) ? ps32 : 'powershell.exe';
    const child = spawn(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', arquivo], {
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
  if (entrada && entrada.acao === 'planilhaAuditoriaExiste') return { ok: fs.existsSync(planilhaAuditoria()) };
  if (entrada && entrada.acao === 'arquivoPastaExiste') return { ok: fs.existsSync(pastaExpedicao()) };
  if (entrada && entrada.acao === 'arquivoIniciar') return arquivoIniciar(entrada.mes);
  if (entrada && entrada.acao === 'arquivoGravar') return arquivoGravar(entrada.mes, entrada.caminho, entrada.base64);
  if (entrada && entrada.acao === 'arquivoFechar') return arquivoFechar(entrada.mes, entrada.esperado);
  if (entrada && entrada.acao === 'planilhaAuditoria') return rodarPlanilhaAuditoria(entrada.linhas || []);
  if (entrada && entrada.acao === 'disponivel') return { ok: !!pastaInclusor() };
  if (entrada && entrada.acao === 'auto') return ofsAuto ? ofsAuto.lancar(String(entrada.id), entrada.romaneio || {}) : null;
  if (entrada && entrada.acao === 'status') return ofsAuto ? ofsAuto.status() : {};
  if (entrada && entrada.acao === 'registrar') return ofsAuto ? ofsAuto.registrar(String(entrada.id), entrada.linhas, entrada.completo) : null;
  return rodarOfsOracle(entrada);
});

// Auditoria diária: as auditorias registradas no app entram também na planilha
// "Lista de Auditorias de Processo - Expedição.xlsx" (área de trabalho, pasta EXPEDIÇÃO), pelo próprio
// Excel para manter a formatação. Só no PC que tem a planilha; uma gravação por vez.
const AUD_SCRIPT = path.join(__dirname, 'auditoria-planilha.ps1');
function planilhaAuditoria() {
  return path.join(app.getPath('desktop'), 'EXPEDIÇÃO', 'Lista de Auditorias de Processo - Expedição.xlsx');
}
let filaPlanilha = Promise.resolve();
function rodarPlanilhaAuditoria(linhas) {
  const tarefa = filaPlanilha.then(() => new Promise((resolve) => {
    const arquivo = planilhaAuditoria();
    if (!fs.existsSync(arquivo)) { resolve({ ok: false, erro: 'Planilha não encontrada neste PC.' }); return; }
    const copia = path.join(app.getPath('userData'), 'auditoria-planilha.ps1');
    try {
      const conteudo = fs.readFileSync(AUD_SCRIPT, 'utf8');
      let atual = null;
      try { atual = fs.readFileSync(copia, 'utf8'); } catch {}
      if (atual !== conteudo) fs.writeFileSync(copia, conteudo, 'utf8');
    } catch (e) { resolve({ ok: false, erro: 'Não foi possível preparar o script da planilha: ' + e.message }); return; }
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', copia], {
      windowsHide: true,
      env: { ...process.env, RIPACK_AUD_ENTRADA: Buffer.from(JSON.stringify({ arquivo, linhas }), 'utf8').toString('base64') },
    });
    let saida = '';
    child.stdout.on('data', (d) => { saida += d.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), 180 * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, erro: e.message }); });
    child.on('exit', () => {
      clearTimeout(timer);
      const json = saida.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
      try { resolve(JSON.parse(json)); } catch { resolve({ ok: false, erro: (saida || 'Sem resposta do Excel.').trim().slice(0, 300) }); }
    });
  }));
  filaPlanilha = tarefa.catch(() => {});
  return tarefa;
}

// Arquivo mensal dos romaneios: a página manda cada arquivo (PDF, desenho, dados) e no fim o
// Windows monta "Romaneios AAAA-MM.zip" em Área de trabalho\EXPEDIÇÃO\Romaneios arquivados.
// O .zip é aberto de novo e conferido (quantidade de arquivos) antes de a página apagar algo.
function pastaExpedicao() { return path.join(app.getPath('desktop'), 'EXPEDIÇÃO'); }
function pastaTempArquivo(mes) { return path.join(app.getPath('userData'), 'arquivo-romaneios', String(mes).replace(/[^0-9-]/g, '')); }
function arquivoIniciar(mes) {
  try {
    if (!/^\d{4}-\d{2}$/.test(String(mes))) return { ok: false, erro: 'Mês inválido.' };
    if (!fs.existsSync(pastaExpedicao())) return { ok: false, erro: 'Pasta EXPEDIÇÃO não encontrada na área de trabalho deste PC.' };
    const dir = pastaTempArquivo(mes);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}
function arquivoGravar(mes, caminho, base64) {
  try {
    const dir = pastaTempArquivo(mes);
    // só caminhos relativos simples ("2026-10-15/0530 3M SUMARÉ - SUL2F81.pdf")
    const rel = String(caminho || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').map((x) => x.replace(/[<>:"|?*]/g, '')).join(path.sep);
    if (!rel) return { ok: false, erro: 'Nome de arquivo vazio.' };
    const destino = path.join(dir, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(String(base64 || ''), 'base64'));
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}
function arquivoFechar(mes, esperado) {
  return new Promise((resolve) => {
    try {
      const dir = pastaTempArquivo(mes);
      const saidaDir = path.join(pastaExpedicao(), 'Romaneios arquivados');
      fs.mkdirSync(saidaDir, { recursive: true });
      let zip = path.join(saidaDir, 'Romaneios ' + mes + '.zip');
      for (let n = 2; fs.existsSync(zip); n++) zip = path.join(saidaDir, 'Romaneios ' + mes + ' (' + n + ').zip');
      // entradas com "/" (o CreateFromDirectory do Windows grava "\\", que outros programas leem como nome)
      const ps = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
        "$base = (Get-Item -LiteralPath $env:RIPACK_ARQ_DIR).FullName.TrimEnd('\\') + '\\'; " +
        "$zw = [IO.Compression.ZipFile]::Open($env:RIPACK_ARQ_ZIP, 'Create'); " +
        "Get-ChildItem -LiteralPath $env:RIPACK_ARQ_DIR -Recurse -File | ForEach-Object { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zw, $_.FullName, $_.FullName.Substring($base.Length).Replace('\\', '/').TrimStart('/')) }; " +
        "$zw.Dispose(); " +
        "$z = [IO.Compression.ZipFile]::OpenRead($env:RIPACK_ARQ_ZIP); $n = @($z.Entries | Where-Object { $_.Length -gt 0 }).Count; $z.Dispose(); Write-Output $n";
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true, env: { ...process.env, RIPACK_ARQ_DIR: dir, RIPACK_ARQ_ZIP: zip },
      });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d.toString('utf8'); });
      child.stderr.on('data', (d) => { err += d.toString('utf8'); });
      child.on('error', (e) => resolve({ ok: false, erro: e.message }));
      child.on('exit', () => {
        const n = parseInt(String(out).trim().split(/\s+/).pop(), 10);
        if (!(n >= 0)) { resolve({ ok: false, erro: (err || out || 'Não foi possível montar o .zip.').trim().slice(0, 300) }); return; }
        if (Number(esperado) !== n) { resolve({ ok: false, erro: 'O .zip ficou com ' + n + ' arquivo(s), eram esperados ' + esperado + '. Nada foi apagado.', caminho: zip }); return; }
        let bytes = 0;
        try { bytes = fs.statSync(zip).size; } catch {}
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        resolve({ ok: true, caminho: zip, arquivos: n, bytes });
      });
    } catch (e) { resolve({ ok: false, erro: e.message }); }
  });
}

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
const { app, BrowserWindow, Menu, Tray, shell, globalShortcut, ipcMain, nativeImage, dialog, Notification } = require('electron')
const path = require('path')

// Auto-updater (GitHub Releases)
let autoUpdater
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
} catch (e) {
  console.warn('[KQA] electron-updater não disponível:', e.message)
}

// electron-store para persistência local
let store
try {
  const Store = require('electron-store')
  store = new Store({
    defaults: {
      ambientes: [],
      templates: [],
      windowBounds: { width: 1400, height: 900 },
      miniMode: false,
      lastTab: 'kqa'
    }
  })
} catch (e) {
  // Fallback simples se electron-store não estiver instalado ainda
  store = {
    _data: {},
    get: function(key, def) { return this._data[key] !== undefined ? this._data[key] : def },
    set: function(key, val) { this._data[key] = val }
  }
}

let mainWindow
let miniWindow
let tray
let shortcutsWindow

// ─────────────────────────────────────────────
// JANELA PRINCIPAL
// ─────────────────────────────────────────────
function createMainWindow() {
  const bounds = store.get('windowBounds', { width: 1400, height: 900 })

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    title: 'KQA Desktop',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Persiste sessão entre reinicializações
      partition: 'persist:kqa'
    },
    autoHideMenuBar: true,
    backgroundColor: '#13131f'
  })

  mainWindow.loadURL('https://kqa.vercel.app/')

  // Salva tamanho da janela ao redimensionar
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize()
    store.set('windowBounds', { width, height })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    injectStyles(mainWindow)
    injectFooterCredit(mainWindow)
  })

  // Links externos abrem no navegador
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─────────────────────────────────────────────
// MINI-MODE (janela flutuante compacta)
// ─────────────────────────────────────────────
function createMiniWindow() {
  if (miniWindow) {
    miniWindow.focus()
    return
  }

  miniWindow = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 360,
    minHeight: 400,
    maxWidth: 600,
    title: 'KQA · Mini',
    alwaysOnTop: true,      // Fica sempre na frente
    frame: false,           // Sem barra de título padrão
    transparent: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:kqa'   // Mesma sessão da janela principal!
    },
    backgroundColor: '#13131f'
  })

  miniWindow.loadURL('https://kqa.vercel.app/')

  miniWindow.webContents.on('did-finish-load', () => {
    injectStyles(miniWindow)
    // No mini-mode, injeta uma barra de controle customizada no topo
    miniWindow.webContents.insertCSS(`
      #kqa-mini-bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #1e1e35; border-bottom: 1px solid #c0397a;
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 10px; height: 32px; -webkit-app-region: drag;
        font-family: monospace; font-size: 12px; color: #c0397a;
        user-select: none;
      }
      #kqa-mini-bar button {
        -webkit-app-region: no-drag;
        background: transparent; border: 1px solid #c0397a;
        color: #c0397a; border-radius: 4px; padding: 2px 8px;
        font-size: 11px; cursor: pointer; font-family: monospace;
      }
      #kqa-mini-bar button:hover { background: #c0397a; color: #fff; }
      body { padding-top: 32px !important; }
    `)
    miniWindow.webContents.executeJavaScript(`
      const bar = document.createElement('div')
      bar.id = 'kqa-mini-bar'
      bar.innerHTML = \`
        <span>⬡ KQA Mini</span>
        <div style="display:flex;gap:6px">
          <button onclick="window.electronAPI.expandWindow()">⤢ Expandir</button>
          <button onclick="window.electronAPI.closeMini()" style="border-color:#ff6b6b;color:#ff6b6b">✕</button>
        </div>
      \`
      document.body.prepend(bar)
    `)
  })

  miniWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isEscape = input.key === 'Escape'
    const isCtrlW = (input.control || input.meta) && input.key.toLowerCase() === 'w'
    if (isEscape || isCtrlW) {
      event.preventDefault()
      miniWindow?.close()
    }
  })

  miniWindow.on('closed', () => { miniWindow = null })
}

// ─────────────────────────────────────────────
// JANELA DE ATALHOS
// ─────────────────────────────────────────────
function createShortcutsWindow() {
  if (shortcutsWindow) {
    shortcutsWindow.focus()
    return
  }

  shortcutsWindow = new BrowserWindow({
    width: 600,
    height: 620,
    resizable: false,
    title: 'Atalhos de teclado — KQA Desktop',
    parent: mainWindow,
    modal: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    backgroundColor: '#13131f',
    autoHideMenuBar: true
  })

  shortcutsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(shortcutsHTML())}`)
  shortcutsWindow.on('closed', () => { shortcutsWindow = null })
}

function shortcutsHTML() {
  const groups = [
    {
      title: '🪟 Janela',
      items: [
        ['Ctrl + Shift + K', 'Trazer KQA à frente (de qualquer app)'],
        ['Ctrl + Shift + M', 'Abrir / fechar Mini-mode'],
        ['Ctrl + Shift + A', 'Abrir aba do Artia'],
        ['F11', 'Tela cheia'],
        ['F5', 'Recarregar'],
        ['Ctrl + Shift + R', 'Forçar recarregar (limpa cache)'],
      ]
    },
    {
      title: '🔍 Visualização',
      items: [
        ['Ctrl + =', 'Aumentar zoom'],
        ['Ctrl + -', 'Diminuir zoom'],
        ['Ctrl + 0', 'Zoom padrão (100%)'],
        ['F12', 'DevTools (debug)'],
      ]
    },
    {
      title: '❓ Ajuda',
      items: [
        ['Ctrl + /', 'Esta janela de atalhos'],
        ['Ctrl + Shift + H', 'Esta janela (global)'],
        ['Ctrl + Shift + O', 'Abrir KQA no navegador'],
        ['Esc', 'Fechar mini-mode'],
      ]
    }
  ]

  const rows = groups.map(g => `
    <div class="group">
      <div class="group-title">${g.title}</div>
      ${g.items.map(([k, d]) => `
        <div class="row">
          <span class="desc">${d}</span>
          <span class="keys">${k.split('+').map(p => `<kbd>${p.trim()}</kbd>`).join('<span class="plus">+</span>')}</span>
        </div>
      `).join('')}
    </div>
  `).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Atalhos</title><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #13131f; color: #e0e0f0; font-family: monospace; padding: 24px; font-size: 13px; }
    h1 { color: #c0397a; font-size: 16px; margin-bottom: 20px; border-bottom: 1px solid #c0397a; padding-bottom: 10px; }
    .group { margin-bottom: 20px; }
    .group-title { color: #00d4ff; font-size: 12px; margin-bottom: 8px; letter-spacing: 1px; }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #1e1e35; }
    .desc { color: #a0a0c0; }
    .keys { display: flex; align-items: center; gap: 2px; }
    kbd { background: #1e1e35; border: 1px solid #c0397a; color: #c0397a; border-radius: 4px; padding: 2px 7px; font-family: monospace; font-size: 11px; }
    .plus { color: #555; margin: 0 1px; }
    footer { margin-top: 16px; color: #555; font-size: 11px; text-align: center; }
  </style></head><body>
    <h1>⌨ Atalhos de teclado — KQA Desktop</h1>
    ${rows}
    <footer>KQA Desktop v2.0 · Dante de Oliveira Tavares · Estagiário de QA</footer>
  </body></html>`
}

// ─────────────────────────────────────────────
// INJEÇÕES DE ESTILO E CRÉDITO
// ─────────────────────────────────────────────
function injectStyles(win) {
  win.webContents.insertCSS(`
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #1a1a2e; }
    ::-webkit-scrollbar-thumb { background: #c0397a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #e040a0; }
  `)
}

function injectFooterCredit(win) {
  win.webContents.executeJavaScript(`
    (function() {
      let attempts = 0
      const MAX_ATTEMPTS = 20
      function injectCredit() {
        const footer = document.querySelector('footer') ||
          [...document.querySelectorAll('div')].find(el =>
            el.innerText && el.innerText.includes('QA Lead')
          )
        if (!footer) {
          if (++attempts >= MAX_ATTEMPTS) return
          return setTimeout(injectCredit, 1000)
        }
        if (document.querySelector('.kqa-desktop-credit')) return

        const style = document.createElement('style')
        style.textContent = \`
          .kqa-desktop-credit { display:flex; align-items:center; gap:8px; margin-top:6px; font-size:12px; color:#a0a0b0; font-family:monospace; }
          .kqa-desktop-credit .dot { width:6px; height:6px; border-radius:50%; background:#c0397a; display:inline-block; }
          .kqa-desktop-credit .role { color:#7070a0; font-size:11px; }
        \`
        document.head.appendChild(style)

        const credit = document.createElement('div')
        credit.className = 'kqa-desktop-credit'
        credit.innerHTML = '<span class="dot"></span><span>Dante de Oliveira Tavares</span><span class="role">🖥️ Estagiário de QA · Desktop v2</span>'
        footer.appendChild(credit)
      }
      injectCredit()
    })()
  `)
}

// ─────────────────────────────────────────────
// IPC — Comunicação com o preload
// ─────────────────────────────────────────────
ipcMain.handle('get-store', (_, key, def) => store.get(key, def))
ipcMain.handle('set-store', (_, key, val) => { store.set(key, val); return true })

ipcMain.handle('open-mini', () => createMiniWindow())
ipcMain.handle('close-mini', () => { if (miniWindow) miniWindow.close() })
ipcMain.handle('expand-window', () => {
  if (miniWindow) miniWindow.close()
  if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  else createMainWindow()
})

ipcMain.handle('open-artia', () => {
  shell.openExternal('https://app.artia.com')
})

ipcMain.handle('show-shortcuts', () => createShortcutsWindow())

ipcMain.handle('notify', (_, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

// ─────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────
function createMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', accelerator: 'F5', click: () => mainWindow?.reload() },
        { label: 'Forçar recarregar', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Abrir Artia', accelerator: 'CmdOrCtrl+Shift+A', click: () => shell.openExternal('https://app.artia.com') },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Tela cheia', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => { const z = mainWindow?.webContents.getZoomFactor(); mainWindow?.webContents.setZoomFactor(Math.min(z + 0.1, 2)) } },
        { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => { const z = mainWindow?.webContents.getZoomFactor(); mainWindow?.webContents.setZoomFactor(Math.max(z - 0.1, 0.5)) } },
        { label: 'Zoom padrão', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.setZoomFactor(1) },
        { type: 'separator' },
        { label: 'DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() }
      ]
    },
    {
      label: 'Modo',
      submenu: [
        { label: 'Mini-mode (flutuante)', accelerator: 'CmdOrCtrl+Shift+M', click: () => createMiniWindow() }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Atalhos de teclado', accelerator: 'CmdOrCtrl+/', click: () => createShortcutsWindow() },
        { type: 'separator' },
        { label: 'Abrir KQA no navegador', accelerator: 'CmdOrCtrl+Shift+O', click: () => shell.openExternal('https://kqa.vercel.app/') },
        { label: 'Abrir pasta de dados locais', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: 'Verificar atualizações', click: async () => {
          if (!autoUpdater || !app.isPackaged) {
            dialog.showMessageBox(mainWindow, { type: 'info', title: 'Atualizações', message: 'Disponível apenas na versão instalada.' })
            return
          }
          try {
            const result = await autoUpdater.checkForUpdates()
            if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
              dialog.showMessageBox(mainWindow, { type: 'info', title: 'Atualizações', message: 'Você já está na versão mais recente.' })
            }
          } catch (e) {
            dialog.showMessageBox(mainWindow, { type: 'error', title: 'Atualizações', message: 'Falha ao verificar.', detail: e.message })
          }
        }},
        { type: 'separator' },
        { label: 'Sobre', click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'KQA Desktop',
            message: 'KQA Desktop v2.0.0',
            detail: 'App desktop para o sistema KQA\nGerador de Dados para QA\n\nDesenvolvido por:\n• Karla — QA Lead & Automation\n• Dante de Oliveira Tavares — Estagiário de QA\n\n© 2026 - Sistema KQA'
          })
        }}
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

// ─────────────────────────────────────────────
// TRAY
// ─────────────────────────────────────────────
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'))
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Abrir KQA', click: () => { if (mainWindow) mainWindow.show(); else createMainWindow() } },
      { label: 'Mini-mode', click: () => createMiniWindow() },
      { label: 'Artia', click: () => shell.openExternal('https://app.artia.com') },
      { type: 'separator' },
      { label: 'Atalhos', click: () => createShortcutsWindow() },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() }
    ])
    tray.setToolTip('KQA Desktop')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createMainWindow() })
  } catch (e) {
    console.warn('[KQA] Tray init failed:', e.message)
  }
}

// ─────────────────────────────────────────────
// ATALHOS GLOBAIS
// ─────────────────────────────────────────────
function registerShortcuts() {
  // Trazer à frente de qualquer app
  globalShortcut.register('CommandOrControl+Shift+K', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
    else createMainWindow()
  })

  // Mini-mode toggle
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (miniWindow) miniWindow.close()
    else createMiniWindow()
  })

  // Atalhos de teclado
  globalShortcut.register('CommandOrControl+Shift+H', () => createShortcutsWindow())

  // Abrir Artia
  globalShortcut.register('CommandOrControl+Shift+A', () => shell.openExternal('https://app.artia.com'))

  // Abrir KQA no navegador
  globalShortcut.register('CommandOrControl+Shift+O', () => shell.openExternal('https://kqa.vercel.app/'))
}

// ─────────────────────────────────────────────
// AUTO-UPDATE
// ─────────────────────────────────────────────
function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'KQA Desktop — atualização disponível',
        body: `Versão ${info.version} sendo baixada em segundo plano…`
      }).show()
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      title: 'Atualização pronta',
      message: `KQA Desktop ${info.version} foi baixada.`,
      detail: 'Reinicie para aplicar a atualização.'
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[KQA] update error:', err?.message || err)
  })

  autoUpdater.checkForUpdates().catch(() => { /* offline / sem release */ })
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow()
  createMenu()
  createTray()
  registerShortcuts()
  setupAutoUpdate()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

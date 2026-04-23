const { app, BrowserWindow, Menu, Tray, shell, globalShortcut, ipcMain, nativeImage, dialog, Notification } = require('electron')
const path = require('path')

// ─────────────────────────────────────────────
// SINGLE INSTANCE LOCK
// ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const KQA_URL = 'https://kqa.vercel.app/'
const ARTIA_URL = 'https://app.artia.com'
const LOG_PREFIX = '[KQA]'

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const isAlive = (win) => !!win && !win.isDestroyed()

function debounce(fn, delay) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

// ─────────────────────────────────────────────
// AUTO-UPDATER (GitHub Releases)
// ─────────────────────────────────────────────
let autoUpdater
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
} catch (e) {
  console.warn(`${LOG_PREFIX} electron-updater não disponível:`, e.message)
}

// ─────────────────────────────────────────────
// ELECTRON-STORE (com fallback em memória)
// ─────────────────────────────────────────────
let store
try {
  const Store = require('electron-store')
  store = new Store({
    defaults: {
      ambientes: [],
      templates: [],
      mainWindowState: { width: 1400, height: 900, isMaximized: false },
      miniWindowBounds: { width: 420, height: 600 },
      zoomFactor: 1,
      miniMode: false,
      lastTab: 'kqa'
    }
  })
} catch (e) {
  console.warn(`${LOG_PREFIX} electron-store indisponível, usando fallback em memória:`, e.message)
  store = {
    _data: {},
    get(key, def) { return this._data[key] !== undefined ? this._data[key] : def },
    set(key, val) { this._data[key] = val }
  }
}

let mainWindow
let miniWindow
let tray
let shortcutsWindow

// ─────────────────────────────────────────────
// FACTORY DE JANELAS (DRY)
// ─────────────────────────────────────────────
function buildBrowserWindow(overrides = {}) {
  const base = {
    backgroundColor: '#13131f',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:kqa'
    }
  }
  return new BrowserWindow({
    ...base,
    ...overrides,
    webPreferences: { ...base.webPreferences, ...(overrides.webPreferences || {}) }
  })
}

// ─────────────────────────────────────────────
// PERSISTÊNCIA DE BOUNDS
// ─────────────────────────────────────────────
function sanitizeMainState(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback
  const ok = (n) => Number.isFinite(n) && n >= 0
  const out = {
    width: ok(raw.width) && raw.width >= 400 ? raw.width : fallback.width,
    height: ok(raw.height) && raw.height >= 300 ? raw.height : fallback.height,
    isMaximized: !!raw.isMaximized
  }
  if (ok(raw.x) && ok(raw.y)) { out.x = raw.x; out.y = raw.y }
  return out
}

const saveMainWindowState = debounce(() => {
  if (!isAlive(mainWindow)) return
  const isMaximized = mainWindow.isMaximized()
  const state = { isMaximized }
  if (!isMaximized) {
    const [width, height] = mainWindow.getSize()
    const [x, y] = mainWindow.getPosition()
    Object.assign(state, { x, y, width, height })
  } else {
    // Mantém bounds pré-maximização para restauração futura
    const prev = store.get('mainWindowState', {}) || {}
    Object.assign(state, { x: prev.x, y: prev.y, width: prev.width, height: prev.height })
  }
  store.set('mainWindowState', state)
}, 300)

const saveMiniWindowBounds = debounce(() => {
  if (!isAlive(miniWindow)) return
  const [width, height] = miniWindow.getSize()
  store.set('miniWindowBounds', { width, height })
}, 300)

// ─────────────────────────────────────────────
// JANELA PRINCIPAL
// ─────────────────────────────────────────────
function createMainWindow() {
  if (isAlive(mainWindow)) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const state = sanitizeMainState(
    store.get('mainWindowState'),
    { width: 1400, height: 900, isMaximized: false }
  )

  mainWindow = buildBrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: 'KQA Desktop'
  })

  if (state.isMaximized) mainWindow.maximize()

  mainWindow.loadURL(KQA_URL)

  // Mantém título estático do app
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  mainWindow.on('resize', saveMainWindowState)
  mainWindow.on('move', saveMainWindowState)
  mainWindow.on('maximize', saveMainWindowState)
  mainWindow.on('unmaximize', saveMainWindowState)

  mainWindow.webContents.on('did-finish-load', () => {
    if (!isAlive(mainWindow)) return
    const z = Number(store.get('zoomFactor', 1)) || 1
    mainWindow.webContents.setZoomFactor(Math.min(Math.max(z, 0.5), 2))
    injectStyles(mainWindow)
    injectFooterCredit(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─────────────────────────────────────────────
// MINI-MODE
// ─────────────────────────────────────────────
function createMiniWindow() {
  if (isAlive(miniWindow)) {
    miniWindow.focus()
    return
  }

  const b = store.get('miniWindowBounds', { width: 420, height: 600 }) || { width: 420, height: 600 }

  miniWindow = buildBrowserWindow({
    width: b.width,
    height: b.height,
    minWidth: 360,
    minHeight: 400,
    maxWidth: 600,
    title: 'KQA · Mini',
    alwaysOnTop: true,
    frame: false,
    resizable: true
  })

  miniWindow.loadURL(KQA_URL)
  miniWindow.on('page-title-updated', (e) => e.preventDefault())
  miniWindow.on('resize', saveMiniWindowBounds)

  miniWindow.webContents.on('did-finish-load', () => {
    if (!isAlive(miniWindow)) return
    injectStyles(miniWindow)
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
      (function() {
        if (document.getElementById('kqa-mini-bar')) return
        const bar = document.createElement('div')
        bar.id = 'kqa-mini-bar'

        const title = document.createElement('span')
        title.textContent = '⬡ KQA Mini'

        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;gap:6px'

        const expand = document.createElement('button')
        expand.textContent = '⤢ Expandir'
        expand.addEventListener('click', () => window.electronAPI && window.electronAPI.expandWindow())

        const close = document.createElement('button')
        close.textContent = '✕'
        close.style.cssText = 'border-color:#ff6b6b;color:#ff6b6b'
        close.addEventListener('click', () => window.electronAPI && window.electronAPI.closeMini())

        actions.appendChild(expand)
        actions.appendChild(close)
        bar.appendChild(title)
        bar.appendChild(actions)
        document.body.prepend(bar)
      })()
    `)
  })

  miniWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isEscape = input.key === 'Escape'
    const isCtrlW = (input.control || input.meta) && input.key.toLowerCase() === 'w'
    if (isEscape || isCtrlW) {
      event.preventDefault()
      if (isAlive(miniWindow)) miniWindow.close()
    }
  })

  miniWindow.on('closed', () => { miniWindow = null })
}

// ─────────────────────────────────────────────
// JANELA DE ATALHOS
// ─────────────────────────────────────────────
function createShortcutsWindow() {
  if (isAlive(shortcutsWindow)) {
    shortcutsWindow.focus()
    return
  }

  shortcutsWindow = new BrowserWindow({
    width: 600,
    height: 620,
    resizable: false,
    title: 'Atalhos de teclado — KQA Desktop',
    parent: isAlive(mainWindow) ? mainWindow : undefined,
    modal: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    backgroundColor: '#13131f',
    autoHideMenuBar: true
  })

  shortcutsWindow.loadFile(path.join(__dirname, 'assets', 'shortcuts.html'))
  shortcutsWindow.on('closed', () => { shortcutsWindow = null })
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
ipcMain.handle('close-mini', () => { if (isAlive(miniWindow)) miniWindow.close() })
ipcMain.handle('expand-window', () => {
  if (isAlive(miniWindow)) miniWindow.close()
  createMainWindow()
})

ipcMain.handle('open-artia', () => { shell.openExternal(ARTIA_URL) })
ipcMain.handle('show-shortcuts', () => createShortcutsWindow())
ipcMain.handle('notify', (_, title, body) => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
})

// ─────────────────────────────────────────────
// ZOOM
// ─────────────────────────────────────────────
function applyZoom(delta) {
  if (!isAlive(mainWindow)) return
  const current = mainWindow.webContents.getZoomFactor()
  const next = delta === null ? 1 : Math.min(Math.max(current + delta, 0.5), 2)
  mainWindow.webContents.setZoomFactor(next)
  store.set('zoomFactor', next)
}

// ─────────────────────────────────────────────
// DIÁLOGOS
// ─────────────────────────────────────────────
function dialogParent() {
  return isAlive(mainWindow) ? mainWindow : undefined
}

async function checkForUpdatesManual() {
  if (!autoUpdater || !app.isPackaged) {
    dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Atualizações', message: 'Disponível apenas na versão instalada.' })
    return
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Atualizações', message: 'Você já está na versão mais recente.' })
    }
  } catch (e) {
    dialog.showMessageBox(dialogParent(), { type: 'error', title: 'Atualizações', message: 'Falha ao verificar.', detail: e.message })
  }
}

function showAboutDialog() {
  dialog.showMessageBox(dialogParent(), {
    type: 'info',
    title: 'KQA Desktop',
    message: `KQA Desktop v${app.getVersion()}`,
    detail: 'App desktop para o sistema KQA\nGerador de Dados para QA\n\nDesenvolvido por:\n• Karla — QA Lead & Automation\n• Dante de Oliveira Tavares — Estagiário de QA\n\n© 2026 - Sistema KQA'
  })
}

// ─────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────
function createMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', accelerator: 'F5', click: () => isAlive(mainWindow) && mainWindow.reload() },
        { label: 'Forçar recarregar', accelerator: 'CmdOrCtrl+Shift+R', click: () => isAlive(mainWindow) && mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Abrir Artia', accelerator: 'CmdOrCtrl+Shift+A', click: () => shell.openExternal(ARTIA_URL) },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Tela cheia', accelerator: 'F11', click: () => isAlive(mainWindow) && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => applyZoom(0.1) },
        { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => applyZoom(-0.1) },
        { label: 'Zoom padrão', accelerator: 'CmdOrCtrl+0', click: () => applyZoom(null) },
        { type: 'separator' },
        { label: 'DevTools', accelerator: 'F12', click: () => isAlive(mainWindow) && mainWindow.webContents.toggleDevTools() }
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
        { label: 'Abrir KQA no navegador', accelerator: 'CmdOrCtrl+Shift+O', click: () => shell.openExternal(KQA_URL) },
        { label: 'Abrir pasta de dados locais', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: 'Verificar atualizações', click: checkForUpdatesManual },
        { type: 'separator' },
        { label: 'Sobre', click: showAboutDialog }
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
      { label: 'Abrir KQA', click: () => createMainWindow() },
      { label: 'Mini-mode', click: () => createMiniWindow() },
      { label: 'Artia', click: () => shell.openExternal(ARTIA_URL) },
      { type: 'separator' },
      { label: 'Atalhos', click: () => createShortcutsWindow() },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() }
    ])
    tray.setToolTip('KQA Desktop')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => createMainWindow())
  } catch (e) {
    console.warn(`${LOG_PREFIX} Tray init failed:`, e.message)
  }
}

// ─────────────────────────────────────────────
// ATALHOS GLOBAIS
// ─────────────────────────────────────────────
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+K', () => createMainWindow())

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (isAlive(miniWindow)) miniWindow.close()
    else createMiniWindow()
  })

  globalShortcut.register('CommandOrControl+Shift+H', () => createShortcutsWindow())
  globalShortcut.register('CommandOrControl+Shift+A', () => shell.openExternal(ARTIA_URL))
  globalShortcut.register('CommandOrControl+Shift+O', () => shell.openExternal(KQA_URL))
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
    dialog.showMessageBox(dialogParent(), {
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
    console.warn(`${LOG_PREFIX} update error:`, err?.message || err)
  })

  autoUpdater.checkForUpdates().catch(() => { /* offline / sem release */ })
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
app.on('second-instance', () => createMainWindow())

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
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
    tray = null
  }
})

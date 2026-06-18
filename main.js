// ============================================================
// Admin Progresivo Race - app Electron + Express
// Misma estructura que el dashboard principal
// ============================================================
const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const express = require('express');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let httpServer = null;

// ============================================================
// CONFIG
// ============================================================
function loadConfig() {
  // En empaquetado, config.json viene como extraResource fuera del asar
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'config.json')
    : path.join(__dirname, 'config.json');
  const defaults = {
    publicPort: 4000,
    dashboardUrl: 'http://localhost:3000',
    adminUser: 'admin',
    adminPass: 'progresivo123'
  };
  if (fs.existsSync(configPath)) {
    try {
      return Object.assign(defaults, JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    } catch (e) {
      console.error('[CONFIG] Error:', e.message);
    }
  }
  return defaults;
}

// ============================================================
// SERVIDOR EXPRESS
// ============================================================
function startServer(config) {
  const httpApp = express();
  httpApp.use(express.json());

  // Auth basica DESACTIVADA
  // Si la quieres activar, descomenta este bloque:
  /*
  httpApp.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const b64 = h.split(' ')[1] || '';
    const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
    if (u === config.adminUser && p === config.adminPass) return next();
    res.set('WWW-Authenticate', 'Basic realm="Admin Progresivo"');
    return res.status(401).send('Acceso denegado');
  });
  */

  httpApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  async function callDashboard(method, ruta, body) {
    const url = config.dashboardUrl + ruta;
    console.log('[ADMIN] -> ' + method + ' ' + url);
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      const txt = await r.text();
      console.log('[ADMIN] <- ' + r.status + ' (' + txt.length + ' bytes)');
      try { return { status: r.status, data: JSON.parse(txt) }; }
      catch { return { status: r.status, data: txt }; }
    } catch (e) {
      console.error('[ADMIN] ERROR en fetch a ' + url + ': ' + e.message);
      throw e;
    }
  }

  httpApp.get('/api/sprite', async (req, res) => {
    try { const r = await callDashboard('GET', '/sprite-config'); res.status(r.status).json(r.data); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Helper: coerce cualquier representacion de booleano a true/false.
  // Acepta: true/false, "true"/"false", "True"/"False", 1/0, "1"/"0"
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
    }
    return null;
  }

  // ============================================================
  // POST /api/sprite
  // Acepta DOS formatos:
  //
  // 1) Simple (panel web del admin):
  //    { "grand": true|false, "major": true|false }
  //
  // 2) Notificacion del servidor MVC (formato completo):
  //    { "Car": { "ShowAmount": bool, ... }, "Moto": { "ShowAmount": bool, ... }, ... }
  //    ShowAmount=true significa "mostrar monto" -> en la animacion es
  //    "OCULTAR sprite". Se invierte el valor antes de mandar al dashboard.
  // ============================================================
  httpApp.post('/api/sprite', async (req, res) => {
    const body = req.body || {};
    console.log('[ADMIN] /api/sprite body recibido:', JSON.stringify(body));

    let grand, major, modo;

    // Detectar formato MVC: tiene objetos Car y Moto
    if (body.Car && body.Moto) {
      const carShow = toBool(body.Car.ShowAmount);
      const motoShow = toBool(body.Moto.ShowAmount);
      if (carShow === null || motoShow === null) {
        return res.status(400).json({
          success: false,
          message: 'Car.ShowAmount y Moto.ShowAmount deben ser boolean (recibido: Car.ShowAmount=' +
                   JSON.stringify(body.Car.ShowAmount) + ', Moto.ShowAmount=' + JSON.stringify(body.Moto.ShowAmount) + ')'
        });
      }
      // ShowAmount=true -> mostrar monto -> ocultar sprite -> show=false
      grand = !carShow;
      major = !motoShow;
      modo = 'MVC (invertido)';
    }
    // Formato simple
    else {
      const g = toBool(body.grand);
      const m = toBool(body.major);
      if (g === null || m === null) {
        return res.status(400).json({
          success: false,
          message: 'Body invalido. Esperado {grand, major} o {Car:{ShowAmount}, Moto:{ShowAmount}}'
        });
      }
      grand = g;
      major = m;
      modo = 'simple';
    }

    console.log('[ADMIN] /api/sprite (' + modo + ') -> dashboard {grand:' + grand + ', major:' + major + '}');
    try {
      const r = await callDashboard('POST', '/sprite-config-bulk', { grand, major });
      if (r.status >= 200 && r.status < 300) {
        return res.json({
          success: true,
          message: 'Actualizacion recibida correctamente.'
        });
      }
      return res.status(r.status).json({
        success: false,
        message: 'Error en dashboard: ' + (r.data && r.data.error ? r.data.error : JSON.stringify(r.data))
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo notificar al dashboard: ' + e.message
      });
    }
  });
  httpApp.get('/api/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const r = await callDashboard('GET', '/history?limit=' + limit);
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  httpApp.get('/api/audit', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const tipo = req.query.tipo || '';
      let url = '/audit?limit=' + limit;
      if (tipo) url += '&tipo=' + encodeURIComponent(tipo);
      const r = await callDashboard('GET', url);
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  httpServer = httpApp.listen(config.publicPort, () => {
    console.log('[ADMIN] Escuchando en puerto ' + config.publicPort);
    console.log('[ADMIN] Dashboard: ' + config.dashboardUrl);
  });
}

// ============================================================
// VENTANA
// ============================================================
function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Admin Progresivo Race',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  // Cargar el panel directamente (sin auth)
  mainWindow.loadURL('http://localhost:' + config.publicPort + '/');

  // Al cerrar ventana, ocultar al tray (no salir)
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray(config) {
  // Tray con menu para abrir ventana, abrir en navegador, salir
  const iconPath = path.join(__dirname, 'icon.png');
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    // Si no hay icono, no creamos tray (en algunos OS falla)
    return;
  }
  const menu = Menu.buildFromTemplate([
    { label: 'Mostrar panel', click: () => mainWindow.show() },
    { label: 'Abrir en navegador', click: () => shell.openExternal('http://localhost:' + config.publicPort) },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('Admin Progresivo Race');
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow.show());
}

// ============================================================
// CICLO DE VIDA
// ============================================================
app.whenReady().then(() => {
  const config = loadConfig();
  startServer(config);
  createWindow(config);
  createTray(config);
});

app.on('window-all-closed', (e) => {
  // No cerrar la app al cerrar ventana (queda en tray)
  e.preventDefault();
});

app.on('before-quit', () => {
  if (httpServer) httpServer.close();
});
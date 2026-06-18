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
    dashboardPort: 3000,
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

  // Logger general: imprime CUALQUIER peticion que llega al admin
  httpApp.use((req, res, next) => {
    const n = new Date();
    const ts = String(n.getHours()).padStart(2,'0') + ':' +
               String(n.getMinutes()).padStart(2,'0') + ':' +
               String(n.getSeconds()).padStart(2,'0');
    console.log('[ADMIN] ' + ts +
                ' << ' + req.method + ' ' + req.url +
                ' (from ' + (req.ip || req.connection.remoteAddress) + ')');
    next();
  });

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

  // baseUrl es la URL completa del dashboard (ej "http://192.168.1.32:3000")
  // Para llamadas del panel web local se usa "http://localhost:PORT".
  // Para llamadas del MVC se usa "http://<body.ip>:PORT".
  async function callDashboard(baseUrl, method, ruta, body) {
    const url = baseUrl + ruta;
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

  // URL del dashboard local (mismo PC) - usada por el panel admin
  function localDashboardUrl() {
    return 'http://localhost:' + config.dashboardPort;
  }

  // Construye la URL del dashboard a partir de una IP/host.
  // - "192.168.1.32"      -> http://192.168.1.32:<config.dashboardPort>
  // - "192.168.1.32:5000" -> http://192.168.1.32:5000
  // - vacio/null          -> http://localhost:<config.dashboardPort>
  function buildDashboardUrl(ip) {
    if (ip && typeof ip === 'string' && ip.length > 0) {
      const clean = ip.replace(/^https?:\/\//i, '').trim();
      if (clean.includes(':')) return 'http://' + clean;
      return 'http://' + clean + ':' + config.dashboardPort;
    }
    return localDashboardUrl();
  }

  // POST /api/sprite-estado
  // Body opcional: { "ip": "192.168.1.32" }  (sin body o sin ip -> localhost)
  httpApp.post('/api/sprite-estado', async (req, res) => {
    const ip = req.body && req.body.ip;
    const baseUrl = buildDashboardUrl(ip);
    try {
      const r = await callDashboard(baseUrl, 'GET', '/sprite-config');
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
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

    let grand, major, modo, dashboardBaseUrl;

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
      // La IP del dashboard viene en el body (campo "ip"). Si no viene, usar localhost.
      if (!body.ip || typeof body.ip !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Campo "ip" requerido en el body (IP donde corre la animacion).'
        });
      }
      // ShowAmount=true -> mostrar monto -> ocultar sprite -> show=false
      grand = !carShow;
      major = !motoShow;
      modo = 'MVC (invertido)';
      dashboardBaseUrl = 'http://' + body.ip + ':' + config.dashboardPort;
    }
    // Formato simple (panel web local o externo)
    else {
      const g = toBool(body.grand);
      const m = toBool(body.major);
      if (g === null || m === null) {
        return res.status(400).json({
          success: false,
          message: 'Body invalido. Esperado {grand, major} o {Car:{ShowAmount}, Moto:{ShowAmount}, ip}'
        });
      }
      grand = g;
      major = m;
      modo = 'simple';
      // ip opcional: si viene se usa, sino localhost
      dashboardBaseUrl = buildDashboardUrl(body.ip);
    }

    console.log('[ADMIN] /api/sprite (' + modo + ') -> ' + dashboardBaseUrl + ' {grand:' + grand + ', major:' + major + '}');
    try {
      const r = await callDashboard(dashboardBaseUrl, 'POST', '/sprite-config-bulk', { grand, major });
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
  // POST /api/history
  // Body opcional: { "ip": "192.168.1.32", "limit": 50 }
  httpApp.post('/api/history', async (req, res) => {
    try {
      const b = req.body || {};
      const limit = parseInt(b.limit) || 50;
      const baseUrl = buildDashboardUrl(b.ip);
      const r = await callDashboard(baseUrl, 'GET', '/history?limit=' + limit);
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/audit
  // Body opcional: { "ip": "192.168.1.32", "limit": 50, "tipo": "sprite-config-bulk" }
  httpApp.post('/api/audit', async (req, res) => {
    try {
      const b = req.body || {};
      const limit = parseInt(b.limit) || 50;
      const tipo = b.tipo || '';
      const baseUrl = buildDashboardUrl(b.ip);
      let url = '/audit?limit=' + limit;
      if (tipo) url += '&tipo=' + encodeURIComponent(tipo);
      const r = await callDashboard(baseUrl, 'GET', url);
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // POST /api/ultimo-monto
  // Body opcional: { "ip": "192.168.1.32" }  o  { "ip": "192.168.1.32:3000" }
  // Sin body o body.ip vacio -> usa localhost.
  httpApp.post('/api/ultimo-monto', async (req, res) => {
    const ip = req.body && req.body.ip;
    const baseUrl = buildDashboardUrl(ip);
    try {
      const r = await callDashboard(baseUrl, 'GET', '/ultimo-monto');
      res.status(r.status).json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  httpServer = httpApp.listen(config.publicPort, '0.0.0.0', () => {
    console.log('[ADMIN] Escuchando en 0.0.0.0:' + config.publicPort + ' (todas las interfaces)');
    console.log('[ADMIN] Dashboard port: ' + config.dashboardPort + ' (la IP llega en cada request MVC)');
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
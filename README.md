# Admin Progresivo Race

Servicio admin para gestionar el dashboard Progresivo Race. Misma estructura que el dashboard: Electron + electron-builder + GitHub Actions.

## Estructura

```
.
├── .github/workflows/build.yml   # workflow GitHub Actions
├── main.js                        # Electron entry + Express
├── index.html                     # panel web
├── package.json                   # config + electron-builder
└── README.md
```

## Generar un release (instaladores)

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions arma los 3 instaladores y los publica en Releases:
- `Admin Progresivo Race Setup 1.0.0.exe` (Windows NSIS)
- `Admin Progresivo Race-1.0.0.dmg` (macOS)
- `Admin Progresivo Race-1.0.0.AppImage` (Linux portable)
- `admin-progresivo-race_1.0.0_amd64.deb` (Linux Debian)

## Instalar en el casino

Solo doble click al instalador del SO correspondiente. Crea acceso directo en escritorio.

## Configuracion

Hay un `config.json` al lado del ejecutable instalado (en `resources/`), editable:

```json
{
  "publicPort": 4000,
  "dashboardUrl": "http://localhost:3000",
  "adminUser": "admin",
  "adminPass": "progresivo123"
}
```

Ubicacion del `config.json` luego de instalar:
- Windows: `C:\Users\TU_USUARIO\AppData\Local\Programs\admin-progresivo-race\resources\config.json`
- macOS: dentro del `.app` → `Contents/Resources/config.json`
- Linux: `/opt/Admin Progresivo Race/resources/config.json`

Editar y reiniciar la app.

## Uso

- Al abrirla aparece la ventana con el panel
- Puerto 4000 queda escuchando para acceso externo
- Si cierras la ventana, queda en bandeja del sistema (tray)
- Click derecho al tray → Salir (para apagar de verdad)

## Permisos en GitHub

Settings → Actions → General → "Read and write permissions" (para que pueda crear releases).

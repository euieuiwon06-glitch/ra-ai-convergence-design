const { app, BrowserWindow, screen, session, ipcMain } = require("electron");
const path = require("path");

let mainWindow = null;
let alertWindow = null;

const ALERT_WIDTH = 380;
const ALERT_HEIGHT = 112;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 900,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#f6f5f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (alertWindow) {
      alertWindow.close();
      alertWindow = null;
    }
  });
}

function createAlertWindow() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width } = primary.workArea;

  alertWindow = new BrowserWindow({
    width: ALERT_WIDTH,
    height: ALERT_HEIGHT,
    x: Math.round(x + (width - ALERT_WIDTH) / 2),
    y: y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' level floats above fullscreen/other apps' windows too
  alertWindow.setAlwaysOnTop(true, "screen-saver");
  alertWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  alertWindow.loadFile(path.join(__dirname, "alert.html"));
}

app.whenReady().then(() => {
  // getUserMedia needs the camera permission auto-granted inside Electron
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  createMainWindow();
  createAlertWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

ipcMain.on("posture:show-alert", (_event, payload) => {
  if (!alertWindow) return;
  alertWindow.webContents.send("alert:update", payload);
  alertWindow.showInactive(); // never steals focus from whatever app the user is in
});

ipcMain.on("posture:close-alert", () => {
  if (alertWindow) alertWindow.hide();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

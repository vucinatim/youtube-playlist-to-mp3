import { app, BrowserWindow } from "electron";
import { spawn } from "child_process";
import path from "path";
import http from "http";

let mainWindow: BrowserWindow | null;
let nextProc: ReturnType<typeof spawn> | null = null;

function waitForHttpOk(url: string, timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          res.resume();
          if (Date.now() - started > timeoutMs)
            return reject(new Error("timeout"));
          setTimeout(tryOnce, 500);
        }
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs)
          return reject(new Error("timeout"));
        setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
    },
  });

  // In production, spawn Next standalone server
  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    // Resolve .next/standalone server
    const appRoot = path.resolve(__dirname, "..", "..");
    const standaloneDir = path.join(appRoot, ".next", "standalone");
    const port = process.env.PORT || "3579";

    // Spawn: node .next/standalone/server.js -p <port>
    const serverEntry = path.join(standaloneDir, "server.js");
    nextProc = spawn(process.execPath, [serverEntry], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
      },
      stdio: "ignore",
    });

    await waitForHttpOk(`http://127.0.0.1:${port}`);
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  try {
    nextProc?.kill();
  } catch {}
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
let mainWindow;
let nextProc = null;
function waitForHttpOk(url, timeoutMs = 20000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const req = http_1.default.get(url, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
                    resolve();
                }
                else {
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
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        // Resolve .next/standalone server
        const appRoot = path_1.default.resolve(__dirname, "..", "..");
        const standaloneDir = path_1.default.join(appRoot, ".next", "standalone");
        const port = process.env.PORT || "3579";
        // Spawn: node .next/standalone/server.js -p <port>
        const serverEntry = path_1.default.join(standaloneDir, "server.js");
        nextProc = (0, child_process_1.spawn)(process.execPath, [serverEntry], {
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
electron_1.app.on("ready", createWindow);
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (mainWindow === null) {
        createWindow();
    }
});
electron_1.app.on("before-quit", () => {
    try {
        nextProc?.kill();
    }
    catch { }
});

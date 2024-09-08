const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, screen, Tray, Menu } = require("electron");
const path = require("path");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const Mic = require("node-microphone");
const Groq = require("groq-sdk");
const fs = require("fs");
require("dotenv").config();

let store;
(async () => {
    const Store = await import("electron-store");
    store = new Store.default();
})();

let tray = null;
let settingsWindow = null;
let overlayWindow;
let isRecording = false;
let groq;
let micInstance;
let audioBuffer = [];
let keyboardListener;
let isOverlayVisible = false;

function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 400,
        height: 280,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
        show: false,
        center: true,
        frame:false,
        resizable: false,
        transparent: true,
        hasShadow: true,
        backgroundColor: '#00ffffff',
    });

    settingsWindow.loadFile(path.join(__dirname, "../renderer/settings.html"));

    settingsWindow.on('close', (event) => {
        event.preventDefault();
        settingsWindow.hide();
    });
}

function createOverlayWindow() {
    overlayWindow = new BrowserWindow({
        width: 35,
        height: 35,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#00ffffff',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    overlayWindow.loadFile(path.join(__dirname, "../renderer/overlay.html"));
    overlayWindow.setIgnoreMouseEvents(true);
    overlayWindow.setBackgroundColor("#00ffffff");
    overlayWindow.hide();

    setTimeout(() => {
        overlayWindow.setBackgroundColor("#00ffffff");
    }, 100);
}

function getIconPath(isRecording = false) {
    const iconName = isRecording ? 'tray-icon-recording' : 'tray-icon';
    
    if (process.platform === 'win32') {
        return path.join(__dirname, `../../assets/${iconName}.ico`);
    } else if (process.platform === 'darwin') {
        // return path.join(__dirname, `../../assets/${iconName}.icns`);
        return path.join(__dirname, `../../assets/${iconName}-16.png`);
    } else {
        // For Linux and other platforms, use PNG
        return path.join(__dirname, `../../assets/${iconName}-16.png`);
    }
}

function createTray() {
    tray = new Tray(getIconPath());
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Settings', click: () => { settingsWindow.show(); } },
        { label: 'Quit', click: () => { app.quit(); } }
    ]);
    tray.setToolTip('VoiceClipboard');
    tray.setContextMenu(contextMenu);
}

app.whenReady().then(async () => {
    await import("electron-store");
    createSettingsWindow();
    createOverlayWindow();
    createTray();
    setupGlobalHotkey();
    setupGroqClient();
});

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

function setupGlobalHotkey() {
    globalShortcut.unregisterAll();
    const hotkey = store.get("hotkey", "CommandOrControl+Shift+K");

    try {
        const ret = globalShortcut.register(hotkey, () => {
            console.log("Hotkey pressed!");
            toggleRecording();
        });

        if (!ret) {
            console.log("Hotkey registration failed");
        } else {
            console.log(`Hotkey ${hotkey} registered successfully`);
        }
    } catch (error) {
        console.error("Error registering hotkey:", error);
    }
}

function setupGroqClient() {
    const apiKey = process.env.GROQ_API_KEY || store.get("apiKey");
    if (!apiKey) {
        console.error("Groq API key not found. Please set it in the .env file or in the settings.");
        return;
    }
    groq = new Groq({ apiKey });
}

async function toggleRecording() {
    if (isRecording) {
        await stopRecording();
    } else {
        startRecording();
    }
}

function updateOverlayPosition() {
    if (isOverlayVisible) {
        const mousePosition = screen.getCursorScreenPoint();
        overlayWindow.setPosition(mousePosition.x + 10, mousePosition.y + 10);
    }
}

function startRecording() {
    isRecording = true;
    audioBuffer = [];
    micInstance = new Mic();
    const micStream = micInstance.startRecording();
    overlayWindow.webContents.send("update-status", "recording");
    overlayWindow.show();
    tray.setImage(getIconPath(true));

    isOverlayVisible = true;
    const updateInterval = setInterval(updateOverlayPosition, 16);

    micStream.on("data", (data) => {
        audioBuffer.push(data);
    });

    micInstance.on("error", (error) => {
        console.error("Error during recording:", error);
        stopRecording();
    });

    micInstance.on("end", () => {
        clearInterval(updateInterval);
    });
}

async function stopRecording() {
    isRecording = false;
    if (micInstance) {
        micInstance.stopRecording();
    }
    overlayWindow.webContents.send("update-status", "processing");
    tray.setImage(getIconPath());

    try {
        const transcription = await performTranscription();
        if (transcription) {
            clipboard.writeText(transcription);
            overlayWindow.webContents.send("update-status", "done");
            setTimeout(() => overlayWindow.hide(), 700);
        }
    } catch (error) {
        console.error("Error during transcription:", error);
        overlayWindow.webContents.send("update-status", "error");
        setTimeout(() => overlayWindow.hide(), 2000);
    }
}

async function performTranscription() {
    if (!groq) {
        throw new Error("Groq client not initialized");
    }

    const audioFilePath = path.join(app.getPath("temp"), "recorded_audio.wav");
    fs.writeFileSync(audioFilePath, Buffer.concat(audioBuffer));

    try {
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: "distil-whisper-large-v3-en",
            response_format: "json",
            language: "en",
            temperature: 0.0,
        });

        fs.unlinkSync(audioFilePath);
        return transcription.text;
    } catch (error) {
        console.error("Error in Groq API call:", error);
        throw error;
    }
}

ipcMain.handle("get-recording-status", () => isRecording);
ipcMain.handle("get-settings", () => ({
    apiKey: process.env.GROQ_API_KEY || store.get("apiKey", ""),
    hotkey: store.get("hotkey", "Control+Shift+Space"),
}));
ipcMain.handle("save-settings", (event, settings) => {
    store.set("apiKey", settings.apiKey);
    store.set("hotkey", settings.hotkey);
    setupGlobalHotkey();
    setupGroqClient();
});

ipcMain.handle("initialize-app", () => {
    setupGlobalHotkey();
    setupGroqClient();
});

ipcMain.handle("close-settings", () => {
    if (settingsWindow) {
        settingsWindow.hide();
    }
})

ipcMain.handle("toggle-overlay", () => {
    isOverlayVisible = !isOverlayVisible;
    if (isOverlayVisible) {
        overlayWindow.show();
        updateOverlayPosition();
    } else {
        overlayWindow.hide();
    }
    return isOverlayVisible;
});

ipcMain.handle("get-overlay-visibility", () => isOverlayVisible);
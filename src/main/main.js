const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    globalShortcut,
    clipboard,
    screen,
    Tray,
    Menu,
    shell,
} = require("electron");
const path = require("path");
const Groq = require("groq-sdk");
const fs = require("fs");
const os = require("os");
// const Store = require('electron-store');

// Initialize store synchronously
// const store = new Store();

// Import the macOS audio recording addon
const audioRecorder = require('../../macos-audio-addon');

// Import the macOS paste addon
const { pasteText } = require("../../macos-paste-addon");

// Setup logging
const logDir = path.join(os.homedir(), '.voiceclipboard');
const activityLogPath = path.join(logDir, 'activity.log');
const errorLogPath = path.join(logDir, 'error.log');

function setupLogging() {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
    }
    if (!fs.existsSync(activityLogPath)) {
        fs.writeFileSync(activityLogPath, '');
    }
    if (!fs.existsSync(errorLogPath)) {
        fs.writeFileSync(errorLogPath, '');
    }
}

function log(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${message}\n`;
    fs.appendFileSync(isError ? errorLogPath : activityLogPath, logMessage);
    console.log(message); // Also log to console for development
}

let store;
// (async () => {
//     const Store = await import("electron-store");
//     store = new Store.default();
// })();

async function initializeStore() {
    const Store = await import('electron-store');
    store = new Store.default();
}

let tray = null;
let settingsWindow = null;
let overlayWindow;
let isRecording = false;
let groq;
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
        frame: false,
        resizable: false,
        transparent: true,
        hasShadow: true,
        backgroundColor: "#00ffffff",
    });

    settingsWindow.loadFile(path.join(__dirname, "../renderer/settings.html"));

    settingsWindow.on("close", (event) => {
        event.preventDefault();
        settingsWindow.hide();
    });
    log("Settings window created");
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
        backgroundColor: "#00ffffff",
        focusable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.loadFile(path.join(__dirname, "../renderer/overlay.html"));
    overlayWindow.setIgnoreMouseEvents(true);
    overlayWindow.setBackgroundColor("#00ffffff");
    overlayWindow.hide();

    setTimeout(() => {
        overlayWindow.setBackgroundColor("#00ffffff");
    }, 100);
    log("Overlay window created");
}

function getIconPath(isRecording = false) {
    const iconName = isRecording ? "tray-icon-recording" : "tray-icon";
    return path.join(__dirname, `../../assets/${iconName}-16.png`);
}

let forceQuit = false;

app.on('before-quit', () => {
    forceQuit = true;
    log("Application is quitting");
});

function createTray() {
    tray = new Tray(getIconPath());
    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Settings",
            click: () => {
                settingsWindow.show();
                log("Settings opened from tray");
            },
        },
        {
            label: "Open Activity Log",
            click: () => {
                shell.openPath(activityLogPath);
                log("Activity log opened from tray");
            },
        },
        {
            label: "Open Error Log",
            click: () => {
                shell.openPath(errorLogPath);
                log("Error log opened from tray");
            },
        },
        {
            label: "Quit",
            click: () => {
                log("Quit selected from tray");
                app.quit();
            },
        },
    ]);
    tray.setToolTip("VoiceClipboard");
    tray.setContextMenu(contextMenu);
    log("Tray created");
}

async function initializeStore() {
    const Store = await import('electron-store');
    store = new Store.default();
}

app.whenReady().then(async () => {
    await initializeStore();
    setupLogging();
    log("Application starting");
    
    createSettingsWindow();
    createOverlayWindow();
    createTray();
    await setupGlobalHotkey();
    await setupGroqClient();
    log("Application setup complete");
});

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    log("Global shortcuts unregistered");
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") {
        log("All windows closed, quitting application");
        app.quit();
    }
});



async function setupGlobalHotkey() {
    if (!store) await initializeStore();
    globalShortcut.unregisterAll();
    const hotkey = store.get("hotkey", "CommandOrControl+Shift+K");

    try {
        const ret = globalShortcut.register(hotkey, () => {
            log(`Hotkey ${hotkey} pressed`);
            toggleRecording();
        });

        if (!ret) {
            log(`Hotkey ${hotkey} registration failed`, true);
        } else {
            log(`Hotkey ${hotkey} registered successfully`);
        }
    } catch (error) {
        log(`Error registering hotkey: ${error.message}`, true);
    }
}

async function setupGroqClient() {
    if (!store) await initializeStore();
    const apiKey = process.env.GROQ_API_KEY || store.get("apiKey");
    if (!apiKey) {
        log("Groq API key not found", true);
        return;
    }
    log(`API Key found: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);
    groq = new Groq({ apiKey });
    log("Groq client initialized");
}

async function toggleRecording() {
    if (isRecording) {
        await stopRecording();
    } else {
        startRecording();
    }

    if (overlayWindow) {
        if (isRecording) {
            overlayWindow.showInactive();
            log("Overlay window shown");
        } else {
            overlayWindow.hide();
            log("Overlay window hidden");
        }
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
    log("Starting recording...");

    if (audioRecorder.startRecording()) {
        overlayWindow.webContents.send("update-status", "recording");
        overlayWindow.showInactive();
        tray.setImage(getIconPath(true));

        isOverlayVisible = true;
        const updateInterval = setInterval(updateOverlayPosition, 16);

        log("Recording started successfully");
    } else {
        log("Failed to start recording", true);
        isRecording = false;
        overlayWindow.webContents.send("update-status", "error");
    }
}

async function stopRecording() { 
    isRecording = false;
    log("Stopping recording...");

    const result = audioRecorder.stopRecording();
    if (result && result.buffer) {
        log(`Recording stopped. Received ${result.buffer.length} bytes of audio data.`);
        tray.setImage(getIconPath());

        try {
            const transcription = await performTranscription(result.buffer);
            if (transcription) {
                clipboard.writeText(transcription);
                log("Transcription copied to clipboard");
                if (checkAccessibilityPermission()) {
                    pasteText(transcription);
                    log("Transcription pasted");
                    overlayWindow.webContents.send("update-status", "done");
                }
            }
        } catch (error) {
            log(`Error during transcription: ${error.message}`, true);
            overlayWindow.webContents.send("update-status", "error");
        }
    } else {
        log("Failed to get audio data", true);
        overlayWindow.webContents.send("update-status", "error");
    }

    setTimeout(() => {
        overlayWindow.hide();
        isOverlayVisible = false;
        log("Overlay hidden");
    }, 700);
}

async function performTranscription(audioBuffer) {
    if (!groq) {
        throw new Error("Groq client not initialized");
    }

    const audioFilePath = path.join(app.getPath("temp"), "recorded_audio.wav");
    fs.writeFileSync(audioFilePath, audioBuffer);

    try {
        log("Starting transcription");
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: "distil-whisper-large-v3-en",
            response_format: "json",
            language: "en",
            temperature: 0.0,
        });

        fs.unlinkSync(audioFilePath);
        log("Transcription completed successfully");
        return transcription.text;
    } catch (error) {
        log(`Error in Groq API call: ${error.message}`, true);
        throw error;
    }
}

function checkAccessibilityPermission() {
    // This function might need to be implemented differently for macOS
    // as it depends on the specific requirements of your paste add-on
    return true;
}

ipcMain.handle("get-recording-status", () => isRecording);
ipcMain.handle("get-settings", async () => {
    if (!store) await initializeStore();
    return {
        apiKey: process.env.GROQ_API_KEY || store.get("apiKey", ""),
        hotkey: store.get("hotkey", "Control+Shift+Space"),
    };
});
ipcMain.handle("save-settings", async (event, settings) => {
    if (!store) await initializeStore();
    store.set("apiKey", settings.apiKey);
    store.set("hotkey", settings.hotkey);
    await setupGlobalHotkey();
    await setupGroqClient();
    log("Settings saved");
});

ipcMain.handle("initialize-app", () => {
    setupGlobalHotkey();
    setupGroqClient();
    log("App initialized");
});

ipcMain.handle("close-settings", () => {
    if (settingsWindow) {
        settingsWindow.hide();
    }
    log("Settings window closed");
});

ipcMain.handle("toggle-overlay", () => {
    isOverlayVisible = !isOverlayVisible;
    if (isOverlayVisible) {
        overlayWindow.show();
        updateOverlayPosition();
        log("Overlay shown");
    } else {
        overlayWindow.hide();
        log("Overlay hidden");
    }
    return isOverlayVisible;
});

ipcMain.handle("get-overlay-visibility", () => isOverlayVisible);
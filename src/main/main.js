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

 
// Import the macOS audio recording addon
// const audioRecorder = require("../../macos-audio-addon");
const audioAddon = require("../addons/macos_audio_addon.node");
const audioRecorder = {
    startRecording: audioAddon.startRecording,
    stopRecording: audioAddon.stopRecording,
};

// Import the macOS paste addon
// const { pasteText } = require("../../macos-paste-addon");
const addon = require("../addons/macos_paste_addon.node");
const pasteText = addon.pasteText;

// Setup logging
const logDir = path.join(os.homedir(), ".whisperanywhere");
const activityLogPath = path.join(logDir, "activity.log");
const errorLogPath = path.join(logDir, "error.log");

function setupLogging() {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
    }
    if (!fs.existsSync(activityLogPath)) {
        fs.writeFileSync(activityLogPath, "");
    }
    if (!fs.existsSync(errorLogPath)) {
        fs.writeFileSync(errorLogPath, "");
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
    const Store = await import("electron-store");
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
        icon: path.join(__dirname, '../assets/icon.png'),
        width: 400,
        height: 300,
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

app.on("before-quit", () => {
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
                app.exit(0);
                app.quit();
            },
        },
    ]);
    tray.setToolTip("WhisperAnywhere");
    tray.setContextMenu(contextMenu);
    log("Tray created");
}

async function initializeStore() {
    const Store = await import("electron-store");
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
    // WARNING: Only use this during development and remove before production!
    log(`Full API Key for debugging: ${apiKey}`);
    log(`API Key found: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);

    groq = new Groq({ apiKey });

    // Test the Groq client
    try {
        await groq.chat.completions.create({
            messages: [{ role: "user", content: "Hello" }],
            model: "mixtral-8x7b-32768",
        });
        log("Groq client initialized and tested successfully");
    } catch (error) {
        log(`Error testing Groq client: ${error.message}`, true);
    }
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

function checkAccessibilityPermission() {
    return systemPreferences.isTrustedAccessibilityClient(false);
}

async function stopRecording() {
    isRecording = false;
    log("Stopping recording...");

    const result = audioRecorder.stopRecording();
    if (result && result.buffer) {
        log(`Recording stopped. Received ${result.buffer.length} bytes of audio data.`);
        tray.setImage(getIconPath());

        try {
            overlayWindow.webContents.send("update-status", "processing");
            const transcription = await performTranscription(result.buffer);
            if (transcription) {
                clipboard.writeText(transcription);
                log("Transcription copied to clipboard");
                if (checkAccessibilityPermission()) {
                    if (checkAccessibilityPermission()) {
                        pasteText(transcription);
                    } else {
                        dialog.showMessageBox({
                            type: "info",
                            message: "Accessibility Permission Required",
                            detail: "Please grant accessibility permission to the app in System Preferences > Security & Privacy > Privacy > Accessibility.",
                        });
                    }
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
        log("Groq client not initialized", true);
        throw new Error("Groq client not initialized");
    }

    if (!audioBuffer || audioBuffer.length === 0) {
        log("Audio buffer is empty or undefined", true);
        throw new Error("Invalid audio buffer");
    }

    const audioFilePath = path.join(app.getPath("temp"), `recorded_audio_${Date.now()}.wav`);
    log(`Saving audio file to: ${audioFilePath}`);

    try {
        fs.writeFileSync(audioFilePath, audioBuffer);
        const stats = fs.statSync(audioFilePath);
        log(`Audio file saved. Size: ${stats.size} bytes`);

        if (stats.size === 0) {
            log("Saved audio file is empty", true);
            throw new Error("Empty audio file");
        }

        const apiKey = process.env.GROQ_API_KEY || store.get("apiKey", "");
        if (!apiKey) {
            log("API key is missing", true);
            throw new Error("API key not found");
        }
        log(`Using API key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

        log("Preparing transcription request");
        const requestOptions = {
            file: fs.createReadStream(audioFilePath),
            model: "distil-whisper-large-v3-en",
            response_format: "json",
            language: "en",
            temperature: 0.0,
        };
        log(
            `Request options: ${JSON.stringify(requestOptions, (key, value) =>
                key === "file" ? "[ReadStream]" : value
            )}`
        );

        log("Starting transcription API call");
        const transcription = await groq.audio.transcriptions.create(requestOptions);

        fs.unlinkSync(audioFilePath);
        log(`Transcription completed successfully. Text length: ${transcription.text.length}`);
        return transcription.text;
    } catch (error) {
        log(`Error in Groq API call: ${error.message}`, true);
        log(`Error stack: ${error.stack}`, true);

        if (error.response) {
            log(`API Response Status: ${error.response.status}`, true);
            log(`API Response Data: ${JSON.stringify(error.response.data)}`, true);
        }

        if (fs.existsSync(audioFilePath)) {
            log(`Audio file still exists at: ${audioFilePath}`, true);
        } else {
            log("Audio file was deleted or not created", true);
        }

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

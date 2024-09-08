const {
    app,
    BrowserWindow,
    systemPreferences,
    dialog,
    ipcMain,
    globalShortcut,
    clipboard,
    screen,
    Tray,
    Menu,
    shell,
} = require("electron");
const { spawn } = require('child_process');
const path = require("path");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const Mic = require("node-microphone");
const Groq = require("groq-sdk");
const fs = require("fs");
const os = require("os");
require("dotenv").config();

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

    if (process.platform === "win32") {
        return path.join(__dirname, `../../assets/${iconName}.ico`);
    } else if (process.platform === "darwin") {
        return path.join(__dirname, `../../assets/${iconName}-16.png`);
    } else {
        return path.join(__dirname, `../../assets/${iconName}-16.png`);
    }
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
            label: "Open Dev Tools",
            click: () => {
                if (settingsWindow) {
                    settingsWindow.webContents.openDevTools();
                }
                if (overlayWindow) {
                    overlayWindow.webContents.openDevTools();
                }
                log("Dev tools opened from tray");
            },
        },
        {
            label: "Quit",
            click: () => {
                log("Quit selected from tray");
                BrowserWindow.getAllWindows().forEach(window => window.close());
                app.quit();
                app.exit(0);
            },
        },
    ]);
    tray.setToolTip("VoiceClipboard");
    tray.setContextMenu(contextMenu);
    log("Tray created");
}

app.whenReady().then(async () => {
    setupLogging();
    log("Application starting");

    await checkAudioCommands();

    const recAvailable = await checkRecCommand();
    if (!recAvailable) {
        log("WARNING: 'rec' command is not available. SOX might not be installed correctly.", true);
    }
    
    if (process.platform === "darwin") {
        const status = await systemPreferences.getMediaAccessStatus("microphone");
        if (status !== "granted") {
            const result = await systemPreferences.askForMediaAccess("microphone");
            if (!result) {
                log("Microphone access denied", true);
                dialog.showErrorBox("Permission Denied", "Microphone access is required for this app to function.");
            } else {
                log("Microphone access granted");
            }
        }
    }

    await import("electron-store");
    createSettingsWindow();
    createOverlayWindow();
    createTray();
    setupGlobalHotkey();
    setupGroqClient();
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

function setupGlobalHotkey() {
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

function setupGroqClient() {
    const apiKey = process.env.GROQ_API_KEY || store.get("apiKey");
    if (!apiKey) {
        log("Groq API key not found", true);
        return;
    }
    log(`API Key found: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`); // Log a part of the API key for verification
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
    audioBuffer = [];

    log("Attempting to start recording...");

    // Check if microphone access is granted
    if (process.platform === "darwin") {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        log(`Microphone access status: ${micStatus}`);
        if (micStatus !== 'granted') {
            log("Microphone access not granted. Requesting access...", true);
            systemPreferences.askForMediaAccess('microphone')
                .then(granted => {
                    if (granted) {
                        log("Microphone access granted. Proceeding with recording.");
                        proceedWithRecording();
                    } else {
                        log("Microphone access denied by user.", true);
                        stopRecording('error');
                    }
                })
                .catch(error => {
                    log(`Error requesting microphone access: ${error.message}`, true);
                    stopRecording('error');
                });
        } else {
            proceedWithRecording();
        }
    } else {
        proceedWithRecording();
    }
}

function proceedWithRecording() {
    try {
        log("Initializing Mic instance...");
        // Modify the Mic constructor to use the full path to 'rec' if needed
        // You might need to adjust this path based on the 'which rec' output
        micInstance = new Mic({ recordProgram: '/usr/local/bin/rec' });
        log("Mic instance created successfully");

        log("Starting recording stream...");
        const micStream = micInstance.startRecording();
        log("Recording stream started successfully");

        overlayWindow.webContents.send("update-status", "recording");
        overlayWindow.showInactive();
        tray.setImage(getIconPath(true));

        isOverlayVisible = true;
        const updateInterval = setInterval(updateOverlayPosition, 16);

        micStream.on("data", (data) => {
            audioBuffer.push(data);
        });

        micStream.on("error", (error) => {
            log(`Error in mic stream: ${error.message}`, true);
            log(`Mic stream error stack: ${error.stack}`, true);
            stopRecording('error');
        });

        micInstance.on("error", (error) => {
            log(`Error during recording: ${error.message}`, true);
            log(`Recording error stack: ${error.stack}`, true);
            stopRecording('error');
        });

        micInstance.on("end", () => {
            clearInterval(updateInterval);
            log("Recording ended normally");
        });
        
        log("Recording started successfully");
    } catch (error) {
        log(`Exception in proceedWithRecording: ${error.message}`, true);
        log(`Exception stack: ${error.stack}`, true);
        stopRecording('error');
    }
}

// Add this function to check if 'rec' command is available
function checkRecCommand() {
    return new Promise((resolve, reject) => {
        const child = spawn('which', ['rec']);
        child.on('exit', (code) => {
            if (code === 0) {
                log("'rec' command is available");
                resolve(true);
            } else {
                log("'rec' command is not available", true);
                resolve(false);
            }
        });
    });
}

async function checkAudioCommands() {
    log(`Current PATH: ${process.env.PATH}`);

    try {
        const { stdout: soxPath } = await exec('which sox');
        log(`sox path: ${soxPath.trim()}`);
    } catch (error) {
        log('sox not found in PATH', true);
    }

    try {
        const { stdout: recPath } = await exec('which rec');
        log(`rec path: ${recPath.trim()}`);
    } catch (error) {
        log('rec not found in PATH', true);
    }

    try {
        const { stdout: soxVersion } = await exec('sox --version');
        log(`sox version: ${soxVersion.trim()}`);
    } catch (error) {
        log(`Error getting sox version: ${error.message}`, true);
    }
}

async function stopRecording(status = 'success') {
    isRecording = false;
    if (micInstance) {
        micInstance.stopRecording();
    }
    
    log(`Stopping recording with status: ${status}`);
    overlayWindow.webContents.send("update-status", status);
    tray.setImage(getIconPath());

    if (status === 'success') {
        try {
            const transcription = await performTranscription();
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
            status = 'error';
            overlayWindow.webContents.send("update-status", "error");
        }
    }

    setTimeout(() => {
        overlayWindow.hide();
        isOverlayVisible = false;
        log("Overlay hidden");
    }, status === 'error' ? 2000 : 700);
}


async function performTranscription() {
    if (!groq) {
        throw new Error("Groq client not initialized");
    }

    const audioFilePath = path.join(app.getPath("temp"), "recorded_audio.wav");
    fs.writeFileSync(audioFilePath, Buffer.concat(audioBuffer));

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
    if (process.platform === "darwin") {
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
            log("Accessibility permission not granted", true);
            dialog.showMessageBox({
                type: "info",
                title: "Accessibility Permission Required",
                message: "This app requires accessibility permission to paste text.",
                detail: "Please go to System Preferences > Security & Privacy > Privacy > Accessibility and add this app to the list.",
                buttons: ["OK"],
            });
            return false;
        }
    }
    log("Accessibility permission granted");
    return true;
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
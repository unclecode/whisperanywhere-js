// src/main/main.js
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, screen } = require("electron");
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

let mainWindow;
let overlayWindow;
let isRecording = false;
let groq;
let micInstance;
let audioBuffer = [];
let keyboardListener;
let isOverlayVisible = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    const htmlPath = path.join(__dirname, "../renderer/index.html");
    console.log("Loading HTML from:", htmlPath);
    mainWindow.loadFile(htmlPath);

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
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
    overlayWindow.setBackgroundColor("#00ffffff"); // Fully transparent
    overlayWindow.hide();
    overlayWindow.setBackgroundColor("#00ffffff"); // Fully transparent

    setTimeout(() => {
        overlayWindow.setBackgroundColor("#00ffffff"); // Fully transparent
    }, 100); // Wait for 1 second before setting transparent again

    // Open DevTools for the overlay window
    // if (process.env.NODE_ENV === 'development') {
    // overlayWindow.webContents.openDevTools({ mode: "detach" });
    // }
}

app.whenReady().then(async () => {
    await import("electron-store"); // Ensure electron-store is loaded before we use it
    createWindow();
    createOverlayWindow();
    setupGlobalHotkey();
    setupGroqClient();

    app.on("activate", function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Unregister shortcuts when app is about to quit
app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

function setupGlobalHotkey() {
    // Unregister any existing shortcuts
    globalShortcut.unregisterAll();

    // Get the hotkey from store or use default
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
        mainWindow.webContents.send("error", "Groq API key not found. Please set it in the settings.");
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

// Modify the existing updateOverlayPosition function
function updateOverlayPosition() {
    if (isOverlayVisible) {
        const mousePosition = screen.getCursorScreenPoint();
        overlayWindow.setPosition(mousePosition.x + 10, mousePosition.y + 10);
        // overlayWindow.setPosition(100, 100);
    }
}
// Set up an interval to continuously update the overlay position when visible
// setInterval(updateOverlayPosition, 16); // ~60fps

function startRecording() {
    isRecording = true;
    audioBuffer = [];
    micInstance = new Mic();
    const micStream = micInstance.startRecording();
    mainWindow.webContents.send("recording-status", true);
    overlayWindow.webContents.send("update-status", "recording");
    overlayWindow.show();

    isOverlayVisible = true;
    const updateInterval = setInterval(updateOverlayPosition, 16); // ~60fps

    micStream.on("data", (data) => {
        audioBuffer.push(data);
    });

    micInstance.on("error", (error) => {
        console.error("Error during recording:", error);
        mainWindow.webContents.send("error", "Error during recording");
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
    mainWindow.webContents.send("recording-status", false);
    overlayWindow.webContents.send("update-status", "processing");

    try {
        const transcription = await performTranscription();
        if (transcription) {
            clipboard.writeText(transcription);
            mainWindow.webContents.send("transcription-result", transcription);
            overlayWindow.webContents.send("update-status", "done");
            setTimeout(() => overlayWindow.hide(), 700); // Hide after 2 seconds
        }
    } catch (error) {
        console.error("Error during transcription:", error);
        mainWindow.webContents.send("error", "Error during transcription");
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

// IPC handlers
ipcMain.handle("get-recording-status", () => isRecording);
ipcMain.handle("get-settings", () => ({
    apiKey: store.get("apiKey", ""),
    hotkey: store.get("hotkey", "Control+Shift+Space"),
}));
ipcMain.handle("save-settings", (event, settings) => {
    store.set("apiKey", settings.apiKey);
    store.set("hotkey", settings.hotkey);
    setupGlobalHotkey();
    setupGroqClient();
});

// Add this new IPC handler
ipcMain.handle("initialize-app", () => {
    setupGlobalHotkey();
    setupGroqClient();
});

// Add these new IPC handlers
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

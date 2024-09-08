// src/renderer/Settings.js
import React, { useState, useEffect } from "react";

const Settings = ({ onClose }) => {
    const [apiKey, setApiKey] = useState("");
    const [hotkey, setHotkey] = useState("");
    const [isOverlayVisible, setIsOverlayVisible] = useState(false);

    useEffect(() => {
        // Load settings when component mounts
        window.electron.getSettings().then((settings) => {
            setApiKey(settings.apiKey || "");
            setHotkey(settings.hotkey || "");
        });
        
        // Get initial overlay visibility state
        window.electron.getOverlayVisibility().then(setIsOverlayVisible);
    }, []);

    const handleSave = () => {
        window.electron.saveSettings({ apiKey, hotkey });
        onClose();
    };

    const toggleOverlay = () => {
        window.electron.toggleOverlay().then(setIsOverlayVisible);
    };

    return (
        <div>
            <h2>Settings12</h2>
            <div>
                <label>
                    Groq API Key:
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </label>
            </div>
            <div>
                <label>
                    Hotkey:
                    <input
                        type="text"
                        value={hotkey}
                        onChange={(e) => setHotkey(e.target.value)}
                        placeholder="e.g., CommandOrControl+Shift+K"
                    />
                    <p>Use CommandOrControl for Cmd on Mac or Ctrl on Windows/Linux</p>
                </label>
            </div>
            <div>
                <button onClick={toggleOverlay}>
                    {isOverlayVisible ? "Hide Debug Overlay" : "Show Debug Overlay"}
                </button>
            </div>
            <button onClick={handleSave}>Save</button>
            <button onClick={onClose}>Cancel</button>
        </div>
    );
};

export default Settings;
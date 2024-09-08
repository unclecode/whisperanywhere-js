// src/renderer/App.js
import React, { useState, useEffect } from "react";
import Settings from './Settings';

const App = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcription, setTranscription] = useState("");
    const [error, setError] = useState("");
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        window.electron.onRecordingStatus((status) => {
            setIsRecording(status);
        });

        window.electron.onTranscriptionResult((result) => {
            setTranscription(result);
            setError("");
        });

        window.electron.onError((errorMessage) => {
            setError(errorMessage);
        });

        window.electron.getRecordingStatus().then(setIsRecording);

        window.electron.initializeApp().catch((err) => {
            setError("Failed to initialize the app. Please check your settings.");
        });
    }, []);

    const handleSettingsClose = () => {
        setShowSettings(false);
        window.electron.initializeApp().catch((err) => {
            setError("Failed to initialize the app. Please check your settings.");
        });
    };

    return (
        <div>
            <h1>VoiceClipboard</h1>
            <button onClick={() => setShowSettings(true)}>Settings</button>
            <p>Status: {isRecording ? "Recording" : "Not Recording"}</p>
            <p>Press the configured hotkey to start/stop recording</p>
            {error && (
                <div style={{ color: "red" }}>
                    <p>Error: {error}</p>
                </div>
            )}
            {transcription && (
                <div>
                    <h2>Last Transcription:</h2>
                    <p>{transcription}</p>
                </div>
            )}
            {showSettings && <Settings onClose={handleSettingsClose} />}
        </div>
    );
};

export default App;
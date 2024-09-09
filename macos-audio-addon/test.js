const audioRecorder = require("./");
const fs = require("fs");
const { spawn } = require("child_process");

console.log("Starting recording...");
if (audioRecorder.startRecording()) {
    console.log("Recording started successfully.");

    setTimeout(() => {
        console.log("Stopping recording...");
        try {
            const result = audioRecorder.stopRecording();

            if (result && result.buffer) {
                console.log("Recording stopped. Buffer size:", result.buffer.length);
                console.log("Sample rate:", result.sampleRate);
                console.log("Channels:", result.channels);
                console.log("Bit depth:", result.bitDepth);
                console.log("Is Float:", result.isFloat);
                console.log("Is Interleaved:", result.isInterleaved);
                console.log("Format Flags:", result.formatFlags);
                console.log("Format ID:", result.formatID);

                // Save raw PCM data
                fs.writeFileSync("recorded_audio.raw", result.buffer);
                console.log("Raw audio data saved to recorded_audio.raw");

                // Construct FFmpeg command
                let ffmpegArgs = [
                    "-f",
                    "f32le", // Assuming 32-bit float PCM
                    "-ar",
                    result.sampleRate.toString(),
                    "-ac",
                    result.channels.toString(),
                    "-i",
                    "recorded_audio.raw",
                    "-acodec",
                    "pcm_s16le", // Convert to 16-bit PCM
                    "recorded_audio.wav",
                ];

                // Convert raw audio to WAV using FFmpeg
                const ffmpeg = spawn("ffmpeg", ffmpegArgs);

                ffmpeg.stderr.on("data", (data) => {
                    console.error(`FFmpeg stderr: ${data}`);
                });

                ffmpeg.on("close", (code) => {
                    console.log(`FFmpeg process exited with code ${code}`);
                    if (code === 0) {
                        console.log("Audio converted and saved to recorded_audio.wav");

                        // Play the converted audio
                        const play = spawn("ffplay", ["-nodisp", "-autoexit", "recorded_audio.wav"]);

                        play.stderr.on("data", (data) => {
                            console.error(`FFplay stderr: ${data}`);
                        });

                        play.on("close", (code) => {
                            console.log(`FFplay process exited with code ${code}`);
                        });
                    }
                });
            } else {
                console.log("Failed to get recording buffer");
            }
        } catch (error) {
            console.error("Error stopping recording:", error.message);
        }
    }, 3000); // Record for 10 seconds
} else {
    console.log("Failed to start recording.");
}

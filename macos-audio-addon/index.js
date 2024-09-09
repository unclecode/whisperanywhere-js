const audioAddon = require('./build/Release/macos_audio_addon.node');

module.exports = {
  startRecording: audioAddon.startRecording,
  stopRecording: audioAddon.stopRecording
};
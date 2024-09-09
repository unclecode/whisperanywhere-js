const fs = require('fs');
const path = require('path');
const audioAddon = require('.');

console.log('Starting audio recording test...');

if (audioAddon.startRecording()) {
  console.log('Recording started. Recording for 5 seconds...');
  
  // Record for 5 seconds
  setTimeout(() => {
    console.log('Stopping recording...');
    const result = audioAddon.stopRecording();
    if (result && result.buffer) {
      console.log(`Recording stopped. Received ${result.buffer.length} bytes of audio data.`);
      console.log(`Audio format: ${result.sampleRate} Hz, ${result.channels} channel(s), ${result.bitDepth}-bit, ${result.format} format`);
      
      // Save the buffer as a WAV file
      const filename = `recording_${Date.now()}.wav`;
      const filepath = path.join(__dirname, filename);
      
      console.log(`Saving WAV file to: ${filepath}`);
      fs.writeFile(filepath, result.buffer, (err) => {
        if (err) {
          console.error('Error saving the WAV file:', err);
        } else {
          console.log(`WAV file saved successfully: ${filepath}`);
          console.log('You can now play this file to check the audio quality.');
          
          // Read the file back and check its contents
          fs.readFile(filepath, (err, data) => {
            if (err) {
              console.error('Error reading back the WAV file:', err);
            } else {
              console.log(`Read back ${data.length} bytes from the saved file.`);
              console.log('First 44 bytes (WAV header):');
              console.log(data.slice(0, 44).toString('hex'));
              
              if (data.length !== result.buffer.length) {
                console.error('Warning: Saved file size does not match original buffer size.');
              }
              
              if (data.slice(0, 4).toString() !== 'RIFF') {
                console.error('Error: RIFF header not found in saved file.');
              }
              
              if (data.slice(8, 12).toString() !== 'WAVE') {
                console.error('Error: WAVE format not found in saved file.');
              }
            }
          });
        }
      });
    } else {
      console.log('Failed to get audio data');
    }
  }, 3000); // 5000 ms = 5 seconds
} else {
  console.log('Failed to start recording');
}
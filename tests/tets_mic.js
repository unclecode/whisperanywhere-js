const { spawn } = require('child_process');
const rec = spawn('/opt/homebrew/bin/rec', ['-h']);
rec.stdout.on('data', (data) => {
  console.log(`rec stdout: ${data}`);
});
rec.stderr.on('data', (data) => {
    console.log(`rec stderr: ${data}`);
});
rec.on('close', (code) => {
    console.log(`rec process exited with code ${code}`);
});
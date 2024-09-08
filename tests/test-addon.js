const addon = require('../macos-paste-addon/build/Release/macos_paste_addon.node');

console.log("Attempting to paste text in 5 seconds...");
setTimeout(() => {
  try {
    addon.pasteText("This is a test of the updated macOS paste addon.");
    console.log("Paste command sent. Check your active application.");
  } catch (error) {
    console.error("Error occurred:", error);
  }
}, 5000);
const addon = require('./build/Release/macos_paste_addon.node');

module.exports = {
  pasteText: addon.pasteText
};
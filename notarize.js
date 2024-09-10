const { notarize } = require('electron-notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  console.login('electronPlatformName', electronPlatformName);
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName} in ${appOutDir}`);
  
  return await notarize({
    appBundleId: 'com.unclecode.whisperanywhere',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
  });
};

// run the function


const { app, BrowserWindow, session, ipcMain, Menu, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');

// Lazy-load auto-updater to avoid initialization issues at startup
let autoUpdater = null;
function getAutoUpdater() {
  if (!autoUpdater) {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    setupAutoUpdaterEvents();
  }
  return autoUpdater;
}

// Disable sandbox to fix font rendering on macOS
// (Electron sandbox blocks access to system fonts)
app.commandLine.appendSwitch('no-sandbox');

// Set app name (for display purposes)
app.setName('Chromattica [beta]');

// Keep user data in original "Chromattica" folder regardless of display name
const originalUserDataPath = path.join(app.getPath('appData'), 'Chromattica');
app.setPath('userData', originalUserDataPath);

// Store for profiles, tabs, and extensions
const profilesPath = path.join(app.getPath('userData'), 'profiles.json');
const tabsPath = path.join(app.getPath('userData'), 'tabs.json');
const extensionsBasePath = path.join(app.getPath('userData'), 'extensions');

// Track loaded extensions per profile session
const loadedExtensions = {}; // { profileId: [{ id, name, icon, path }] }

// Track sessions that have had permission handlers set up
const configuredSessions = new Set();

// Set a realistic User-Agent for all sessions
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Set up media permission handlers for a session (camera, microphone, etc.)
function setupSessionPermissions(ses) {
  // Set the User-Agent for the session
  ses.setUserAgent(userAgent);

  // Only configure each session once
  const sessionId = ses.storagePath || 'default';
  if (configuredSessions.has(sessionId)) return;
  configuredSessions.add(sessionId);

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow camera, microphone, and media permissions
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications'];
    callback(allowedPermissions.includes(permission));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications'];
    return allowedPermissions.includes(permission);
  });
}

// Ensure extensions directory exists
if (!fs.existsSync(extensionsBasePath)) {
  fs.mkdirSync(extensionsBasePath, { recursive: true });
}

function loadProfiles() {
  try {
    if (fs.existsSync(profilesPath)) {
      return JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load profiles:', e);
  }
  return [];
}

function saveProfiles(profiles) {
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
}

function loadTabs() {
  try {
    if (fs.existsSync(tabsPath)) {
      return JSON.parse(fs.readFileSync(tabsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load tabs:', e);
  }
  return { tabsByProfile: {}, activeTabByProfile: {}, selectedProfileId: null };
}

function saveTabs(tabState) {
  fs.writeFileSync(tabsPath, JSON.stringify(tabState, null, 2));
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    icon: path.join(__dirname, 'icons', 'chromattica_c_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true  // Enable <webview> tag for embedded browsing
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// IPC handlers for profile management
ipcMain.handle('get-profiles', () => {
  return loadProfiles();
});

ipcMain.handle('save-profiles', (event, profiles) => {
  saveProfiles(profiles);
  return true;
});

ipcMain.handle('get-session-partition', (event, profileId) => {
  // Each profile gets a persistent partition for isolated cookies/storage
  const partitionName = `persist:profile-${profileId}`;
  // Set up media permissions for this profile's session
  const ses = session.fromPartition(partitionName);
  setupSessionPermissions(ses);
  return partitionName;
});

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('get-tabs', () => {
  return loadTabs();
});

ipcMain.handle('save-tabs', (event, tabState) => {
  saveTabs(tabState);
  return true;
});

// Extension management IPC handlers

// Get extensions directory for a profile
function getProfileExtensionsPath(profileId) {
  const profileExtPath = path.join(extensionsBasePath, profileId);
  if (!fs.existsSync(profileExtPath)) {
    fs.mkdirSync(profileExtPath, { recursive: true });
  }
  return profileExtPath;
}

// Load extension metadata from manifest.json
function getExtensionMetadata(extPath) {
  try {
    const manifestPath = path.join(extPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      // Find icon - try various sizes
      let iconPath = null;
      if (manifest.icons) {
        const sizes = ['48', '32', '128', '16'];
        for (const size of sizes) {
          if (manifest.icons[size]) {
            iconPath = path.join(extPath, manifest.icons[size]);
            break;
          }
        }
      }

      // Get popup URL (MV3 uses 'action', MV2 uses 'browser_action')
      const popupFile = manifest.action?.default_popup || manifest.browser_action?.default_popup;

      return {
        name: manifest.name || 'Unknown Extension',
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        iconPath: iconPath,
        hasPopup: !!popupFile,
        popupFile: popupFile || null
      };
    }
  } catch (e) {
    console.error('Failed to read extension manifest:', e);
  }
  return null;
}

// Load all extensions for a profile into its session
async function loadExtensionsForProfile(profileId) {
  const profileExtPath = getProfileExtensionsPath(profileId);
  const ses = session.fromPartition(`persist:profile-${profileId}`);

  loadedExtensions[profileId] = [];

  try {
    const extDirs = fs.readdirSync(profileExtPath);
    for (const dir of extDirs) {
      const extPath = path.join(profileExtPath, dir);
      if (fs.statSync(extPath).isDirectory()) {
        try {
          const ext = await ses.loadExtension(extPath);
          const metadata = getExtensionMetadata(extPath);
          loadedExtensions[profileId].push({
            id: ext.id,
            name: metadata?.name || ext.name,
            path: extPath,
            iconPath: metadata?.iconPath,
            hasPopup: metadata?.hasPopup || false,
            popupFile: metadata?.popupFile || null
          });
          console.log(`Loaded extension ${ext.name} for profile ${profileId}`);
        } catch (e) {
          console.error(`Failed to load extension from ${extPath}:`, e);
        }
      }
    }
  } catch (e) {
    console.error(`Failed to read extensions directory for profile ${profileId}:`, e);
  }

  return loadedExtensions[profileId];
}

// Get loaded extensions for a profile
ipcMain.handle('get-extensions', async (event, profileId) => {
  if (!loadedExtensions[profileId]) {
    await loadExtensionsForProfile(profileId);
  }
  return loadedExtensions[profileId] || [];
});

// Install extension from a folder (unpacked extension)
ipcMain.handle('install-extension', async (event, profileId, sourcePath) => {
  const profileExtPath = getProfileExtensionsPath(profileId);
  const ses = session.fromPartition(`persist:profile-${profileId}`);

  try {
    // Copy extension to profile's extensions directory
    const extName = path.basename(sourcePath);
    const destPath = path.join(profileExtPath, extName);

    // Copy directory recursively
    fs.cpSync(sourcePath, destPath, { recursive: true });

    // Load the extension
    const ext = await ses.loadExtension(destPath);
    const metadata = getExtensionMetadata(destPath);

    const extInfo = {
      id: ext.id,
      name: metadata?.name || ext.name,
      path: destPath,
      iconPath: metadata?.iconPath,
      hasPopup: metadata?.hasPopup || false,
      popupFile: metadata?.popupFile || null
    };

    if (!loadedExtensions[profileId]) {
      loadedExtensions[profileId] = [];
    }
    loadedExtensions[profileId].push(extInfo);

    console.log(`Installed extension ${ext.name} for profile ${profileId}`);
    return { success: true, extension: extInfo };
  } catch (e) {
    console.error('Failed to install extension:', e);
    return { success: false, error: e.message };
  }
});

// Remove extension
ipcMain.handle('remove-extension', async (event, profileId, extensionId) => {
  const ses = session.fromPartition(`persist:profile-${profileId}`);

  try {
    // Find extension info
    const extInfo = loadedExtensions[profileId]?.find(e => e.id === extensionId);
    if (extInfo) {
      // Remove from session
      await ses.removeExtension(extensionId);

      // Delete files
      if (fs.existsSync(extInfo.path)) {
        fs.rmSync(extInfo.path, { recursive: true });
      }

      // Remove from tracking
      loadedExtensions[profileId] = loadedExtensions[profileId].filter(e => e.id !== extensionId);

      console.log(`Removed extension ${extensionId} from profile ${profileId}`);
      return { success: true };
    }
    return { success: false, error: 'Extension not found' };
  } catch (e) {
    console.error('Failed to remove extension:', e);
    return { success: false, error: e.message };
  }
});

// Open file dialog to select extension folder
ipcMain.handle('select-extension-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Unpacked Extension Folder',
    message: 'Select a folder containing an unpacked Chrome extension (must have manifest.json)'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    // Verify it has a manifest.json
    const manifestPath = path.join(selectedPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      return { success: true, path: selectedPath };
    } else {
      return { success: false, error: 'Selected folder does not contain manifest.json' };
    }
  }
  return { success: false, error: 'No folder selected' };
});

// Download CRX from Chrome Web Store
async function downloadCrx(extensionId) {
  const chromeVersion = '131.0.0.0'; // Keep this updated for extension compatibility
  // Full URL format with OS/arch parameters for better compatibility
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&os=mac&arch=x86-64&os_arch=x86-64&nacl_arch=x86-64&prod=chromecrx&prodchannel=stable&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc`;

  const tempDir = path.join(app.getPath('temp'), 'chromattica-extensions');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const crxPath = path.join(tempDir, `${extensionId}.crx`);

  console.log(`Downloading CRX from: ${url}`);

  return new Promise((resolve, reject) => {
    const request = net.request(url);

    request.on('response', (response) => {
      console.log(`Initial response: ${response.statusCode}`);

      if (response.statusCode === 200) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          console.log(`Downloaded ${buffer.length} bytes`);
          fs.writeFileSync(crxPath, buffer);
          resolve(crxPath);
        });
        response.on('error', reject);
      } else if (response.statusCode >= 300 && response.statusCode < 400) {
        // Handle redirect
        const redirectUrl = response.headers.location;
        console.log(`Redirecting to: ${redirectUrl}`);
        if (redirectUrl) {
          const redirectRequest = net.request(redirectUrl);
          redirectRequest.on('response', (redirectResponse) => {
            console.log(`Redirect response: ${redirectResponse.statusCode}`);
            if (redirectResponse.statusCode === 200) {
              const chunks = [];
              redirectResponse.on('data', (chunk) => chunks.push(chunk));
              redirectResponse.on('end', () => {
                const buffer = Buffer.concat(chunks);
                console.log(`Downloaded ${buffer.length} bytes after redirect`);
                fs.writeFileSync(crxPath, buffer);
                resolve(crxPath);
              });
              redirectResponse.on('error', reject);
            } else {
              reject(new Error(`Failed to download CRX after redirect: ${redirectResponse.statusCode}`));
            }
          });
          redirectRequest.on('error', reject);
          redirectRequest.end();
        } else {
          reject(new Error('Redirect without location header'));
        }
      } else {
        // Log response body for error diagnosis
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          console.log(`Error response body: ${body.substring(0, 500)}`);
          reject(new Error(`Failed to download CRX: ${response.statusCode}`));
        });
      }
    });

    request.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });
    request.end();
  });
}

// Unpack CRX file to a directory
function unpackCrx(crxPath, destDir) {
  const buffer = fs.readFileSync(crxPath);

  // CRX3 format:
  // - Magic number: "Cr24" (4 bytes)
  // - Version: 3 (4 bytes, little-endian)
  // - Header length (4 bytes, little-endian)
  // - Header (protobuf)
  // - ZIP content

  const magic = buffer.slice(0, 4).toString();
  if (magic !== 'Cr24') {
    throw new Error('Invalid CRX file: bad magic number');
  }

  const version = buffer.readUInt32LE(4);
  if (version !== 3 && version !== 2) {
    throw new Error(`Unsupported CRX version: ${version}`);
  }

  let zipStart;
  if (version === 3) {
    const headerLength = buffer.readUInt32LE(8);
    zipStart = 12 + headerLength;
  } else {
    // CRX2 format
    const pubKeyLength = buffer.readUInt32LE(8);
    const sigLength = buffer.readUInt32LE(12);
    zipStart = 16 + pubKeyLength + sigLength;
  }

  const zipBuffer = buffer.slice(zipStart);

  // Extract ZIP
  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(destDir, true);

  return destDir;
}

// Install extension from Chrome Web Store URL or extension ID
ipcMain.handle('install-extension-from-webstore', async (event, profileId, extensionIdOrUrl) => {
  // Extract extension ID from URL if needed
  let extensionId = extensionIdOrUrl;

  // Handle various URL formats:
  // https://chrome.google.com/webstore/detail/extension-name/abcdefghijklmnopqrstuvwxyz
  // https://chromewebstore.google.com/detail/extension-name/abcdefghijklmnopqrstuvwxyz
  const urlMatch = extensionIdOrUrl.match(/\/([a-z]{32})(?:[/?#]|$)/i);
  if (urlMatch) {
    extensionId = urlMatch[1];
  }

  // Validate extension ID format (32 lowercase letters)
  if (!/^[a-z]{32}$/i.test(extensionId)) {
    return { success: false, error: 'Invalid extension ID format' };
  }

  extensionId = extensionId.toLowerCase();

  try {
    console.log(`Downloading extension ${extensionId} from Chrome Web Store...`);
    const crxPath = await downloadCrx(extensionId);

    console.log(`Unpacking CRX to extensions directory...`);
    const profileExtPath = getProfileExtensionsPath(profileId);
    const destPath = path.join(profileExtPath, extensionId);

    // Remove existing if present
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    fs.mkdirSync(destPath, { recursive: true });

    unpackCrx(crxPath, destPath);

    // Clean up temp CRX
    fs.unlinkSync(crxPath);

    // Load the extension
    const ses = session.fromPartition(`persist:profile-${profileId}`);
    const ext = await ses.loadExtension(destPath);
    const metadata = getExtensionMetadata(destPath);

    const extInfo = {
      id: ext.id,
      name: metadata?.name || ext.name,
      path: destPath,
      iconPath: metadata?.iconPath,
      hasPopup: metadata?.hasPopup || false,
      popupFile: metadata?.popupFile || null
    };

    if (!loadedExtensions[profileId]) {
      loadedExtensions[profileId] = [];
    }
    // Remove existing entry if reinstalling
    loadedExtensions[profileId] = loadedExtensions[profileId].filter(e => e.path !== destPath);
    loadedExtensions[profileId].push(extInfo);

    console.log(`Successfully installed extension ${ext.name} for profile ${profileId}`);
    return { success: true, extension: extInfo };
  } catch (e) {
    console.error('Failed to install extension from web store:', e);
    return { success: false, error: e.message };
  }
});

// Open extension popup window
ipcMain.handle('open-extension-popup', async (event, profileId, extensionId) => {
  const extInfo = loadedExtensions[profileId]?.find(e => e.id === extensionId);
  if (!extInfo || !extInfo.popupFile) {
    return { success: false, error: 'No popup available for this extension' };
  }

  const popupUrl = `chrome-extension://${extensionId}/${extInfo.popupFile}`;
  const ses = session.fromPartition(`persist:profile-${profileId}`);

  // Create popup window with the profile's session
  const popupWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: true,
    resizable: true,
    parent: mainWindow,
    modal: false,
    show: false,
    title: extInfo.name,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true
    }
  });

  // Handle popup errors
  popupWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`Popup failed to load: ${errorDescription} (${errorCode})`);
  });

  popupWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`Extension popup console [${level}]: ${message}`);
  });

  popupWindow.loadURL(popupUrl);

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
  });

  return { success: true };
});

// Import bookmarks from Chrome HTML export
ipcMain.handle('import-bookmarks', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Import Bookmarks',
    message: 'Select a Chrome bookmarks HTML export file',
    filters: [
      { name: 'HTML Files', extensions: ['html', 'htm'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'No file selected' };
  }

  try {
    const htmlContent = fs.readFileSync(result.filePaths[0], 'utf8');
    const bookmarks = parseBookmarksHtml(htmlContent);
    return { success: true, bookmarks };
  } catch (e) {
    console.error('Failed to import bookmarks:', e);
    return { success: false, error: e.message };
  }
});

// Parse Chrome bookmarks HTML format with folder hierarchy
function parseBookmarksHtml(html) {
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Normalize the HTML - remove <p> tags that Chrome adds after DL tags
  const normalized = html.replace(/<DL><p>/gi, '<DL>').replace(/<\/DL><p>/gi, '</DL>');

  // Find matching </DL> for a <DL> starting at given position
  function findMatchingDLEnd(content, startPos) {
    let depth = 1;
    let pos = startPos;
    while (depth > 0 && pos < content.length) {
      const nextOpen = content.indexOf('<DL>', pos);
      const nextClose = content.indexOf('</DL>', pos);
      if (nextClose === -1) return -1;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) return nextClose;
        pos = nextClose + 5;
      }
    }
    return -1;
  }

  function parseLevel(content) {
    const items = [];
    let pos = 0;

    while (pos < content.length) {
      // Find next <DT> tag (case insensitive)
      const lowerContent = content.substring(pos).toLowerCase();
      const dtIdx = lowerContent.indexOf('<dt>');
      if (dtIdx === -1) break;

      const dtStart = pos + dtIdx;
      const afterDt = dtStart + 4;
      const nextContent = content.substring(afterDt, afterDt + 200);

      if (nextContent.match(/^\s*<H3/i)) {
        // This is a folder
        const h3Match = content.substring(afterDt).match(/<H3[^>]*>([^<]+)<\/H3>/i);
        if (h3Match) {
          const folderName = h3Match[1].trim();
          const h3End = afterDt + h3Match.index + h3Match[0].length;

          // Find the <DL> that starts this folder's content
          const dlIdx = content.substring(h3End).toLowerCase().indexOf('<dl>');
          if (dlIdx !== -1) {
            const dlStart = h3End + dlIdx;
            const dlEnd = findMatchingDLEnd(content, dlStart + 4);

            if (dlEnd !== -1) {
              const folderContent = content.substring(dlStart + 4, dlEnd);
              const children = parseLevel(folderContent);
              if (children.length > 0) {
                items.push({
                  id: generateId(),
                  name: folderName.substring(0, 50),
                  isFolder: true,
                  children: children
                });
              }
              pos = dlEnd + 5;
            } else {
              pos = afterDt + h3Match[0].length;
            }
          } else {
            pos = afterDt + h3Match[0].length;
          }
        } else {
          pos = afterDt + 1;
        }
      } else if (nextContent.match(/^\s*<A\s/i)) {
        // This is a bookmark link
        const linkMatch = content.substring(afterDt).match(/<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/i);
        if (linkMatch) {
          const url = linkMatch[1];
          const name = (linkMatch[2] || '').trim() || url;
          if (url && !url.startsWith('javascript:')) {
            items.push({
              id: generateId(),
              name: name.substring(0, 50),
              url: url
            });
          }
          pos = afterDt + linkMatch.index + linkMatch[0].length;
        } else {
          pos = afterDt + 1;
        }
      } else {
        pos = afterDt + 1;
      }
    }
    return items;
  }

  // Find Bookmarks Bar by looking for PERSONAL_TOOLBAR_FOLDER attribute
  const toolbarMatch = normalized.match(/<DT><H3[^>]*PERSONAL_TOOLBAR_FOLDER[^>]*>[^<]*<\/H3>/i);
  if (toolbarMatch) {
    const h3End = toolbarMatch.index + toolbarMatch[0].length;
    const dlIdx = normalized.substring(h3End).toLowerCase().indexOf('<dl>');
    if (dlIdx !== -1) {
      const dlStart = h3End + dlIdx;
      const dlEnd = findMatchingDLEnd(normalized, dlStart + 4);
      if (dlEnd !== -1) {
        const barContent = normalized.substring(dlStart + 4, dlEnd);
        return parseLevel(barContent);
      }
    }
  }

  // Fallback: parse everything
  return parseLevel(normalized);
}

// Get extension icon as base64
ipcMain.handle('get-extension-icon', async (event, iconPath) => {
  try {
    if (iconPath && fs.existsSync(iconPath)) {
      const data = fs.readFileSync(iconPath);
      const ext = path.extname(iconPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      return `data:${mimeType};base64,${data.toString('base64')}`;
    }
  } catch (e) {
    console.error('Failed to read extension icon:', e);
  }
  return null;
});

app.whenReady().then(() => {
  // Force dark theme
  const { nativeTheme } = require('electron');
  nativeTheme.themeSource = 'dark';

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'icons', 'chromattica_c_icon.png'));
  }

  // Set About panel options
  app.setAboutPanelOptions({
    applicationName: 'Chromattica [beta]',
    applicationVersion: '1.0.1-beta',
    copyright: '© 2026 A-flat Minor. info@aflatminor.com',
    credits: 'Multi-profile Google account manager with isolated browser sessions.'
  });

  // Set User-Agent for the default session
  session.defaultSession.setUserAgent(userAgent);

  // Set up media permissions for default session
  setupSessionPermissions(session.defaultSession);

  // Create custom menu with correct app name
  const template = [
    {
      label: 'Chromattica [beta]',
      submenu: [
        { role: 'about', label: 'About Chromattica [beta]' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Chromattica' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Chromattica' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Auto-updater event handlers (called when updater is first initialized)
function setupAutoUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', { status: 'checking' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', { status: 'not-available' });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        percent: progress.percent
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', { status: 'downloaded' });
    }
  });

  autoUpdater.on('error', (err) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', { status: 'error', message: err.message });
    }
  });
}

// IPC handlers for auto-updater (lazy-load updater on first use)
ipcMain.handle('check-for-updates', () => {
  getAutoUpdater().checkForUpdates();
});

ipcMain.handle('download-update', () => {
  getAutoUpdater().downloadUpdate();
});

ipcMain.handle('install-update', () => {
  getAutoUpdater().quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-user-agent', () => {
  return userAgent;
});

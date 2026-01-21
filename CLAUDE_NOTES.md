# Chromattica Development Notes

## CURRENT STATUS (Updated 2026-01-19)

### Working!
- Successfully migrated from Swift/SwiftUI to **Electron**
- App runs and shows UI correctly
- Profile creation works, webview loads Google sign-in
- **FONT ISSUE FIXED** - see Known Issues section for details

### To Run The App
```bash
cd /Users/yevgenysimkin/AfM/Chromattica/Chromattica
./node_modules/.bin/electron .
```

## Project Overview
Multi-profile Google account manager for macOS - like Shift app. Embedded browser tabs with isolated sessions per profile.

## Architecture: Electron (FINAL)

### Why Electron (not Swift)
- **WKWebView**: Google blocks OAuth in embedded webviews - DOES NOT WORK
- **Chrome Launcher**: Opens external Chrome windows, not integrated - user rejected
- **Electron**: Chromium-based, embedded tabs, extension support possible - THIS IS WHAT SHIFT USES

### File Structure
```
Chromattica/
├── package.json           # Electron project config
├── src/
│   ├── main.js           # Main process - window creation, IPC
│   ├── preload.js        # Secure bridge main↔renderer
│   ├── index.html        # UI structure
│   ├── styles.css        # Dark theme styling
│   └── renderer.js       # UI logic, profile/tab management
├── node_modules/         # Dependencies (electron v28)
├── CLAUDE_NOTES.md       # This file
└── .git/
```

### How It Works
1. Main process creates BrowserWindow with webview tag enabled
2. Each profile gets isolated session via `partition: persist:profile-{id}`
3. Profiles stored in `~/Library/Application Support/chromattica/profiles.json`
4. Webviews load Google pages with full Chromium rendering

## Features Implemented
- [x] Profile sidebar with color avatars
- [x] Tab bar with pinned Gmail tab per profile
- [x] Add/delete profiles
- [x] Add/close tabs (Cmd+T for new tab)
- [x] Isolated sessions per profile (partition-based)
- [x] Dark theme UI
- [x] macOS traffic light positioning
- [x] Tab persistence between sessions (saves/restores all tabs)
- [x] Google avatar extraction (auto-fetches profile pic from Gmail)
- [x] Draggable title bar (entire bar except tabs)

## In Progress: Profile-Specific Apps

### How Apps Work
- Apps = special pinned tabs shown in sidebar (not tab bar)
- Each profile has its own apps list
- Apps persist URL state across sessions
- Apps use profile's partition (isolated sessions)

### UI Flow
1. Click + button → menu appears: "Add Account" | "Add App"
2. "Add App" → app picker modal with:
   - Common Google apps (Gmail, Drive, Docs, Sheets, Calendar, Meet, Photos, Keep)
   - Search bar for other apps (Trello, WhatsApp, Slack, Notion, Asana, etc.)
3. Apps appear in sidebar above + button, below profiles
4. Click app → loads in main view (like selecting a tab)

### Future Plans
- "Browser" app with address bar, bookmarks
- Remove top tab bar entirely (apps replace tabs)
- Chrome extension support (Grammarly, LastPass)

## Known Issues

### Font Rendering in Webviews (FIXED)
- **Symptom**: All text showed as □□□□ question marks
- **Root cause**: Electron sandbox blocks access to macOS system fonts
- **Fix**: `app.commandLine.appendSwitch('no-sandbox')` in main.js
- **Note**: Font cache flush did NOT help. Chrome works fine (different sandbox).
- **Also affected Shift app** - same underlying Electron sandbox issue

## What We Tried That Failed

### 1. Swift + WKWebView (ABANDONED)
- Google blocks OAuth: "This browser or app may not be secure"
- Tried: User-agent spoofing, JS injection to mask webview
- Result: Google detects and blocks it. DO NOT TRY AGAIN.

### 2. Swift + Chrome Launcher
- Worked but opened external Chrome windows
- Not integrated experience like Shift
- User chose to migrate to Electron instead

### 3. App Sandbox issues (FIXED by disabling)
- Swift sandbox prevented launching Chrome
- Fixed by setting ENABLE_APP_SANDBOX = NO
- (No longer relevant after Electron migration)

## Lesson Learned

**When user wants Shift-like app with:**
- Embedded browser tabs
- Isolated sessions per profile
- Chrome extension support

**IMMEDIATELY recommend Electron.** No native macOS solution exists.

## Commands Reference

```bash
# Install dependencies
npm install

# Run app
./node_modules/.bin/electron .
# or
npm start

# Clear macOS font cache (if fonts broken)
sudo atsutil databases -remove
# Then restart Mac
```

## User Preferences
- Prefers simple solutions, single-file when possible
- Wants Shift-like integrated experience
- Needs Chrome extension support (LastPass, Grammarly)
- Google avatar as profile icon (not yet implemented)

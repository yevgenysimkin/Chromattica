// Chrome user agent to make Google services work properly
const CHROME_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 20 distinct color options for profiles
const PROFILE_COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#F97316', // Orange
  '#22C55E', // Green
  '#A855F7', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F59E0B', // Amber
  '#6366F1', // Indigo
  '#84CC16', // Lime
  '#06B6D4', // Cyan
  '#F43F5E', // Rose
  '#8B5CF6', // Violet
  '#10B981', // Emerald
  '#FB923C', // Light Orange
  '#0EA5E9', // Sky
  '#D946EF', // Fuchsia
  '#78716C', // Stone
  '#64748B', // Slate
  '#FBBF24', // Yellow
];

// State
let profiles = [];
let selectedProfileId = null;
let tabsByProfile = {};  // { profileId: [{ id, title, url, isPinned }] }
let activeTabByProfile = {};  // { profileId: tabId }
let appsByProfile = {};  // { profileId: [{ id, name, url, icon, currentUrl }] }
let bookmarksByProfile = {};  // { profileId: [{ id, name, url }] }
let activeAppByProfile = {};  // { profileId: appId or null }
let selectedColor = '#3B82F6';
let editingProfile = null;  // Profile currently being edited
let editSelectedColor = '#3B82F6';

// DOM Elements
const profileList = document.getElementById('profile-list');
const tabsContainer = document.getElementById('tabs-container');
const browserContainer = document.getElementById('browser-container');
const emptyState = document.getElementById('empty-state');
const modalOverlay = document.getElementById('modal-overlay');
const profileNameInput = document.getElementById('profile-name-input');
const addMenuContainer = document.getElementById('add-menu-container');
const addMenu = document.getElementById('add-menu');
const appModalOverlay = document.getElementById('app-modal-overlay');
const appSearchInput = document.getElementById('app-search-input');
const editProfileOverlay = document.getElementById('edit-profile-overlay');
const editProfileNameInput = document.getElementById('edit-profile-name');
const editColorPicker = document.getElementById('edit-color-picker');
const menuOrderSelect = document.getElementById('menu-order-select');
const appSlideout = document.getElementById('app-slideout');
const slideoutApps = document.getElementById('slideout-apps');
const slideoutAddApp = document.getElementById('slideout-add-app');
const extensionsModalOverlay = document.getElementById('extensions-modal-overlay');
const installedExtensionsDiv = document.getElementById('installed-extensions');
const addExtensionBtn = document.getElementById('add-extension-btn');
const extensionsCloseBtn = document.getElementById('extensions-close-btn');
const extensionInstallBar = document.getElementById('extension-install-bar');
const installBarName = document.getElementById('install-bar-name');
const installBarBtn = document.getElementById('install-bar-btn');
const bitwardenBtn = document.getElementById('bitwarden-btn');
const bitwardenPanel = document.getElementById('bitwarden-panel');
const bitwardenClose = document.getElementById('bitwarden-close');
const bitwardenWebview = document.getElementById('bitwarden-webview');
const lastpassBtn = document.getElementById('lastpass-btn');
const lastpassPanel = document.getElementById('lastpass-panel');
const lastpassClose = document.getElementById('lastpass-close');
const lastpassWebview = document.getElementById('lastpass-webview');
const tabBarAvatar = document.getElementById('tab-bar-avatar');
const navBar = document.getElementById('nav-bar');
const navBack = document.getElementById('nav-back');
const navForward = document.getElementById('nav-forward');
const navRefresh = document.getElementById('nav-refresh');
const addressBar = document.getElementById('address-bar');
const bookmarksBar = document.getElementById('bookmarks-bar');
const bookmarksList = document.getElementById('bookmarks-list');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const importBookmarksBtn = document.getElementById('import-bookmarks-btn');

// Slide-out state
let slideoutProfileId = null;
let slideoutHideTimeout = null;

// Extensions state
let extensionsByProfile = {}; // { profileId: [{ id, name, iconPath, iconData }] }
let extensionIconCache = {}; // { iconPath: base64Data }
let currentWebStoreExtension = null; // { id, name, profileId, webview } - for install bar

// Save tab and app state to disk
async function saveTabState() {
  // Update URLs from active webviews before saving (tabs)
  for (const profileId of Object.keys(tabsByProfile)) {
    for (const tab of tabsByProfile[profileId]) {
      const webview = document.getElementById(`webview-${profileId}-${tab.id}`);
      if (webview && webview.getURL) {
        try {
          tab.url = webview.getURL();
        } catch (e) {
          // Webview might not be ready
        }
      }
    }
  }

  // Update URLs from active webviews (apps)
  for (const profileId of Object.keys(appsByProfile)) {
    for (const app of appsByProfile[profileId]) {
      const webview = document.getElementById(`webview-app-${profileId}-${app.id}`);
      if (webview && webview.getURL) {
        try {
          app.currentUrl = webview.getURL();
        } catch (e) {
          // Webview might not be ready
        }
      }
    }
  }

  await window.electronAPI.saveTabs({
    tabsByProfile,
    activeTabByProfile,
    appsByProfile,
    activeAppByProfile,
    bookmarksByProfile,
    selectedProfileId
  });
}

// Initialize
async function init() {
  profiles = await window.electronAPI.getProfiles();

  // Load saved tab state
  const savedTabs = await window.electronAPI.getTabs();

  if (savedTabs.tabsByProfile) {
    tabsByProfile = savedTabs.tabsByProfile;
  }
  if (savedTabs.activeTabByProfile) {
    activeTabByProfile = savedTabs.activeTabByProfile;
  }
  if (savedTabs.appsByProfile) {
    appsByProfile = savedTabs.appsByProfile;
  }
  if (savedTabs.activeAppByProfile) {
    activeAppByProfile = savedTabs.activeAppByProfile;
  }
  if (savedTabs.bookmarksByProfile) {
    bookmarksByProfile = savedTabs.bookmarksByProfile;
  }
  if (savedTabs.selectedProfileId && profiles.find(p => p.id === savedTabs.selectedProfileId)) {
    selectedProfileId = savedTabs.selectedProfileId;
  } else if (profiles.length > 0) {
    selectedProfileId = profiles[0].id;
  }

  // Initialize tabs and apps for any profiles that don't have them
  profiles.forEach(profile => {
    if (!tabsByProfile[profile.id]) {
      tabsByProfile[profile.id] = [];
    }
    if (!appsByProfile[profile.id]) {
      appsByProfile[profile.id] = [];
    }

    // Ensure Gmail app exists as default (migration)
    const hasGmailApp = appsByProfile[profile.id].some(app => app.isDefault && app.url === 'https://mail.google.com');
    if (!hasGmailApp) {
      // Add Gmail as default app at the beginning
      const gmailApp = {
        id: generateId(),
        name: 'Gmail',
        url: 'https://mail.google.com',
        icon: 'icons/gmail.svg',
        currentUrl: 'https://mail.google.com',
        isDefault: true
      };
      appsByProfile[profile.id].unshift(gmailApp);

      // Remove Gmail pinned tab if it exists (migration from old format)
      tabsByProfile[profile.id] = tabsByProfile[profile.id].filter(tab =>
        !(tab.isPinned && tab.url && tab.url.includes('mail.google.com'))
      );
    }

    // Set Gmail as active app if no app is selected
    if (!activeAppByProfile[profile.id]) {
      const gmailApp = appsByProfile[profile.id].find(app => app.isDefault);
      activeAppByProfile[profile.id] = gmailApp ? gmailApp.id : null;
    }

    // Set active tab if tabs exist and no active tab
    if (tabsByProfile[profile.id].length > 0 && !activeTabByProfile[profile.id]) {
      activeTabByProfile[profile.id] = tabsByProfile[profile.id][0].id;
    }
  });

  render();
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Render functions
function render() {
  renderProfiles();
  renderTabs();
  renderTabBarAvatar();
  renderBrowser();
  updateNavBar();
  updateEmptyState();
}

// Update the avatar shown in the tab bar to indicate current profile
function renderTabBarAvatar() {
  const accountColorLine = document.getElementById('account-color-line');
  const frameTopFill = document.getElementById('frame-top-fill');
  const frameSidebarLeft = document.getElementById('frame-sidebar-left');
  const frameAccountTop = document.getElementById('frame-account-top');
  const frameAccountRight = document.getElementById('frame-account-right');
  const frameAccountBottom = document.getElementById('frame-account-bottom');

  const setFrameColor = (color) => {
    accountColorLine.style.setProperty('--account-color', color);
    frameTopFill.style.setProperty('--account-color', color);
    frameSidebarLeft.style.setProperty('--account-color', color);
    frameAccountTop.style.setProperty('--account-color', color);
    frameAccountRight.style.setProperty('--account-color', color);
    frameAccountBottom.style.setProperty('--account-color', color);
  };

  if (!selectedProfileId) {
    tabBarAvatar.classList.add('empty');
    tabBarAvatar.innerHTML = '';
    setFrameColor('transparent');
    return;
  }

  const profile = profiles.find(p => p.id === selectedProfileId);
  if (!profile) {
    tabBarAvatar.classList.add('empty');
    tabBarAvatar.innerHTML = '';
    setFrameColor('transparent');
    return;
  }

  tabBarAvatar.classList.remove('empty');
  tabBarAvatar.style.background = profile.color;

  // Set all frame colors
  setFrameColor(profile.color);

  // Position the frame elements based on selected profile button
  const profileIndex = profiles.findIndex(p => p.id === selectedProfileId);
  const profileBtn = profileList.children[profileIndex];
  if (profileBtn) {
    const btnRect = profileBtn.getBoundingClientRect();
    const sidebarWidth = 88;

    // Padding above and below the account wrapper
    const wrapperPadding = 3;

    // Sidebar left line: from top (y:4) down to top-left of account (with padding)
    frameSidebarLeft.style.height = `${btnRect.top - 4 - wrapperPadding}px`;

    // Account top bracket: from left edge (x:0) to right side of sidebar
    frameAccountTop.style.top = `${btnRect.top - wrapperPadding}px`;
    frameAccountTop.style.left = '0';
    frameAccountTop.style.width = `${sidebarWidth}px`;

    // Account right bracket: down the right side of the account
    frameAccountRight.style.top = `${btnRect.top - wrapperPadding}px`;
    frameAccountRight.style.left = `${sidebarWidth - 4}px`;
    frameAccountRight.style.height = `${btnRect.height + wrapperPadding * 2}px`;

    // Account bottom bracket: from right side to left edge
    frameAccountBottom.style.top = `${btnRect.bottom - 4 + wrapperPadding}px`;
    frameAccountBottom.style.width = `${sidebarWidth}px`;
  }

  if (profile.avatar) {
    tabBarAvatar.innerHTML = `<img src="${profile.avatar}" alt="${profile.name}">`;
  } else {
    tabBarAvatar.innerHTML = '';
    tabBarAvatar.textContent = profile.name.charAt(0).toUpperCase();
  }
}

// Update navigation bar state (show/hide, address bar URL)
function updateNavBar() {
  // Show nav bar and bookmarks ONLY for tabs, NOT for apps (slideout menu items)
  if (selectedProfileId) {
    const activeAppId = activeAppByProfile[selectedProfileId];
    const activeTabId = activeTabByProfile[selectedProfileId];

    // Only show nav bar when viewing a tab (not an app)
    if (!activeAppId && activeTabId) {
      navBar.classList.remove('hidden');
      bookmarksBar.classList.remove('hidden');
      updateAddressBar();
      renderBookmarks();
      return;
    }
  }
  navBar.classList.add('hidden');
  bookmarksBar.classList.add('hidden');
}

// Render bookmarks for current profile with folder support and overflow
function renderBookmarks() {
  bookmarksList.innerHTML = '';

  // Remove existing overflow elements
  const existingOverflowBtn = bookmarksBar.querySelector('.bookmark-overflow-btn');
  const existingOverflowDropdown = bookmarksBar.querySelector('.bookmark-overflow-dropdown');
  if (existingOverflowBtn) existingOverflowBtn.remove();
  if (existingOverflowDropdown) existingOverflowDropdown.remove();

  if (!selectedProfileId) return;

  const bookmarks = bookmarksByProfile[selectedProfileId] || [];
  if (bookmarks.length === 0) return;

  // Render all bookmarks first
  bookmarks.forEach(bm => {
    bookmarksList.appendChild(createBookmarkElement(bm));
  });

  // Check for overflow after render
  requestAnimationFrame(() => checkBookmarkOverflow(bookmarks));
}

// Create a bookmark element (link or folder)
function createBookmarkElement(bm) {
  if (bm.isFolder) {
    return createFolderElement(bm);
  }

  const btn = document.createElement('button');
  btn.className = 'bookmark-btn';
  btn.textContent = bm.name;
  btn.title = bm.url;
  btn.addEventListener('click', () => navigateToUrl(bm.url));
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (confirm(`Remove bookmark "${bm.name}"?`)) {
      removeBookmarkById(bm.id, bookmarksByProfile[selectedProfileId]);
      saveTabState();
      renderBookmarks();
    }
  });
  return btn;
}

// Get the dropdown portal element
function getDropdownPortal() {
  return document.getElementById('dropdown-portal');
}

// Show a dropdown in the portal, positioned relative to a button
function showDropdownInPortal(btn, items, alignRight = false) {
  closeAllDropdowns();

  const portal = getDropdownPortal();
  const dropdown = document.createElement('div');
  dropdown.className = 'bookmark-dropdown';
  dropdown.dataset.portalDropdown = 'true';

  items.forEach(item => {
    dropdown.appendChild(createDropdownItem(item));
  });

  portal.appendChild(dropdown);

  // Position the dropdown relative to the button with edge detection
  const rect = btn.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom}px`;

  // Get dropdown dimensions (may need to measure after adding to DOM)
  const dropdownWidth = dropdown.offsetWidth || 200;

  if (alignRight) {
    // Check if aligning right would go off left edge
    const rightEdge = rect.right;
    if (rightEdge - dropdownWidth < 0) {
      // Not enough room on left, align to left edge of window
      dropdown.style.left = '0px';
      dropdown.style.right = 'auto';
    } else {
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.left = 'auto';
    }
  } else {
    // Check if dropdown would go off right edge
    if (rect.left + dropdownWidth > window.innerWidth) {
      // Not enough room on right, align to right edge
      dropdown.style.right = '0px';
      dropdown.style.left = 'auto';
    } else {
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.right = 'auto';
    }
  }

  // Ensure dropdown doesn't go below viewport
  const dropdownHeight = dropdown.offsetHeight || 300;
  if (rect.bottom + dropdownHeight > window.innerHeight) {
    // Position above the button instead, or constrain to bottom
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    if (spaceAbove > spaceBelow && spaceAbove >= dropdownHeight) {
      // Position above
      dropdown.style.top = `${rect.top - dropdownHeight}px`;
    } else {
      // Constrain to bottom of viewport
      dropdown.style.top = `${Math.max(0, window.innerHeight - dropdownHeight)}px`;
    }
  }
}

// Create a folder dropdown element
function createFolderElement(folder) {
  const container = document.createElement('div');
  container.className = 'bookmark-folder';

  const btn = document.createElement('button');
  btn.className = 'bookmark-btn bookmark-folder-btn';
  btn.innerHTML = `<span class="folder-icon">📁</span> ${folder.name} <span class="folder-arrow">▼</span>`;
  btn.title = folder.name;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const portal = getDropdownPortal();
    const existingDropdown = portal.querySelector('.bookmark-dropdown');
    const wasOpen = existingDropdown && existingDropdown.dataset.folderId === folder.id;

    closeAllDropdowns();

    if (!wasOpen) {
      showDropdownInPortal(btn, folder.children);
      const dropdown = portal.querySelector('.bookmark-dropdown');
      if (dropdown) dropdown.dataset.folderId = folder.id;
    }
  });

  container.appendChild(btn);
  return container;
}

// Create an item for dropdown (either link or nested folder)
function createDropdownItem(item) {
  if (item.isFolder) {
    return createNestedFolderElement(item);
  }

  const btn = document.createElement('button');
  btn.className = 'bookmark-dropdown-item';
  btn.textContent = item.name;
  btn.title = item.url;
  btn.addEventListener('click', () => {
    navigateToUrl(item.url);
    closeAllDropdowns();
  });
  return btn;
}

// Create nested folder for inside dropdowns
function createNestedFolderElement(folder) {
  const container = document.createElement('div');
  container.className = 'bookmark-nested-folder';

  const btn = document.createElement('button');
  btn.className = 'bookmark-dropdown-item bookmark-nested-folder-btn';
  btn.innerHTML = `<span class="folder-icon">📁</span> ${folder.name} <span class="nested-arrow">▶</span>`;

  const submenu = document.createElement('div');
  submenu.className = 'bookmark-submenu hidden';

  folder.children.forEach(child => {
    submenu.appendChild(createDropdownItem(child));
  });

  btn.addEventListener('mouseenter', () => {
    // Close sibling submenus
    const siblings = container.parentElement.querySelectorAll('.bookmark-submenu');
    siblings.forEach(s => {
      if (s !== submenu) s.classList.add('hidden');
    });
    submenu.classList.remove('hidden');

    // Position submenu with edge detection
    const btnRect = btn.getBoundingClientRect();
    const parentDropdown = btn.closest('.bookmark-dropdown');
    if (parentDropdown) {
      const parentRect = parentDropdown.getBoundingClientRect();
      submenu.style.position = 'fixed';

      // Estimate submenu width (use actual if available, else estimate)
      const submenuWidth = submenu.offsetWidth || 200;

      // Check if there's room on the right
      const roomOnRight = window.innerWidth - parentRect.right >= submenuWidth;
      // Check if there's room on the left
      const roomOnLeft = parentRect.left >= submenuWidth;

      if (roomOnRight) {
        // Open to the right
        submenu.style.left = `${parentRect.right}px`;
        submenu.style.right = 'auto';
      } else if (roomOnLeft) {
        // Open to the left
        submenu.style.right = `${window.innerWidth - parentRect.left}px`;
        submenu.style.left = 'auto';
      } else {
        // Not enough room on either side, default to right but constrain
        submenu.style.left = `${Math.max(0, window.innerWidth - submenuWidth)}px`;
        submenu.style.right = 'auto';
      }

      // Vertical positioning - ensure it doesn't go below viewport
      const submenuHeight = submenu.offsetHeight || 300;
      let top = btnRect.top;
      if (top + submenuHeight > window.innerHeight) {
        top = Math.max(0, window.innerHeight - submenuHeight);
      }
      submenu.style.top = `${top}px`;
    }
  });

  container.appendChild(btn);
  container.appendChild(submenu);
  return container;
}

// Remove bookmark by ID recursively
function removeBookmarkById(id, items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      items.splice(i, 1);
      return true;
    }
    if (items[i].isFolder && removeBookmarkById(id, items[i].children)) {
      return true;
    }
  }
  return false;
}

// Check if bookmarks overflow and show >> button
function checkBookmarkOverflow(bookmarks) {
  const listRect = bookmarksList.getBoundingClientRect();
  const children = Array.from(bookmarksList.children);

  if (children.length === 0) return;

  // Calculate available width (leave room for >> button - 40px)
  const availableWidth = listRect.width - 40;

  let totalWidth = 0;
  let overflowIndex = -1;

  for (let i = 0; i < children.length; i++) {
    const childWidth = children[i].offsetWidth + 4; // 4px gap
    if (totalWidth + childWidth > availableWidth && i > 0) {
      overflowIndex = i;
      break;
    }
    totalWidth += childWidth;
  }

  if (overflowIndex > 0) {
    // Hide overflowing items
    for (let i = overflowIndex; i < children.length; i++) {
      children[i].style.display = 'none';
    }

    // Collect overflow items for dropdown
    const overflowItems = bookmarks.slice(overflowIndex);

    // Create overflow button (no dropdown as child - uses portal)
    const overflowBtn = document.createElement('button');
    overflowBtn.className = 'bookmark-btn bookmark-overflow-btn';
    overflowBtn.textContent = '>>';
    overflowBtn.title = `${overflowItems.length} more bookmarks`;

    overflowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const portal = getDropdownPortal();
      const existingDropdown = portal.querySelector('.bookmark-dropdown');
      const wasOpen = existingDropdown && existingDropdown.dataset.isOverflow === 'true';

      closeAllDropdowns();

      if (!wasOpen) {
        showDropdownInPortal(overflowBtn, overflowItems, true); // alignRight = true
        const dropdown = portal.querySelector('.bookmark-dropdown');
        if (dropdown) dropdown.dataset.isOverflow = 'true';
      }
    });

    // Insert into bookmarks list
    bookmarksList.appendChild(overflowBtn);
  }
}

// Close all bookmark dropdowns
function closeAllDropdowns() {
  // Clear portal dropdowns
  const portal = getDropdownPortal();
  if (portal) {
    portal.innerHTML = '';
  }
  // Also hide any legacy dropdowns
  document.querySelectorAll('.bookmark-dropdown, .bookmark-submenu').forEach(d => {
    d.classList.add('hidden');
  });
}

// Add current page as bookmark
function addBookmark() {
  const webview = getCurrentWebview();
  if (!webview || !selectedProfileId) return;

  try {
    const url = webview.getURL();
    const title = webview.getTitle() || url;

    if (!bookmarksByProfile[selectedProfileId]) {
      bookmarksByProfile[selectedProfileId] = [];
    }

    bookmarksByProfile[selectedProfileId].push({
      id: generateId(),
      name: title.substring(0, 30),
      url: url
    });

    saveTabState();
    renderBookmarks();
  } catch (e) {
    console.error('Failed to add bookmark:', e);
  }
}

// Import bookmarks from Chrome HTML export (replaces existing)
async function importBookmarks() {
  if (!selectedProfileId) {
    alert('Please select an account first');
    return;
  }

  try {
    const result = await window.electronAPI.importBookmarks();

    if (!result.success) {
      if (result.error !== 'No file selected') {
        alert('Failed to import bookmarks: ' + result.error);
      }
      return;
    }

    if (result.bookmarks.length === 0) {
      alert('No bookmarks found in the file');
      return;
    }

    // Replace existing bookmarks with imported ones
    bookmarksByProfile[selectedProfileId] = result.bookmarks;

    await saveTabState();
    renderBookmarks();

    // Count total bookmarks including nested
    const countBookmarks = (items) => items.reduce((sum, item) =>
      sum + (item.isFolder ? countBookmarks(item.children) : 1), 0);
    const total = countBookmarks(result.bookmarks);

    alert(`Imported ${total} bookmarks`);
  } catch (e) {
    console.error('Failed to import bookmarks:', e);
    alert('Failed to import bookmarks: ' + e.message);
  }
}

// Update address bar with current webview URL
function updateAddressBar() {
  const webview = getCurrentWebview();
  if (webview) {
    try {
      const url = webview.getURL();
      addressBar.value = url || '';
    } catch (e) {
      addressBar.value = '';
    }
  } else {
    addressBar.value = '';
  }
}

// Get the currently active webview
function getCurrentWebview() {
  if (!selectedProfileId) return null;

  const activeAppId = activeAppByProfile[selectedProfileId];
  if (activeAppId) {
    return document.getElementById(`webview-app-${selectedProfileId}-${activeAppId}`);
  }

  const activeTabId = activeTabByProfile[selectedProfileId];
  if (activeTabId) {
    return document.getElementById(`webview-${selectedProfileId}-${activeTabId}`);
  }

  return null;
}

// Navigation functions
function navigateBack() {
  const webview = getCurrentWebview();
  if (webview && webview.canGoBack()) {
    webview.goBack();
  }
}

function navigateForward() {
  const webview = getCurrentWebview();
  if (webview && webview.canGoForward()) {
    webview.goForward();
  }
}

function navigateRefresh() {
  const webview = getCurrentWebview();
  if (webview) {
    webview.reload();
  }
}

function navigateToUrl(url) {
  const webview = getCurrentWebview();
  if (!webview) {
    // If no active tab, create one
    if (selectedProfileId) {
      addTab();
      // Wait a moment for tab to be created, then navigate
      setTimeout(() => {
        const newWebview = getCurrentWebview();
        if (newWebview) {
          let finalUrl = url;
          if (!url.includes('://')) {
            // Check if it looks like a URL or a search
            if (url.includes('.') && !url.includes(' ')) {
              finalUrl = 'https://' + url;
            } else {
              finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url);
            }
          }
          newWebview.src = finalUrl;
        }
      }, 100);
    }
    return;
  }

  let finalUrl = url;
  if (!url.includes('://')) {
    // Check if it looks like a URL or a search
    if (url.includes('.') && !url.includes(' ')) {
      finalUrl = 'https://' + url;
    } else {
      finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
  }
  webview.src = finalUrl;
}

function renderProfiles() {
  profileList.innerHTML = '';

  profiles.forEach(profile => {
    const btn = document.createElement('button');
    btn.className = 'profile-btn' + (profile.id === selectedProfileId ? ' selected' : '');

    // Avatar container
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'profile-avatar';
    avatarDiv.style.background = profile.color;
    avatarDiv.style.setProperty('--profile-color', profile.color);

    if (profile.avatar) {
      const img = document.createElement('img');
      img.src = profile.avatar;
      img.onerror = () => {
        avatarDiv.innerHTML = '';
        avatarDiv.textContent = profile.name.charAt(0).toUpperCase();
      };
      avatarDiv.appendChild(img);
    } else {
      avatarDiv.textContent = profile.name.charAt(0).toUpperCase();
    }
    btn.appendChild(avatarDiv);

    // Label below avatar
    const label = document.createElement('span');
    label.className = 'profile-label';
    label.textContent = profile.name;
    btn.appendChild(label);

    // Show active app indicator for selected profile
    if (profile.id === selectedProfileId) {
      const activeAppId = activeAppByProfile[profile.id];
      const apps = appsByProfile[profile.id] || [];
      const activeApp = apps.find(app => app.id === activeAppId);

      if (activeApp) {
        const appIndicator = document.createElement('div');
        appIndicator.className = 'active-app-indicator';

        const appIcon = document.createElement('img');
        appIcon.src = activeApp.icon;
        appIcon.alt = activeApp.name;
        appIndicator.appendChild(appIcon);

        const appName = document.createElement('span');
        appName.textContent = activeApp.name;
        appIndicator.appendChild(appName);

        btn.appendChild(appIndicator);
      }
    }

    btn.addEventListener('click', () => selectProfile(profile.id));
    btn.addEventListener('contextmenu', (e) => showProfileContextMenu(e, profile));

    // Hover listeners for slide-out
    btn.addEventListener('mouseenter', () => showAppSlideout(profile.id));
    btn.addEventListener('mouseleave', () => scheduleHideSlideout());

    profileList.appendChild(btn);
  });
}

// Slide-out panel functions
function showAppSlideout(profileId) {
  // Clear any pending hide timeout
  if (slideoutHideTimeout) {
    clearTimeout(slideoutHideTimeout);
    slideoutHideTimeout = null;
  }

  // Remove slideout-active from any previous button
  profileList.querySelectorAll('.profile-btn.slideout-active').forEach(btn => {
    btn.classList.remove('slideout-active');
  });

  // Add slideout-active to the current profile button
  const profileIndex = profiles.findIndex(p => p.id === profileId);
  if (profileIndex >= 0) {
    const profileBtn = profileList.children[profileIndex];
    if (profileBtn) {
      profileBtn.classList.add('slideout-active');
    }
  }

  slideoutProfileId = profileId;
  const apps = appsByProfile[profileId] || [];
  const activeAppId = activeAppByProfile[selectedProfileId];

  slideoutApps.innerHTML = '';

  apps.forEach(app => {
    const btn = document.createElement('button');
    btn.className = 'slideout-app-btn';
    if (app.id === activeAppId && profileId === selectedProfileId) {
      btn.classList.add('selected');
    }
    if (app.isDefault) {
      btn.classList.add('default');
    }

    const iconContainer = document.createElement('span');
    iconContainer.className = 'app-icon';
    // Check if icon is an SVG path or emoji
    if (app.icon && app.icon.endsWith('.svg')) {
      const img = document.createElement('img');
      img.src = app.icon;
      img.alt = app.name;
      iconContainer.appendChild(img);
    } else {
      iconContainer.textContent = app.icon || '🌐';
    }
    btn.appendChild(iconContainer);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      // Select profile if different, then select app
      if (selectedProfileId !== profileId) {
        selectedProfileId = profileId;
      }
      selectApp(app.id);
      hideAppSlideout();
    });

    btn.addEventListener('contextmenu', (e) => showAppContextMenu(e, app, profileId));

    slideoutApps.appendChild(btn);
  });

  appSlideout.classList.remove('hidden');
  appSlideout.classList.add('visible');
}

function hideAppSlideout() {
  appSlideout.classList.remove('visible');
  appSlideout.classList.add('hidden');
  slideoutProfileId = null;

  // Remove slideout-active from all profile buttons
  profileList.querySelectorAll('.profile-btn.slideout-active').forEach(btn => {
    btn.classList.remove('slideout-active');
  });
}

function scheduleHideSlideout() {
  // Small delay to prevent flicker when moving between profile and slideout
  slideoutHideTimeout = setTimeout(() => {
    hideAppSlideout();
  }, 150);
}

// Extension functions
async function loadExtensionsForProfile(profileId) {
  if (!profileId) return;

  try {
    const extensions = await window.electronAPI.getExtensions(profileId);
    extensionsByProfile[profileId] = [];

    for (const ext of extensions) {
      const extData = {
        id: ext.id,
        name: ext.name,
        iconPath: ext.iconPath,
        hasPopup: ext.hasPopup,
        popupFile: ext.popupFile,
        iconData: null
      };

      // Load icon if available
      if (ext.iconPath && !extensionIconCache[ext.iconPath]) {
        const iconData = await window.electronAPI.getExtensionIcon(ext.iconPath);
        if (iconData) {
          extensionIconCache[ext.iconPath] = iconData;
        }
      }
      extData.iconData = extensionIconCache[ext.iconPath] || null;

      extensionsByProfile[profileId].push(extData);
    }

  } catch (e) {
    console.error('Failed to load extensions:', e);
  }
}

function showExtensionsModal() {
  if (!selectedProfileId) {
    alert('Please select an account first');
    return;
  }

  renderInstalledExtensions();
  extensionsModalOverlay.classList.remove('hidden');
}

function hideExtensionsModal() {
  extensionsModalOverlay.classList.add('hidden');
}

function renderInstalledExtensions() {
  const extensions = extensionsByProfile[selectedProfileId] || [];

  if (extensions.length === 0) {
    installedExtensionsDiv.innerHTML = '<div class="extensions-empty">No extensions installed for this account.</div>';
    return;
  }

  installedExtensionsDiv.innerHTML = '';

  extensions.forEach(ext => {
    const item = document.createElement('div');
    item.className = 'extension-item';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'extension-item-icon';
    if (ext.iconData) {
      const img = document.createElement('img');
      img.src = ext.iconData;
      img.alt = ext.name;
      iconDiv.appendChild(img);
    } else {
      iconDiv.textContent = ext.name.charAt(0).toUpperCase();
    }
    item.appendChild(iconDiv);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'extension-item-info';
    infoDiv.innerHTML = `
      <div class="extension-item-name">${ext.name}</div>
      <div class="extension-item-id">${ext.id}</div>
    `;
    item.appendChild(infoDiv);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'extension-remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeExtension(ext.id));
    item.appendChild(removeBtn);

    installedExtensionsDiv.appendChild(item);
  });
}

async function addExtension() {
  if (!selectedProfileId) return;

  try {
    const result = await window.electronAPI.selectExtensionFolder();
    if (!result.success) {
      if (result.error && result.error !== 'No folder selected') {
        alert(result.error);
      }
      return;
    }

    const installResult = await window.electronAPI.installExtension(selectedProfileId, result.path);
    if (installResult.success) {
      // Reload extensions
      await loadExtensionsForProfile(selectedProfileId);
      renderInstalledExtensions();
    } else {
      alert('Failed to install extension: ' + installResult.error);
    }
  } catch (e) {
    console.error('Failed to add extension:', e);
    alert('Failed to add extension: ' + e.message);
  }
}

async function removeExtension(extensionId) {
  if (!selectedProfileId) return;

  if (!confirm('Remove this extension?')) return;

  try {
    const result = await window.electronAPI.removeExtension(selectedProfileId, extensionId);
    if (result.success) {
      await loadExtensionsForProfile(selectedProfileId);
      renderInstalledExtensions();
    } else {
      alert('Failed to remove extension: ' + result.error);
    }
  } catch (e) {
    console.error('Failed to remove extension:', e);
    alert('Failed to remove extension: ' + e.message);
  }
}

// Chrome Web Store integration
function isWebStoreExtensionPage(url) {
  // Match Chrome Web Store extension detail pages
  // https://chrome.google.com/webstore/detail/extension-name/abcdefghijklmnopqrstuvwxyz
  // https://chromewebstore.google.com/detail/extension-name/abcdefghijklmnopqrstuvwxyz
  return /chrome\.google\.com\/webstore\/detail\/[^\/]+\/[a-z]{32}/i.test(url) ||
         /chromewebstore\.google\.com\/detail\/[^\/]+\/[a-z]{32}/i.test(url);
}

function extractExtensionId(url) {
  const match = url.match(/\/([a-z]{32})(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : null;
}

// Inject the "Install in Chromattica" button into a webview showing Chrome Web Store
async function injectInstallButton(webview, profileId) {
  try {
    const url = webview.getURL();
    if (!isWebStoreExtensionPage(url)) {
      // Remove button if navigated away from extension page
      await webview.executeJavaScript(`
        const existingBtn = document.getElementById('chromattica-install-btn');
        if (existingBtn) existingBtn.remove();
      `);
      return;
    }

    const extensionId = extractExtensionId(url);
    if (!extensionId) return;

    // Inject the floating install button
    await webview.executeJavaScript(`
      (function() {
        // Remove existing button if any
        const existingBtn = document.getElementById('chromattica-install-btn');
        if (existingBtn) existingBtn.remove();

        // Create floating button
        const btn = document.createElement('button');
        btn.id = 'chromattica-install-btn';
        btn.innerHTML = '<span style="margin-right: 8px;">🎨</span> Install in Chromattica';
        btn.style.cssText = \`
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 999999;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 14px 24px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
          transition: transform 0.2s, box-shadow 0.2s;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        \`;

        btn.addEventListener('mouseenter', () => {
          btn.style.transform = 'scale(1.05)';
          btn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.5)';
        });

        btn.addEventListener('mouseleave', () => {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
        });

        btn.addEventListener('click', () => {
          btn.innerHTML = '<span style="margin-right: 8px;">⏳</span> Installing...';
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.8';

          // Signal to parent that install was requested
          window.postMessage({ type: 'chromattica-install', extensionId: '${extensionId}' }, '*');
        });

        document.body.appendChild(btn);
      })();
    `);

  } catch (e) {
    console.error('Failed to inject install button:', e);
  }
}

// Handle install request from webview
function setupWebviewInstallHandler(webview, profileId) {
  // Listen for messages from the injected button
  webview.addEventListener('console-message', async (e) => {
    // Use a specific log message to communicate (workaround for IPC limitations)
    if (e.message.startsWith('CHROMATTICA_INSTALL:')) {
      const extensionId = e.message.replace('CHROMATTICA_INSTALL:', '');
      await installExtensionFromWebStore(extensionId, profileId, webview);
    }
  });

  // Also set up ipc-message handler for the webview
  webview.addEventListener('ipc-message', async (e) => {
    if (e.channel === 'chromattica-install') {
      const extensionId = e.args[0];
      await installExtensionFromWebStore(extensionId, profileId, webview);
    }
  });
}

// Check if current page is Chrome Web Store extension and show/hide install bar
async function checkForWebStoreExtension(webview, profileId) {
  try {
    const url = webview.getURL();

    if (!isWebStoreExtensionPage(url)) {
      hideExtensionInstallBar();
      return;
    }

    const extensionId = extractExtensionId(url);
    if (!extensionId) {
      hideExtensionInstallBar();
      return;
    }

    // Try to get extension name from the page title or content
    let extensionName = 'Extension';
    try {
      extensionName = await webview.executeJavaScript(`
        document.querySelector('h1')?.textContent ||
        document.title.replace(' - Chrome Web Store', '').trim() ||
        'Extension'
      `);
    } catch (e) {
      // Use extension ID as fallback
      extensionName = extensionId;
    }

    showExtensionInstallBar(extensionId, extensionName, profileId, webview);
  } catch (e) {
    hideExtensionInstallBar();
  }
}

function showExtensionInstallBar(extensionId, extensionName, profileId, webview) {
  currentWebStoreExtension = { id: extensionId, name: extensionName, profileId, webview };
  installBarName.textContent = extensionName;
  installBarBtn.textContent = 'Install in Chromattica';
  installBarBtn.disabled = false;
  extensionInstallBar.classList.remove('hidden');
}

function hideExtensionInstallBar() {
  extensionInstallBar.classList.add('hidden');
  currentWebStoreExtension = null;
}

async function handleInstallBarClick() {
  if (!currentWebStoreExtension) return;

  const { id, name, profileId, webview } = currentWebStoreExtension;

  installBarBtn.textContent = 'Installing...';
  installBarBtn.disabled = true;

  try {
    const result = await window.electronAPI.installExtensionFromWebstore(profileId, id);

    if (result.success) {
      installBarBtn.textContent = '✓ Installed!';
      await loadExtensionsForProfile(profileId);

      // Hide after a moment
      setTimeout(() => {
        hideExtensionInstallBar();
      }, 2000);
    } else {
      installBarBtn.textContent = 'Failed - Try Again';
      installBarBtn.disabled = false;
      alert('Failed to install extension: ' + result.error);
    }
  } catch (e) {
    installBarBtn.textContent = 'Failed - Try Again';
    installBarBtn.disabled = false;
    alert('Failed to install extension: ' + e.message);
  }
}

async function installExtensionFromWebStore(extensionId, profileId, webview) {
  try {
    console.log(`Installing extension ${extensionId} for profile ${profileId}...`);

    const result = await window.electronAPI.installExtensionFromWebstore(profileId, extensionId);

    if (result.success) {
      // Update button to show success
      if (webview) {
        await webview.executeJavaScript(`
          const btn = document.getElementById('chromattica-install-btn');
          if (btn) {
            btn.innerHTML = '<span style="margin-right: 8px;">✅</span> Installed!';
            btn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
            setTimeout(() => {
              btn.style.transition = 'opacity 0.5s';
              btn.style.opacity = '0';
              setTimeout(() => btn.remove(), 500);
            }, 2000);
          }
        `);
      }

      // Reload extensions
      await loadExtensionsForProfile(profileId);

      console.log(`Extension ${result.extension.name} installed successfully`);
    } else {
      // Show error
      if (webview) {
        await webview.executeJavaScript(`
          const btn = document.getElementById('chromattica-install-btn');
          if (btn) {
            btn.innerHTML = '<span style="margin-right: 8px;">❌</span> Failed';
            btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
            setTimeout(() => {
              btn.innerHTML = '<span style="margin-right: 8px;">🎨</span> Install in Chromattica';
              btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }, 3000);
          }
        `);
      }
      console.error('Failed to install extension:', result.error);
      alert('Failed to install extension: ' + result.error);
    }
  } catch (e) {
    console.error('Failed to install extension:', e);
    alert('Failed to install extension: ' + e.message);
  }
}

// Open Chrome Web Store in a new tab
function openChromeWebStore() {
  if (!selectedProfileId) {
    alert('Please select an account first');
    return;
  }

  // Create a new tab with Chrome Web Store
  const newTab = {
    id: generateId(),
    title: 'Chrome Web Store',
    url: 'https://chromewebstore.google.com/',
    isPinned: false
  };

  tabsByProfile[selectedProfileId].push(newTab);
  activeTabByProfile[selectedProfileId] = newTab.id;
  // Clear active app so we show the tab
  activeAppByProfile[selectedProfileId] = null;

  saveTabState();
  hideExtensionsModal();
  render();
}

function renderTabs() {
  tabsContainer.innerHTML = '';

  if (!selectedProfileId || !tabsByProfile[selectedProfileId]) {
    return;
  }

  const tabs = tabsByProfile[selectedProfileId];
  const activeTabId = activeTabByProfile[selectedProfileId];

  tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.isPinned ? ' pinned' : '');

    // Add favicon
    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    if (tab.favicon) {
      favicon.src = tab.favicon;
    } else {
      // Default globe icon for pages without favicon
      favicon.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23888"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>');
    }
    favicon.onerror = () => {
      // Fallback to default icon if favicon fails to load
      favicon.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23888"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>');
    };

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.appendChild(favicon);
    tabEl.appendChild(title);
    if (!tab.isPinned) {
      tabEl.appendChild(closeBtn);
    }

    tabEl.addEventListener('click', () => selectTab(tab.id));

    tabsContainer.appendChild(tabEl);
  });
}

function renderBrowser() {
  // Remove all existing webviews except keep them cached
  const existingWebviews = browserContainer.querySelectorAll('webview');
  existingWebviews.forEach(wv => wv.classList.add('hidden'));

  if (!selectedProfileId) {
    return;
  }

  // Ensure Gmail (default app) is set as active if nothing else is
  let activeAppId = activeAppByProfile[selectedProfileId];
  if (!activeAppId && !activeTabByProfile[selectedProfileId]) {
    const gmailApp = appsByProfile[selectedProfileId]?.find(app => app.isDefault);
    if (gmailApp) {
      activeAppByProfile[selectedProfileId] = gmailApp.id;
      activeAppId = gmailApp.id;
    }
  }
  if (activeAppId) {
    renderAppWebview(activeAppId);
    return;
  }

  // Otherwise render the active tab
  if (!tabsByProfile[selectedProfileId]) {
    return;
  }

  const activeTabId = activeTabByProfile[selectedProfileId];
  const activeTab = tabsByProfile[selectedProfileId].find(t => t.id === activeTabId);

  if (!activeTab) return;

  // Create unique webview ID
  const webviewId = `webview-${selectedProfileId}-${activeTabId}`;
  let webview = document.getElementById(webviewId);

  if (!webview) {
    // Capture profile ID at creation time for use in closures
    const profileIdForWebview = selectedProfileId;
    const tabIdForWebview = activeTabId;

    webview = document.createElement('webview');
    webview.id = webviewId;
    webview.setAttribute('partition', `persist:profile-${profileIdForWebview}`);
    webview.setAttribute('src', activeTab.url);
    webview.setAttribute('useragent', CHROME_USER_AGENT);
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('webpreferences', 'contextIsolation=no, javascript=yes');

    // Update tab title when page loads
    webview.addEventListener('page-title-updated', (e) => {
      updateTabTitle(tabIdForWebview, e.title);
    });

    // Update tab favicon when available
    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        updateTabFavicon(profileIdForWebview, tabIdForWebview, e.favicons[0]);
      }
    });

    // Save URL when navigation finishes and try to extract avatar
    webview.addEventListener('did-navigate', () => {
      saveTabState();
      updateAddressBar();
      // Clear favicon on navigation so we get the new one
      const tabs = tabsByProfile[profileIdForWebview];
      const tab = tabs?.find(t => t.id === tabIdForWebview);
      if (tab) {
        tab.favicon = null;
        renderTabs();
      }
      // Delay avatar extraction to let page fully load
      setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 2000);
      // Check for Chrome Web Store extension page
      setTimeout(() => checkForWebStoreExtension(webview, profileIdForWebview), 500);
    });
    webview.addEventListener('did-navigate-in-page', () => {
      saveTabState();
      updateAddressBar();
      // Also check on in-page navigation (for SPA-style navigation)
      setTimeout(() => checkForWebStoreExtension(webview, profileIdForWebview), 500);
    });

    // Also try when page finishes loading (with retry for avatar)
    webview.addEventListener('did-finish-load', () => {
      setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 1000);
      // Retry after longer delay if avatar still not found
      setTimeout(() => {
        const profile = profiles.find(p => p.id === profileIdForWebview);
        if (profile && !profile.avatar) {
          extractGoogleAvatar(webview, profileIdForWebview);
        }
      }, 5000);
      // Check for Chrome Web Store extension page
      setTimeout(() => checkForWebStoreExtension(webview, profileIdForWebview), 500);
      // Try to extract favicon from page
      setTimeout(() => extractFavicon(webview, profileIdForWebview, tabIdForWebview), 500);
    });

    // Handle new window requests (open in same webview or new tab)
    webview.addEventListener('new-window', (e) => {
      // Open in the same webview for simplicity
      webview.src = e.url;
    });

    // Check for avatar on focus if profile doesn't have one yet
    webview.addEventListener('focus', () => {
      const profile = profiles.find(p => p.id === profileIdForWebview);
      if (profile && !profile.avatar) {
        setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 500);
      }
    });

    browserContainer.appendChild(webview);
  }

  webview.classList.remove('hidden');

  // Check for avatar when webview becomes visible if profile doesn't have one
  const profile = profiles.find(p => p.id === selectedProfileId);
  if (profile && !profile.avatar) {
    setTimeout(() => extractGoogleAvatar(webview, selectedProfileId), 1000);
  }
}

function renderAppWebview(appId) {
  const app = appsByProfile[selectedProfileId].find(a => a.id === appId);
  if (!app) return;

  const webviewId = `webview-app-${selectedProfileId}-${appId}`;
  let webview = document.getElementById(webviewId);

  if (!webview) {
    const profileIdForWebview = selectedProfileId;
    const appIdForWebview = appId;

    webview = document.createElement('webview');
    webview.id = webviewId;
    webview.setAttribute('partition', `persist:profile-${profileIdForWebview}`);
    // Use currentUrl only if it's a valid http(s) URL, otherwise use app.url
    const srcUrl = (app.currentUrl && app.currentUrl.startsWith('http')) ? app.currentUrl : app.url;
    webview.setAttribute('src', srcUrl);
    webview.setAttribute('useragent', CHROME_USER_AGENT);
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('webpreferences', 'contextIsolation=no, javascript=yes');

    // Save URL when navigation finishes
    webview.addEventListener('did-navigate', () => {
      saveTabState();
      updateAddressBar();
      setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 2000);
    });
    webview.addEventListener('did-navigate-in-page', () => {
      saveTabState();
      updateAddressBar();
    });
    webview.addEventListener('did-finish-load', () => {
      setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 1000);
    });

    // Handle new window requests
    webview.addEventListener('new-window', (e) => {
      webview.src = e.url;
    });

    // Check for avatar on focus if profile doesn't have one yet
    webview.addEventListener('focus', () => {
      const profile = profiles.find(p => p.id === profileIdForWebview);
      if (profile && !profile.avatar) {
        setTimeout(() => extractGoogleAvatar(webview, profileIdForWebview), 500);
      }
    });

    browserContainer.appendChild(webview);
  }

  webview.classList.remove('hidden');

  // If webview exists but has no valid URL loaded, reload it
  try {
    const currentUrl = webview.getURL();
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl === '') {
      webview.setAttribute('src', app.url);
    }
  } catch (e) {
    // Webview might not be ready yet, try setting src anyway
    if (!webview.getAttribute('src') || webview.getAttribute('src') === 'about:blank') {
      webview.setAttribute('src', app.url);
    }
  }

  // Check for avatar when webview becomes visible if profile doesn't have one
  const profile = profiles.find(p => p.id === selectedProfileId);
  if (profile && !profile.avatar) {
    setTimeout(() => extractGoogleAvatar(webview, selectedProfileId), 1000);
  }
}

function updateEmptyState() {
  if (profiles.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }
}

// Profile actions
function selectProfile(profileId) {
  selectedProfileId = profileId;

  // Load Gmail (default app) when selecting a profile
  const gmailApp = appsByProfile[profileId]?.find(app => app.isDefault);
  if (gmailApp) {
    activeAppByProfile[profileId] = gmailApp.id;
  }

  saveTabState();
  render();

  // Load extensions for this profile if not already loaded
  if (!extensionsByProfile[profileId]) {
    loadExtensionsForProfile(profileId);
  }

  // Try to extract avatar if profile doesn't have one
  const profile = profiles.find(p => p.id === profileId);
  if (profile && !profile.avatar) {
    // Try multiple times with increasing delays
    [500, 1500, 3000, 6000].forEach(delay => {
      setTimeout(() => {
        const currentProfile = profiles.find(p => p.id === profileId);
        if (currentProfile && !currentProfile.avatar) {
          // Try from any webview for this profile (tabs or apps)
          const webviews = browserContainer.querySelectorAll(`webview[id^="webview-${profileId}-"], webview[id^="webview-app-${profileId}-"]`);
          webviews.forEach(webview => {
            if (!webview.classList.contains('hidden')) {
              extractGoogleAvatar(webview, profileId);
            }
          });
        }
      }, delay);
    });
  }
}

function showProfileContextMenu(e, profile) {
  e.preventDefault();
  showEditProfileModal(profile);
}

// Edit Profile Modal functions
function showEditProfileModal(profile) {
  editingProfile = profile;
  editSelectedColor = profile.color;

  editProfileOverlay.classList.remove('hidden');
  editProfileNameInput.value = profile.name;
  editProfileNameInput.focus();

  // Render color picker with available colors (current profile's color is available)
  const usedColors = getUsedColors(profile.id);
  renderColorPicker(editColorPicker, usedColors, profile.color);

  // Populate menu order dropdown
  const currentIndex = profiles.findIndex(p => p.id === profile.id);
  menuOrderSelect.innerHTML = '';
  for (let i = 0; i < profiles.length; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = i + 1; // Display 1-based index
    if (i === currentIndex) {
      option.selected = true;
    }
    menuOrderSelect.appendChild(option);
  }
}

function hideEditProfileModal() {
  editProfileOverlay.classList.add('hidden');
  editingProfile = null;
}

async function saveProfileEdits() {
  if (!editingProfile) return;

  const newName = editProfileNameInput.value.trim() || editingProfile.name;
  const newIndex = parseInt(menuOrderSelect.value, 10);
  const currentIndex = profiles.findIndex(p => p.id === editingProfile.id);

  // Find and update the profile
  const profile = profiles.find(p => p.id === editingProfile.id);
  if (profile) {
    profile.name = newName;
    profile.color = editSelectedColor;

    // Reorder if needed
    if (newIndex !== currentIndex) {
      // Remove from current position
      profiles.splice(currentIndex, 1);
      // Insert at new position
      profiles.splice(newIndex, 0, profile);
    }

    await window.electronAPI.saveProfiles(profiles);
    hideEditProfileModal();
    render();
  }
}

function confirmDeleteProfile() {
  if (!editingProfile) return;

  if (confirm(`Are you sure you want to delete "${editingProfile.name}"? This will remove all tabs and apps for this account.`)) {
    const profileId = editingProfile.id;
    hideEditProfileModal();
    deleteProfile(profileId);
  }
}

async function deleteProfile(profileId) {
  profiles = profiles.filter(p => p.id !== profileId);
  delete tabsByProfile[profileId];
  delete activeTabByProfile[profileId];
  delete appsByProfile[profileId];
  delete activeAppByProfile[profileId];

  if (selectedProfileId === profileId) {
    selectedProfileId = profiles.length > 0 ? profiles[0].id : null;
  }

  await window.electronAPI.saveProfiles(profiles);
  await saveTabState();
  render();

  // Remove webviews for this profile (tabs and apps)
  const webviews = browserContainer.querySelectorAll(`webview[id^="webview-${profileId}"], webview[id^="webview-app-${profileId}"]`);
  webviews.forEach(wv => wv.remove());
}

// App actions
function selectApp(appId) {
  if (!selectedProfileId) return;
  activeAppByProfile[selectedProfileId] = appId;
  saveTabState();
  render();
}

function showAppContextMenu(e, app, profileId = null) {
  e.preventDefault();

  // Cannot delete default Gmail app
  if (app.isDefault) {
    return;
  }

  const targetProfileId = profileId || selectedProfileId;
  if (confirm(`Remove "${app.name}" app?`)) {
    deleteApp(app.id, targetProfileId);
  }
}

async function deleteApp(appId, profileId = null) {
  const targetProfileId = profileId || selectedProfileId;
  if (!targetProfileId) return;

  // Prevent deletion of default apps (Gmail)
  const app = appsByProfile[targetProfileId]?.find(a => a.id === appId);
  if (app?.isDefault) return;

  appsByProfile[targetProfileId] = appsByProfile[targetProfileId].filter(a => a.id !== appId);

  // If deleting the active app, switch to Gmail (default)
  if (activeAppByProfile[targetProfileId] === appId) {
    const gmailApp = appsByProfile[targetProfileId].find(a => a.isDefault);
    activeAppByProfile[targetProfileId] = gmailApp ? gmailApp.id : null;
  }

  await saveTabState();
  render();

  // Update slideout if visible
  if (slideoutProfileId === targetProfileId) {
    showAppSlideout(targetProfileId);
  }

  // Remove the app's webview
  const webview = document.getElementById(`webview-app-${targetProfileId}-${appId}`);
  if (webview) webview.remove();
}

function addApp(name, url, icon) {
  if (!selectedProfileId) return;

  const app = {
    id: generateId(),
    name: name,
    url: url,
    icon: icon || '🌐',
    currentUrl: url
  };

  appsByProfile[selectedProfileId].push(app);
  activeAppByProfile[selectedProfileId] = app.id;
  saveTabState();
  render();
}

// Tab actions
function selectTab(tabId) {
  if (!selectedProfileId) return;
  // Clear active app when selecting a tab
  activeAppByProfile[selectedProfileId] = null;
  activeTabByProfile[selectedProfileId] = tabId;
  saveTabState();
  render();

  // Try to extract avatar if profile doesn't have one
  const profile = profiles.find(p => p.id === selectedProfileId);
  if (profile && !profile.avatar) {
    setTimeout(() => {
      const webview = document.getElementById(`webview-${selectedProfileId}-${tabId}`);
      if (webview) {
        extractGoogleAvatar(webview, selectedProfileId);
      }
    }, 1500);
  }
}

function closeTab(tabId) {
  if (!selectedProfileId) return;

  const tabs = tabsByProfile[selectedProfileId];
  const tab = tabs.find(t => t.id === tabId);

  if (tab && tab.isPinned) return; // Can't close pinned tabs

  tabsByProfile[selectedProfileId] = tabs.filter(t => t.id !== tabId);

  // If closing active tab, switch to another
  if (activeTabByProfile[selectedProfileId] === tabId) {
    const remainingTabs = tabsByProfile[selectedProfileId];
    activeTabByProfile[selectedProfileId] = remainingTabs.length > 0 ? remainingTabs[0].id : null;
  }

  // Remove the webview
  const webview = document.getElementById(`webview-${selectedProfileId}-${tabId}`);
  if (webview) webview.remove();

  saveTabState();
  render();
}

function addTab() {
  if (!selectedProfileId) return;

  const newTab = {
    id: generateId(),
    title: 'New Tab',
    url: 'https://www.google.com',
    isPinned: false
  };

  tabsByProfile[selectedProfileId].push(newTab);
  activeTabByProfile[selectedProfileId] = newTab.id;
  // Clear active app so the tab gets focus
  activeAppByProfile[selectedProfileId] = null;
  saveTabState();
  render();
}

function updateTabTitle(tabId, title) {
  if (!selectedProfileId) return;

  const tabs = tabsByProfile[selectedProfileId];
  const tab = tabs.find(t => t.id === tabId);
  if (tab && title) {
    tab.title = title;
    renderTabs(); // Just update tabs, not the whole UI
  }
}

function updateTabFavicon(profileId, tabId, faviconUrl) {
  if (!profileId || !tabsByProfile[profileId]) return;
  const tabs = tabsByProfile[profileId];
  const tab = tabs.find(t => t.id === tabId);
  if (tab && faviconUrl) {
    tab.favicon = faviconUrl;
    // Only re-render tabs if this is the currently selected profile
    if (profileId === selectedProfileId) {
      renderTabs();
    }
  }
}

// Extract favicon from page using JS injection
async function extractFavicon(webview, profileId, tabId) {
  try {
    // Check if tab already has a favicon
    const tabs = tabsByProfile[profileId];
    const tab = tabs?.find(t => t.id === tabId);
    if (tab?.favicon) return; // Already have a favicon

    const faviconUrl = await webview.executeJavaScript(`
      (function() {
        // Try to find favicon in link tags
        const iconLinks = document.querySelectorAll('link[rel*="icon"]');
        for (const link of iconLinks) {
          if (link.href) return link.href;
        }
        // Fallback to default favicon.ico location
        return window.location.origin + '/favicon.ico';
      })()
    `);

    if (faviconUrl) {
      updateTabFavicon(profileId, tabId, faviconUrl);
    }
  } catch (err) {
    // Silently fail - favicon is not critical
    console.log('Failed to extract favicon:', err.message);
  }
}

// Extract Google avatar from webview and convert to base64
async function extractGoogleAvatar(webview, profileId) {
  try {
    const url = webview.getURL();
    // Only try on Google pages
    if (!url.includes('google.com')) return;

    // Execute JS to find avatar and fetch as blob
    const avatarDataUrl = await webview.executeJavaScript(`
      (async function() {
        // Try multiple selectors where Google shows avatar
        const selectors = [
          'img[src^="https://lh3.googleusercontent.com/ogw/"]',
          'img[src^="https://lh3.googleusercontent.com/a/"]',
          'img[data-src^="https://lh3.googleusercontent.com/"]',
          'a[href*="SignOutOptions"] img',
          'img.gb_A',
          'img.gb_l',
          '[data-ogsr-up] img',
          'img[aria-label*="Account"]'
        ];

        let avatarSrc = null;
        for (const selector of selectors) {
          const img = document.querySelector(selector);
          if (img) {
            const src = img.src || img.getAttribute('data-src');
            if (src && src.includes('googleusercontent.com') && !src.includes('default-user')) {
              avatarSrc = src.replace(/=s\\d+/, '=s96').replace(/=c$/, '=s96-c');
              break;
            }
          }
        }

        if (!avatarSrc) {
          return null;
        }

        try {
          // Fetch the image as blob using the page's credentials
          const response = await fetch(avatarSrc, { credentials: 'include' });
          const blob = await response.blob();

          // Convert blob to base64
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.error('Failed to fetch avatar:', e);
          return null;
        }
      })();
    `);

    if (avatarDataUrl && avatarDataUrl.startsWith('data:')) {
      const profile = profiles.find(p => p.id === profileId);
      if (profile && profile.avatar !== avatarDataUrl) {
        profile.avatar = avatarDataUrl;
        await window.electronAPI.saveProfiles(profiles);
        renderProfiles();
      }
    }
  } catch (e) {
    // Webview might not be ready or JS execution failed
  }
}

// Color management functions
function getUsedColors(excludeProfileId = null) {
  return profiles
    .filter(p => p.id !== excludeProfileId)
    .map(p => p.color);
}

function renderColorPicker(container, usedColors, currentColor = null) {
  container.innerHTML = '';

  PROFILE_COLORS.forEach(color => {
    const option = document.createElement('div');
    option.className = 'color-option';
    option.dataset.color = color;
    option.style.background = color;

    // Mark as unavailable if used by another profile
    if (usedColors.includes(color) && color !== currentColor) {
      option.classList.add('unavailable');
    }

    // Mark as selected if it's the current color
    if (color === currentColor) {
      option.classList.add('selected');
    }

    // Click handler
    option.addEventListener('click', () => {
      if (option.classList.contains('unavailable')) return;

      container.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');

      // Update the appropriate state variable
      if (container.id === 'color-picker') {
        selectedColor = color;
      } else if (container.id === 'edit-color-picker') {
        editSelectedColor = color;
      }
    });

    container.appendChild(option);
  });
}

function getFirstAvailableColor(usedColors) {
  return PROFILE_COLORS.find(color => !usedColors.includes(color)) || PROFILE_COLORS[0];
}

// Modal functions
function showModal() {
  modalOverlay.classList.remove('hidden');
  profileNameInput.value = '';
  profileNameInput.focus();

  // Render color picker with available colors
  const colorPicker = document.getElementById('color-picker');
  const usedColors = getUsedColors();
  selectedColor = getFirstAvailableColor(usedColors);
  renderColorPicker(colorPicker, usedColors, selectedColor);
}

function hideModal() {
  modalOverlay.classList.add('hidden');
}

async function createProfile() {
  const name = profileNameInput.value.trim() || `Account ${profiles.length + 1}`;

  const profile = {
    id: generateId(),
    name: name,
    color: selectedColor
  };

  profiles.push(profile);
  selectedProfileId = profile.id;

  // Create Gmail as default app for new profile (opens sign-in flow)
  const gmailApp = {
    id: generateId(),
    name: 'Gmail',
    url: 'https://mail.google.com',
    icon: 'icons/gmail.svg',
    currentUrl: 'https://accounts.google.com/signin/v2/identifier?service=mail&continue=https://mail.google.com/',
    isDefault: true
  };

  tabsByProfile[profile.id] = [];
  activeTabByProfile[profile.id] = null;
  appsByProfile[profile.id] = [gmailApp];
  activeAppByProfile[profile.id] = gmailApp.id;

  await window.electronAPI.saveProfiles(profiles);
  await saveTabState();

  hideModal();
  render();
}

// Save state before window closes
window.addEventListener('beforeunload', () => {
  saveTabState();
});

// Event listeners

// Add menu toggle
document.getElementById('add-btn').addEventListener('click', () => {
  addMenu.classList.toggle('hidden');
});

// Add menu options
document.getElementById('add-account-option').addEventListener('click', () => {
  addMenu.classList.add('hidden');
  showModal();
});

// Close add menu when clicking outside
document.addEventListener('click', (e) => {
  if (!addMenuContainer.contains(e.target)) {
    addMenu.classList.add('hidden');
  }
  // Close bookmark dropdowns when clicking outside
  const isBookmarkElement = e.target.closest('.bookmark-folder') ||
                            e.target.closest('.bookmark-overflow-btn') ||
                            e.target.closest('.bookmark-dropdown') ||
                            e.target.closest('#dropdown-portal');
  if (!isBookmarkElement) {
    closeAllDropdowns();
  }
});

// Re-render bookmarks on window resize (debounced)
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    closeAllDropdowns();
    renderBookmarks();
  }, 100);
});

// Profile modal
document.getElementById('empty-add-btn').addEventListener('click', showModal);
document.getElementById('add-tab-btn').addEventListener('click', addTab);
document.getElementById('cancel-btn').addEventListener('click', hideModal);
document.getElementById('create-btn').addEventListener('click', createProfile);

// App modal functions
function showAppModal() {
  if (!selectedProfileId) {
    alert('Please select an account first');
    return;
  }
  appModalOverlay.classList.remove('hidden');
  appSearchInput.value = '';
  filterApps('');
  appSearchInput.focus();
}

function hideAppModal() {
  appModalOverlay.classList.add('hidden');
}

function filterApps(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.app-option').forEach(opt => {
    const name = opt.dataset.name.toLowerCase();
    if (name.includes(q) || q === '') {
      opt.classList.remove('hidden');
    } else {
      opt.classList.add('hidden');
    }
  });
}

// App modal event listeners
document.getElementById('app-cancel-btn').addEventListener('click', hideAppModal);

appModalOverlay.addEventListener('click', (e) => {
  if (e.target === appModalOverlay) {
    hideAppModal();
  }
});

appSearchInput.addEventListener('input', (e) => {
  filterApps(e.target.value);
});

// App option clicks
document.querySelectorAll('.app-option').forEach(opt => {
  opt.addEventListener('click', () => {
    addApp(opt.dataset.name, opt.dataset.url, opt.dataset.icon);
    hideAppModal();
  });
});

// Custom app
document.getElementById('add-custom-app-btn').addEventListener('click', () => {
  const name = document.getElementById('custom-app-name').value.trim();
  const url = document.getElementById('custom-app-url').value.trim();
  if (name && url) {
    addApp(name, url, '🌐');
    hideAppModal();
    document.getElementById('custom-app-name').value = '';
    document.getElementById('custom-app-url').value = '';
  }
});

// Color picker event listeners are now set up dynamically in renderColorPicker()

// Close modal on overlay click
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    hideModal();
  }
});

// Edit Profile Modal event listeners
document.getElementById('edit-cancel-btn').addEventListener('click', hideEditProfileModal);
document.getElementById('edit-save-btn').addEventListener('click', saveProfileEdits);
document.getElementById('delete-profile-btn').addEventListener('click', confirmDeleteProfile);

editProfileOverlay.addEventListener('click', (e) => {
  if (e.target === editProfileOverlay) {
    hideEditProfileModal();
  }
});

// Edit color picker event listeners are now set up dynamically in renderColorPicker()

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideModal();
    hideAppModal();
    hideEditProfileModal();
    hideExtensionsModal();
    hideAppSlideout();
    hideBitwardenPanel();
    hideLastPassPanel();
    addMenu.classList.add('hidden');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    addTab();
  }
});

// Slideout panel event listeners
appSlideout.addEventListener('mouseenter', () => {
  // Cancel hide timeout when hovering over slideout
  if (slideoutHideTimeout) {
    clearTimeout(slideoutHideTimeout);
    slideoutHideTimeout = null;
  }
});

appSlideout.addEventListener('mouseleave', () => {
  scheduleHideSlideout();
});

slideoutAddApp.addEventListener('click', () => {
  // Set selected profile to the slideout profile before opening modal
  if (slideoutProfileId) {
    selectedProfileId = slideoutProfileId;
    render();
  }
  hideAppSlideout();
  showAppModal();
});

// Extension event listeners
extensionsCloseBtn.addEventListener('click', hideExtensionsModal);
addExtensionBtn.addEventListener('click', addExtension);
document.getElementById('browse-webstore-btn').addEventListener('click', openChromeWebStore);
installBarBtn.addEventListener('click', handleInstallBarClick);

// Bitwarden panel functions
function toggleBitwardenPanel() {
  const isHidden = bitwardenPanel.classList.contains('hidden');
  if (isHidden) {
    bitwardenPanel.classList.remove('hidden');
    bitwardenBtn.classList.add('active');
    // Hide LastPass if open
    hideLastPassPanel();
  } else {
    bitwardenPanel.classList.add('hidden');
    bitwardenBtn.classList.remove('active');
  }
}

function hideBitwardenPanel() {
  bitwardenPanel.classList.add('hidden');
  bitwardenBtn.classList.remove('active');
}

// LastPass panel functions
function toggleLastPassPanel() {
  const isHidden = lastpassPanel.classList.contains('hidden');
  if (isHidden) {
    lastpassPanel.classList.remove('hidden');
    lastpassBtn.classList.add('active');
    // Hide Bitwarden if open
    hideBitwardenPanel();
  } else {
    lastpassPanel.classList.add('hidden');
    lastpassBtn.classList.remove('active');
  }
}

function hideLastPassPanel() {
  lastpassPanel.classList.add('hidden');
  lastpassBtn.classList.remove('active');
}

// Bitwarden event listeners
bitwardenBtn.addEventListener('click', toggleBitwardenPanel);
bitwardenClose.addEventListener('click', hideBitwardenPanel);

// LastPass event listeners
lastpassBtn.addEventListener('click', toggleLastPassPanel);
lastpassClose.addEventListener('click', hideLastPassPanel);

// Navigation bar event listeners
navBack.addEventListener('click', navigateBack);
navForward.addEventListener('click', navigateForward);
navRefresh.addEventListener('click', navigateRefresh);

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigateToUrl(addressBar.value.trim());
    addressBar.blur();
  }
});

addressBar.addEventListener('focus', () => {
  addressBar.select();
});

addBookmarkBtn.addEventListener('click', addBookmark);
importBookmarksBtn.addEventListener('click', importBookmarks);

// Set user agent for Bitwarden webview to work properly
bitwardenWebview.addEventListener('dom-ready', () => {
  bitwardenWebview.setUserAgent(CHROME_USER_AGENT);
});

// Set user agent for LastPass webview to work properly
lastpassWebview.addEventListener('dom-ready', () => {
  lastpassWebview.setUserAgent(CHROME_USER_AGENT);
});

extensionsModalOverlay.addEventListener('click', (e) => {
  if (e.target === extensionsModalOverlay) {
    hideExtensionsModal();
  }
});

// Initialize app
init();

// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 sangorrin

// Popup menu logic
const languageSelect = document.getElementById('language-select');
const toggleExtensionBtn = document.getElementById('toggle-extension-btn');
const showDefinitionsCheckbox = document.getElementById('show-definitions');

// Load saved preferences
chrome.storage.local.get(['targetLanguage', 'showDefinitions'], (result) => {
  const savedLang = result.targetLanguage || 'eng';
  languageSelect.value = savedLang;

  // Default to false if not set
  const showDefs = result.showDefinitions !== false ? result.showDefinitions : false;
  showDefinitionsCheckbox.checked = showDefs;
});

// Save language selection
languageSelect.addEventListener('change', () => {
  const selectedLang = languageSelect.value;
  chrome.storage.local.set({ targetLanguage: selectedLang }, () => {
    // Notify content script of language change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'languageChanged',
          language: selectedLang
        }).catch(() => {
          // Ignore errors (content script might not be loaded)
        });
      }
    });
  });
});

// Save definitions preference
showDefinitionsCheckbox.addEventListener('change', () => {
  const showDefs = showDefinitionsCheckbox.checked;
  chrome.storage.local.set({ showDefinitions: showDefs }, () => {
    // Notify content script of preference change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'settingsChanged',
          showDefinitions: showDefs
        }).catch(() => {
          // Ignore errors (content script might not be loaded)
        });
      }
    });
  });
});

// Toggle extension on/off globally
function updateToggleButton() {
  chrome.storage.local.get(['globallyEnabled'], (result) => {
    // Default to true if not set
    const isEnabled = result.globallyEnabled !== false;

    if (!isEnabled) {
      toggleExtensionBtn.textContent = '🚀 Activate Extension';
      toggleExtensionBtn.title = 'Enable French dictionary on all pages';
      toggleExtensionBtn.classList.add('disabled');
    } else {
      toggleExtensionBtn.textContent = '⏸️ Deactivate Extension';
      toggleExtensionBtn.title = 'Disable French dictionary on all pages';
      toggleExtensionBtn.classList.remove('disabled');
    }
  });
}

updateToggleButton();

// Toggle button handler
toggleExtensionBtn.addEventListener('click', () => {
  chrome.storage.local.get(['globallyEnabled'], (result) => {
    const currentState = result.globallyEnabled !== false;
    const newState = !currentState;

    chrome.storage.local.set({ globallyEnabled: newState }, () => {
      updateToggleButton();
      // Notify all tabs about the global state change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'globalStateChanged',
            enabled: newState
          }).catch(() => {
            // Tab might not have content script loaded
          });
        });
      });
    });
  });
});

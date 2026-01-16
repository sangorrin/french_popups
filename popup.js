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

// Toggle extension on/off for current domain
function updateToggleButton() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const currentDomain = new URL(tabs[0].url).hostname;
      const pageKey = `disabled_${currentDomain}`;

      chrome.storage.local.get([pageKey], (result) => {
        const isDisabled = result[pageKey] === true;

        if (isDisabled) {
          toggleExtensionBtn.textContent = '✅ Enable on this site';
          toggleExtensionBtn.title = 'Enable dictionary on this domain';
          toggleExtensionBtn.classList.add('disabled');
        } else {
          toggleExtensionBtn.textContent = '⏸️ Disable on this site';
          toggleExtensionBtn.title = 'Disable dictionary on this domain';
          toggleExtensionBtn.classList.remove('disabled');
        }
      });
    }
  });
}

updateToggleButton();

// Toggle button handler
toggleExtensionBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleExtension' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError);
          return;
        }

        if (response && response.success) {
          updateToggleButton();
        }
      });
    }
  });
});

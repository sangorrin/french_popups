// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 sangorrin

// Popup menu logic
const languageSelect = document.getElementById('language-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
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

// Update status based on current tab
function updateStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          statusDot.className = 'status-dot inactive';
          statusText.textContent = 'Extension not active on this page';
          return;
        }

        if (response && response.active) {
          statusDot.className = 'status-dot active';
          statusText.textContent = 'Active • French detected';
        } else {
          statusDot.className = 'status-dot inactive';
          statusText.textContent = 'Inactive • No French detected';
        }
      });
    }
  });
}

updateStatus();

// Force activate button handler
const forceActivateBtn = document.getElementById('force-activate-btn');
forceActivateBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'forceActivate' }, (response) => {
        if (chrome.runtime.lastError) {
          statusText.textContent = 'Error: Extension not loaded on this page';
          return;
        }

        if (response && response.success) {
          statusDot.className = 'status-dot active';
          statusText.textContent = 'Active • Manually activated';
        }
      });
    }
  });
});

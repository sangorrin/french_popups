// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 sangorrin

/**
 * Background Service Worker
 * Handles extension lifecycle and coordination
 */

// Initialize on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default language to English and enable globally
    chrome.storage.local.set({
      targetLanguage: 'eng',
      globallyEnabled: true
    });
    console.log('[French Popups] Extension installed, default language set to English and enabled globally');
  } else if (details.reason === 'update') {
    console.log('[French Popups] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getLanguage') {
    chrome.storage.local.get(['targetLanguage'], (result) => {
      sendResponse({ language: result.targetLanguage || 'eng' });
    });
    return true; // Keep channel open for async response
  }
});

console.log('[French Popups] Background service worker loaded');

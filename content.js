// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 sangorrin

/**
 * Content Script - Hover Detection and Popup Display
 * Based on translate_onhover's robust hover detection mechanism
 */

let isActive = false;
let currentPopup = null;
let showDefinitions = false;
const HOVER_DELAY = 400; // ms - delay before showing popup after mouse stops
const HIDE_DELAY = 300; // ms - delay before hiding popup when mouse moves away
const lastMouseStop = { x: 0, y: 0 };
let mouseMoveTimer = null;
let hidePopupTimer = null;

/**
 * Initialize extension
 */
async function init() {
  try {
    // Load preferences from storage
    const result = await chrome.storage.local.get(['targetLanguage', 'showDefinitions', 'extensionDisabledOnPage']);
    const targetLang = result.targetLanguage || 'eng';
    showDefinitions = result.showDefinitions !== false ? result.showDefinitions : false;

    await dictionary.init(targetLang);

    // Extension is active by default, unless explicitly disabled for this page
    const pageKey = `disabled_${window.location.hostname}`;
    const isDisabledForPage = await chrome.storage.local.get([pageKey]);

    if (!isDisabledForPage[pageKey]) {
      isActive = true;
      attachHoverListeners();
    }
  } catch (error) {
    console.error('[French Popups] Initialization error:', error);
  }
}

/**
 * Attach hover event listeners using mousestop event pattern
 * Based on translate_onhover's robust implementation
 */
function attachHoverListeners() {

  // Remove popup on scroll (but not when scrolling inside the popup)
  document.addEventListener('scroll', (e) => {
    // Don't hide if scrolling inside the popup
    if (currentPopup && currentPopup.contains(e.target)) {
      return;
    }
    hidePopup();
    clearTimeout(mouseMoveTimer);
  }, true);

  // Detect mouse movement with noise filtering
  let lastRawX = 0;
  let lastRawY = 0;

  document.addEventListener('mousemove', (e) => {
    if (!isActive) return;

    // Check if mouse has really moved (filter tremors/noise)
    if (!hasMouseReallyMoved(e, lastRawX, lastRawY)) {
      return;
    }

    lastRawX = e.clientX;
    lastRawY = e.clientY;

    // Clear any pending hide timer
    clearTimeout(hidePopupTimer);
    clearTimeout(mouseMoveTimer);

    // If popup exists and mouse is NOT over it, schedule hiding with delay
    if (currentPopup && !currentPopup.contains(e.target)) {
      hidePopupTimer = setTimeout(() => {
        // Only hide if mouse is still not over the popup
        if (currentPopup && !currentPopup.matches(':hover')) {
          hidePopup();
        }
      }, HIDE_DELAY);
    }

    // Start timer for mousestop (but not if hovering over popup)
    if (!currentPopup || !currentPopup.contains(e.target)) {
      mouseMoveTimer = setTimeout(() => {
        lastMouseStop.x = e.clientX;
        lastMouseStop.y = e.clientY;
        handleMouseStop(e);
      }, HOVER_DELAY);
    }
  });
}

/**
 * Check if mouse has really moved (filter noise/tremors)
 */
function hasMouseReallyMoved(e, lastX, lastY) {
  const threshold = 5; // pixels
  const leftBoundary = lastX - threshold;
  const rightBoundary = lastX + threshold;
  const topBoundary = lastY - threshold;
  const bottomBoundary = lastY + threshold;

  return e.clientX > rightBoundary ||
         e.clientX < leftBoundary ||
         e.clientY > bottomBoundary ||
         e.clientY < topBoundary;
}

/**
 * Handle mouse stop event - detect word and show popup
 */
async function handleMouseStop(e) {

  const hitElement = document.elementFromPoint(e.clientX, e.clientY);

  if (!hitElement) {
    return;
  }

  // Skip inputs and editable elements
  if (hitElement.nodeName === 'INPUT' ||
      hitElement.nodeName === 'TEXTAREA' ||
      hitElement.isContentEditable) {
    return;
  }

  // Check if inside editable parent
  let parent = hitElement.parentElement;
  while (parent) {
    if (parent.isContentEditable) {
      return;
    }
    parent = parent.parentElement;
  }

  // Get word at point
  const wordData = getHitWord(e);

  if (wordData && wordData.word && wordData.word.length >= 2) {
    await showPopup(wordData.word, wordData.followingText, e.clientX, e.clientY);
  }
}

/**
 * Get word at cursor position using translate_onhover's restorable technique
 * Returns {word, followingText} for multi-word expression support
 * This is the most critical function - it uses temporary DOM wrappers to detect words
 */
function getHitWord(e) {
  const hitElement = document.elementFromPoint(e.clientX, e.clientY);
  if (!hitElement) return null;

  const wordRegex = /[\p{L}]+(?:['''][\p{L}]+)*/u;

  // Get text nodes from hit element
  const textNodes = [];
  const walker = document.createTreeWalker(
    hitElement,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while (node = walker.nextNode()) {
    if (wordRegex.test(node.textContent)) {
      textNodes.push(node);
    }
  }

  if (textNodes.length === 0) {
    return null;
  }

  // Use restorable technique to protect original DOM
  return restorableOperation(textNodes, (nodes) => {
    return getExactWordAndContext(nodes, e, hitElement);
  });
}

/**
 * Restorable operation - wraps operation with DOM restoration
 * Ensures original DOM is always restored even if error occurs
 */
function restorableOperation(textNodes, operation) {
  // Wrap all text nodes in transblock elements
  textNodes.forEach(node => {
    const wrapper = document.createElement('transblock');
    node.parentNode.insertBefore(wrapper, node);
    wrapper.appendChild(node);
  });

  let result = null;
  try {
    result = operation(textNodes);
  } catch (error) {
    console.error('[French Popups] Error during word detection:', error);
  }

  // Restore DOM by unwrapping all temporary elements
  const allWrappers = document.querySelectorAll('transblock, transword');
  allWrappers.forEach(wrapper => {
    const parent = wrapper.parentNode;
    if (parent) {
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  });

  return result;
}

/**
 * Get exact word and following text from wrapped text nodes
 * Returns {word, followingText} or null
 */
function getExactWordAndContext(textNodes, e, originalHitElement) {
  // Find which text node was actually hit
  const hitTextNode = getExactTextNode(e);

  if (!hitTextNode || hitTextNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }


  // Get the minimal text segment containing the cursor
  const minimalNode = getMinimalTextNode(hitTextNode, e, originalHitElement);

  if (!minimalNode) {
    return null;
  }

  // Extract exact word and context from minimal text
  const result = extractWordAndContext(minimalNode, e, originalHitElement, textNodes);

  return result;
}

/**
 * Get exact text node hit by cursor (from wrapped nodes)
 */
function getExactTextNode(e) {
  const hitElement = document.elementFromPoint(e.clientX, e.clientY);

  // Should be hitting a transblock element
  if (hitElement && hitElement.tagName === 'TRANSBLOCK') {
    return hitElement.childNodes[0];
  }

  return null;
}

/**
 * Narrow down to minimal text segment using binary search
 */
function getMinimalTextNode(textNode, e, hitElement) {
  const text = textNode.textContent;
  const wordRegex = /[\p{L}]+(?:['''][\p{L}]+)*/u;

  if (!wordRegex.test(text)) {
    return null;
  }

  // If text is short enough, return as is
  if (text.length < 50) {
    return textNode;
  }

  // Binary split the text at word boundary
  const mid = Math.round(text.length / 2);
  const splitRegex = new RegExp(`^(.{${mid}}[\\p{L}''']*)(.*)$`, 'us');
  const match = text.match(splitRegex);

  if (!match) {
    return textNode;
  }

  const leftText = match[1];
  const rightText = match[2];

  // Replace text node with two transblock elements
  const parent = textNode.parentNode;
  const leftBlock = document.createElement('transblock');
  const rightBlock = document.createElement('transblock');

  leftBlock.textContent = leftText;
  rightBlock.textContent = rightText;

  // Get computed font style from hit element
  const computedStyle = window.getComputedStyle(hitElement);
  const fontStyle = {
    'line-height': computedStyle.lineHeight,
    'font-size': computedStyle.fontSize,
    'font-family': computedStyle.fontFamily
  };

  // Apply font style to blocks
  Object.assign(leftBlock.style, fontStyle);
  Object.assign(rightBlock.style, fontStyle);

  parent.replaceChild(leftBlock, textNode);
  parent.appendChild(rightBlock);

  // Check which block was hit
  const newHitElement = document.elementFromPoint(e.clientX, e.clientY);

  if (newHitElement === leftBlock) {
    return getMinimalTextNode(leftBlock.firstChild, e, hitElement);
  } else if (newHitElement === rightBlock) {
    return getMinimalTextNode(rightBlock.firstChild, e, hitElement);
  }

  return textNode;
}

/**
 * Extract exact word and following text from minimal text node
 * Returns {word, followingText} or null
 */
function extractWordAndContext(textNode, e, hitElement, allTextNodes) {
  const text = textNode.textContent;
  const wordRegex = /[\p{L}]+(?:['''][\p{L}]+)*/gu;

  const words = text.match(wordRegex);

  if (!words) {
    return null;
  }

  if (words.length === 1) {
    // Single word - get following text from remaining nodes
    const followingText = getFollowingText(textNode, allTextNodes);
    return { word: words[0], followingText };
  }

  // Replace text with word-wrapped HTML
  const parent = textNode.parentNode;
  const fragment = document.createDocumentFragment();

  let lastIndex = 0;
  wordRegex.lastIndex = 0;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    // Add text before word
    const before = text.substring(lastIndex, match.index);
    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }

    // Add word wrapped in transword
    const wordElement = document.createElement('transword');
    wordElement.textContent = match[0];

    // Apply font style
    const computedStyle = window.getComputedStyle(hitElement);
    wordElement.style.lineHeight = computedStyle.lineHeight;
    wordElement.style.fontSize = computedStyle.fontSize;
    wordElement.style.fontFamily = computedStyle.fontFamily;

    fragment.appendChild(wordElement);

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }

  parent.replaceChild(fragment, textNode);

  // Find which word was hit
  const hitWordElement = document.elementFromPoint(e.clientX, e.clientY);

  if (hitWordElement && hitWordElement.tagName === 'TRANSWORD') {
    const word = hitWordElement.textContent;
    // Get text after this word
    const followingText = getTextAfterElement(hitWordElement, allTextNodes);
    return { word, followingText };
  }

  // Fallback to first word
  const followingText = getFollowingText(textNode, allTextNodes);
  return { word: words[0], followingText };
}

/**
 * Get text following after a specific element
 */
function getTextAfterElement(element, allTextNodes) {
  let collecting = false;
  let text = '';

  // Get remaining text from current element's parent
  let sibling = element.nextSibling;
  while (sibling) {
    if (sibling.nodeType === Node.TEXT_NODE) {
      text += sibling.textContent;
    } else if (sibling.nodeType === Node.ELEMENT_NODE) {
      text += sibling.textContent;
    }
    sibling = sibling.nextSibling;
  }

  // Limit to reasonable length for multi-word matching (next 100 chars or ~20 words)
  const words = text.match(/[\p{L}]+(?:['''][\p{L}]+)*/gu) || [];
  const limitedWords = words.slice(0, 20);

  return limitedWords.join(' ');
}

/**
 * Get text following a text node within the collected text nodes
 */
function getFollowingText(currentNode, allTextNodes) {
  let text = '';
  let foundCurrent = false;

  // Get current node's remaining text (if it's the minimal node)
  const currentText = currentNode.textContent || '';

  // Try to get text from parent's siblings
  let parent = currentNode.parentElement;
  if (parent) {
    let sibling = parent.nextSibling;
    while (sibling) {
      if (sibling.nodeType === Node.TEXT_NODE) {
        text += sibling.textContent;
      } else if (sibling.nodeType === Node.ELEMENT_NODE) {
        text += sibling.textContent;
      }
      sibling = sibling.nextSibling;
    }
  }

  // Limit to reasonable length
  const words = text.match(/[\p{L}]+(?:['''][\p{L}]+)*/gu) || [];
  const limitedWords = words.slice(0, 20);

  return limitedWords.join(' ');
}

/**
 * Show translation popup
 */
async function showPopup(word, followingText, x, y) {
  hidePopup();

  // Look up ALL definitions for this word
  const entries = await dictionary.lookupAll(word, followingText);

  // Also check for conjugations (even if we found definitions)
  const conjugationEntry = await dictionary.lookupConjugationWithHeuristics(word.normalize('NFC').toLowerCase().replace(/'/g, '\u2019'));

  // If no definitions found at all, return
  if ((!entries || entries.length === 0) && !conjugationEntry) {
    return;
  }

  currentPopup = document.createElement('div');
  currentPopup.className = 'french-popup';

  // Build HTML for all definitions
  let popupHTML = '';

  // If we have a conjugation, show it first
  if (conjugationEntry) {
    const displayWord = conjugationEntry.searchedForm ? conjugationEntry.searchedForm : conjugationEntry.headword;
    popupHTML += `
      <div class="french-popup-definition-conjugation">
        <div class="french-popup-word">
          ${escapeHtml(displayWord)}
        </div>
        ${conjugationEntry.inflectionNote ? `<div class="french-popup-inflection">${escapeHtml(conjugationEntry.inflectionNote)}</div>` : ''}
        <div class="french-popup-meta">
          ${conjugationEntry.pos ? `<span class="pos">${escapeHtml(conjugationEntry.pos)}</span>` : ''}
          ${conjugationEntry.pronunciation ? `<span class="pron">[${conjugationEntry.pronunciation}]</span>` : ''}
        </div>
        <div class="french-popup-translations">${formatTranslations(conjugationEntry.translations)}</div>
      </div>
    `;
  }

  // Then show all bilingual definitions
  if (entries && entries.length > 0) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const displayWord = entry.searchedForm ? entry.searchedForm : entry.headword;

      // Show the word for every definition
      const wordHTML = `<div class="french-popup-word">${escapeHtml(displayWord)}</div>`;

      // Check if there are more definitions coming
      const hasMoreDefinitions = i < entries.length - 1;
      const definitionGapClass = showDefinitions && entry.definition && hasMoreDefinitions ? 'with-gap' : '';

      popupHTML += `
        <div class="french-popup-definition-${i}">
          ${wordHTML}
          ${entry.matchedWords && entry.matchedWords > 1 ? `<div class="french-popup-inflection">multi-word expression (${entry.matchedWords} words)</div>` : ''}
          ${entry.inflectionNote ? `<div class="french-popup-inflection">${escapeHtml(entry.inflectionNote)}</div>` : ''}
          <div class="french-popup-meta">
            ${entry.pos ? `<span class="pos">${escapeHtml(entry.pos)}</span>` : ''}
            ${entry.gender ? `<span class="gender">${escapeHtml(entry.gender)}</span>` : ''}
            ${entry.pronunciation ? `<span class="pron">[${entry.pronunciation}]</span>` : ''}
          </div>
          <div class="french-popup-translations">${formatTranslations(entry.translations)}</div>
          ${showDefinitions && entry.definition ? `<div class="french-popup-definition ${definitionGapClass}">${escapeHtml(entry.definition)}</div>` : ''}
        </div>
      `;
    }
  }

  currentPopup.innerHTML = popupHTML;
  document.body.appendChild(currentPopup);

  // Position popup
  const rect = currentPopup.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;

  // Keep within viewport with minimum 10px margins
  if (left + rect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - rect.width - 10);
  }

  // Calculate available space for smarter vertical positioning
  const spaceBelow = window.innerHeight - y;
  const spaceAbove = y;
  const maxPopupHeight = Math.min(window.innerHeight * 0.8, 500);

  if (rect.height > spaceBelow && spaceAbove > spaceBelow) {
    // More space above, flip popup above cursor
    top = y - rect.height - 10;
  } else if (top + rect.height > window.innerHeight - 10) {
    // Ensure minimum 10px margin from bottom
    top = Math.max(10, window.innerHeight - rect.height - 10);
  }

  currentPopup.style.left = `${left + window.scrollX}px`;
  currentPopup.style.top = `${top + window.scrollY}px`;

  // Keep popup visible on hover
  currentPopup.addEventListener('mouseenter', () => {
    clearTimeout(mouseMoveTimer);
    clearTimeout(hidePopupTimer);
  });

  currentPopup.addEventListener('mouseleave', () => {
    // Delay hiding to allow moving back to popup
    hidePopupTimer = setTimeout(() => {
      if (currentPopup && !currentPopup.matches(':hover')) {
        hidePopup();
      }
    }, HIDE_DELAY);
  });
}

/**
 * Format alternate definition (e.g., bilingual entry when word also has conjugation)
 */
function formatAlternateDefinition(altDef, originalWord) {
  if (!altDef) return '';

  if (altDef.type === 'conjugation') {
    return `
      <div class="french-popup-alternate">
        <div class="french-popup-word">
          ${escapeHtml(originalWord)}
        </div>
        <div class="french-popup-inflection">conjugated form of "${escapeHtml(altDef.infinitive)}" (${escapeHtml(altDef.tenseInfo)})</div>
        <div class="french-popup-meta">
          ${altDef.pos ? `<span class="pos">${escapeHtml(altDef.pos)}</span>` : ''}
          ${altDef.pronunciation ? `<span class="pron">[${altDef.pronunciation}]</span>` : ''}
        </div>
        <div class="french-popup-translations">${formatTranslations(altDef.translations)}</div>
      </div>
    `;
  }

  if (altDef.type === 'bilingual') {
    return `
      <div class="french-popup-alternate">
        <div class="french-popup-word">
          ${escapeHtml(altDef.headword || originalWord)}
        </div>
        <div class="french-popup-meta">
          ${altDef.pos ? `<span class="pos">${escapeHtml(altDef.pos)}</span>` : ''}
          ${altDef.gender ? `<span class="gender">${escapeHtml(altDef.gender)}</span>` : ''}
          ${altDef.pronunciation ? `<span class="pron">[${altDef.pronunciation}]</span>` : ''}
        </div>
        <div class="french-popup-translations">${formatTranslations(altDef.translations)}</div>
        ${showDefinitions && altDef.definition ? `<div class="french-popup-definition">${escapeHtml(altDef.definition)}</div>` : ''}
    `;
  }

  return '';
}

/**
 * Format translations (split by semicolon)
 */
function formatTranslations(translations) {
  if (!translations) return '';

  const items = translations.split(';').map(t => t.trim()).filter(t => t);

  if (items.length === 1) {
    return escapeHtml(items[0]);
  }

  return items.map(item => `• ${escapeHtml(item)}`).join('<br>');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Hide popup
 */
function hidePopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
}

/**
 * Toggle extension activation state for the current page
 */
async function toggleExtension() {
  const pageKey = `disabled_${window.location.hostname}`;

  if (isActive) {
    // Disable on this page
    isActive = false;
    hidePopup();
    await chrome.storage.local.set({ [pageKey]: true });
  } else {
    // Enable on this page
    isActive = true;
    attachHoverListeners();
    await chrome.storage.local.set({ [pageKey]: false });
  }
}

/**
 * Listen for messages from popup/background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getStatus') {
    sendResponse({ active: isActive });
  } else if (message.action === 'languageChanged') {
    dictionary.changeLanguage(message.language);
  } else if (message.action === 'settingsChanged') {
    showDefinitions = message.showDefinitions;
  } else if (message.action === 'toggleExtension') {
    toggleExtension().then(() => {
      sendResponse({ success: true, active: isActive });
    });
    return true; // Keep channel open for async response
  }
});

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
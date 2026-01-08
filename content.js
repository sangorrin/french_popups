/**
 * Content Script - Hover Detection and Popup Display
 * Based on translate_onhover's robust hover detection mechanism
 */

let isActive = false;
let isFrenchPage = false;
let currentPopup = null;
const HOVER_DELAY = 400; // ms - delay before showing popup after mouse stops
const lastMouseStop = { x: 0, y: 0 };
let mouseMoveTimer = null;

/**
 * Initialize extension
 */
async function init() {
  console.log('[French Popups] Starting initialization...');
  console.log('[French Popups] Dictionary object available:', typeof dictionary);

  try {
    // Load target language from storage
    const result = await chrome.storage.local.get(['targetLanguage']);
    const targetLang = result.targetLanguage || 'eng';
    console.log('[French Popups] Target language:', targetLang);

    await dictionary.init(targetLang);
    console.log('[French Popups] Dictionary initialized');

    // Detect if page is French
    await detectFrenchPage();
    console.log('[French Popups] French detection complete:', isFrenchPage);

    if (isFrenchPage) {
      isActive = true;
      attachHoverListeners();
      console.log('[French Popups] Hover listeners attached');
    } else {
      console.log('[French Popups] Page not detected as French, listeners NOT attached');
    }

    console.log(`[French Popups] Initialized - Active: ${isActive}, French: ${isFrenchPage}`);
  } catch (error) {
    console.error('[French Popups] Initialization error:', error);
  }
}

/**
 * Three-layer French page detection
 */
async function detectFrenchPage() {
  // Layer 1: HTML lang attribute
  const htmlLang = document.documentElement.lang;
  if (htmlLang && htmlLang.toLowerCase().startsWith('fr')) {
    isFrenchPage = true;
    console.log('[French Popups] French detected via HTML lang attribute');
    return;
  }

  // Layer 2: French character markers
  const bodyText = document.body.textContent.substring(0, 5000);
  const frenchChars = bodyText.match(/[àâäéèêëïîôùûüÿçœæ]/gi);
  const ratio = frenchChars ? frenchChars.length / bodyText.length : 0;

  if (ratio > 0.01) { // >1% French characters
    isFrenchPage = true;
    console.log(`[French Popups] French detected via character analysis (${(ratio * 100).toFixed(2)}%)`);
    return;
  }

  // Layer 3: Dictionary sampling
  const words = extractSampleWords(bodyText, 15);
  let matchCount = 0;

  for (const word of words) {
    if (await dictionary.exists(word)) {
      matchCount++;
    }
  }

  const matchRatio = matchCount / words.length;
  if (matchRatio > 0.4) { // >40% words match dictionary
    isFrenchPage = true;
    console.log(`[French Popups] French detected via dictionary sampling (${matchCount}/${words.length})`);
    return;
  }

  console.log('[French Popups] No French detected');
}

/**
 * Extract sample words for dictionary checking
 */
function extractSampleWords(text, count) {
  const words = text
    .toLowerCase()
    .match(/[a-zàâäéèêëïîôùûüÿçœæ]{4,}/gi) || [];

  const uniqueWords = [...new Set(words)];
  const shuffled = uniqueWords.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Attach hover event listeners using mousestop event pattern
 * Based on translate_onhover's robust implementation
 */
function attachHoverListeners() {
  console.log('[French Popups] Attaching hover listeners');

  // Remove popup on scroll
  document.addEventListener('scroll', () => {
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

    // Hide any existing popup
    hidePopup();
    clearTimeout(mouseMoveTimer);

    // Start timer for mousestop
    mouseMoveTimer = setTimeout(() => {
      lastMouseStop.x = e.clientX;
      lastMouseStop.y = e.clientY;
      handleMouseStop(e);
    }, HOVER_DELAY);
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
  console.log('[French Popups] Mouse stopped, detecting word...');

  const hitElement = document.elementFromPoint(e.clientX, e.clientY);

  if (!hitElement) {
    console.log('[French Popups] No element at point');
    return;
  }

  // Skip inputs and editable elements
  if (hitElement.nodeName === 'INPUT' ||
      hitElement.nodeName === 'TEXTAREA' ||
      hitElement.isContentEditable) {
    console.log('[French Popups] Skipping editable element');
    return;
  }

  // Check if inside editable parent
  let parent = hitElement.parentElement;
  while (parent) {
    if (parent.isContentEditable) {
      console.log('[French Popups] Inside editable parent');
      return;
    }
    parent = parent.parentElement;
  }

  // Get word at point
  const wordData = getHitWord(e);
  console.log('[French Popups] Detected word data:', wordData);

  if (wordData && wordData.word && wordData.word.length >= 2) {
    console.log('[French Popups] Showing popup for:', wordData.word);
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
    console.log('[French Popups] No text nodes found');
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
    console.log('[French Popups] Hit between lines or no text node');
    return null;
  }

  console.log('[French Popups] Hit text node:', hitTextNode.textContent);

  // Get the minimal text segment containing the cursor
  const minimalNode = getMinimalTextNode(hitTextNode, e, originalHitElement);

  if (!minimalNode) {
    console.log('[French Popups] Could not narrow down text');
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
  console.log('[French Popups] showPopup called for:', word, 'with following:', followingText, 'at', x, y);
  hidePopup();

  const entry = await dictionary.lookup(word, followingText);
  console.log('[French Popups] Dictionary lookup result:', entry);

  if (!entry) {
    console.log('[French Popups] No entry found, aborting popup');
    return;
  }

  currentPopup = document.createElement('div');
  currentPopup.className = 'french-popup';

  // Determine what to display as the headword
  const displayWord = entry.searchedForm ? entry.searchedForm : entry.headword;

  currentPopup.innerHTML = `
    <div class="french-popup-word">
      ${escapeHtml(displayWord)}
    </div>
    ${entry.matchedWords && entry.matchedWords > 1 ? `<div class="french-popup-inflection">multi-word expression (${entry.matchedWords} words)</div>` : ''}
    ${entry.inflectionNote ? `<div class="french-popup-inflection">${escapeHtml(entry.inflectionNote)}</div>` : ''}
    <div class="french-popup-meta">
      ${entry.pos ? `<span class="pos">${escapeHtml(entry.pos)}</span>` : ''}
      ${entry.gender ? `<span class="gender">${escapeHtml(entry.gender)}</span>` : ''}
      ${entry.pronunciation ? `<span class="pron">[${escapeHtml(entry.pronunciation)}]</span>` : ''}
    </div>
    <div class="french-popup-translations">${formatTranslations(entry.translations)}</div>
    ${entry.definition ? `<div class="french-popup-definition">${escapeHtml(entry.definition)}</div>` : ''}
  `;

  document.body.appendChild(currentPopup);
  console.log('[French Popups] Popup appended to body');

  // Position popup
  const rect = currentPopup.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;

  // Keep within viewport
  if (left + rect.width > window.innerWidth) {
    left = window.innerWidth - rect.width - 10;
  }

  if (top + rect.height > window.innerHeight) {
    top = y - rect.height - 10;
  }

  currentPopup.style.left = `${left + window.scrollX}px`;
  currentPopup.style.top = `${top + window.scrollY}px`;

  console.log('[French Popups] Popup positioned at:', currentPopup.style.left, currentPopup.style.top);

  // Keep popup visible on hover
  currentPopup.addEventListener('mouseenter', () => {
    clearTimeout(mouseMoveTimer);
  });

  currentPopup.addEventListener('mouseleave', () => {
    hidePopup();
  });
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
 * Force activate the extension on the current page
 */
function forceActivate() {
  console.log('[French Popups] Force activation requested');

  if (!isActive) {
    isActive = true;
    isFrenchPage = true; // Mark as French page
    attachHoverListeners();
    console.log('[French Popups] Extension force-activated');
  } else {
    console.log('[French Popups] Already active');
  }
}

/**
 * Listen for messages from popup/background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getStatus') {
    sendResponse({ active: isActive, french: isFrenchPage });
  } else if (message.action === 'languageChanged') {
    dictionary.changeLanguage(message.language);
  } else if (message.action === 'forceActivate') {
    forceActivate();
    sendResponse({ success: true, active: isActive });
  }
});

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
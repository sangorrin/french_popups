// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 sangorrin

/**
 * Dictionary Lookup Module
 * Handles loading and searching French dictionary files
 */

class Dictionary {
  constructor() {
    this.currentLanguage = 'eng';
    this.indexCache = null;
    this.indexLoaded = false;
    this.conjugationIndexCache = null;
    this.conjugationIndexLoaded = false;
  }

  /**
   * Initialize dictionary with target language
   */
  async init(language) {
    this.currentLanguage = language || 'eng';
    await this.loadIndex();
    await this.loadConjugationIndex();
  }

  /**
   * Load index file into memory
   */
  async loadIndex() {
    const indexPath = chrome.runtime.getURL(`data/fra-${this.currentLanguage}.idx`);

    try {
      const response = await fetch(indexPath);
      if (!response.ok) {
        throw new Error(`Failed to load index: ${response.status}`);
      }

      const indexText = await response.text();

      // Parse index into array of [headword, offset, length]
      this.indexCache = indexText
        .trim()
        .split('\n')
        .map(line => {
          const [headword, offset, length] = line.split('\t');
          return {
            headword: headword.toLowerCase(),
            offset: parseInt(offset, 10),
            length: parseInt(length, 10)
          };
        });

      this.indexLoaded = true;
      console.log(`[French Popups] Loaded ${this.indexCache.length} entries for fra-${this.currentLanguage}`);
      return true;
    } catch (error) {
      console.error('[French Popups] Error loading index:', error);
      this.indexLoaded = false;
      return false;
    }
  }

  /**
   * Load conjugation index file into memory
   */
  async loadConjugationIndex() {
    const indexPath = chrome.runtime.getURL('data/fra.idx');

    try {
      const response = await fetch(indexPath);
      if (!response.ok) {
        throw new Error(`Failed to load conjugation index: ${response.status}`);
      }

      const indexText = await response.text();

      // Parse index into array of [conjugated_form, offset]
      this.conjugationIndexCache = indexText
        .trim()
        .split('\n')
        .map(line => {
          const [conjugatedForm, offset] = line.split('\t');
          return {
            conjugatedForm: conjugatedForm.toLowerCase(),
            offset: parseInt(offset, 10)
          };
        });

      this.conjugationIndexLoaded = true;
      console.log(`[French Popups] Loaded ${this.conjugationIndexCache.length} conjugation entries`);
      return true;
    } catch (error) {
      console.error('[French Popups] Error loading conjugation index:', error);
      this.conjugationIndexLoaded = false;
      return false;
    }
  }

  /**
   * Binary search for headword in sorted index
   */
  binarySearch(headword) {
    if (!this.indexCache || this.indexCache.length === 0) {
      return null;
    }

    const searchTerm = headword.toLowerCase();
    let left = 0;
    let right = this.indexCache.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.indexCache[mid];

      if (entry.headword === searchTerm) {
        return entry;
      } else if (entry.headword < searchTerm) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return null;
  }

  /**
   * Get ALL entries for a headword (since there can be multiple with different POS)
   * Since index is sorted, all duplicates are consecutive
   */
  binarySearchAll(headword) {
    if (!this.indexCache || this.indexCache.length === 0) {
      return [];
    }

    const searchTerm = headword.toLowerCase();
    let left = 0;
    let right = this.indexCache.length - 1;
    let foundIndex = -1;

    // Binary search to find any occurrence
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.indexCache[mid];

      if (entry.headword === searchTerm) {
        foundIndex = mid;
        break;
      } else if (entry.headword < searchTerm) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (foundIndex === -1) {
      return [];
    }

    // Scan backwards to find first occurrence
    let startIndex = foundIndex;
    while (startIndex > 0 && this.indexCache[startIndex - 1].headword === searchTerm) {
      startIndex--;
    }

    // Scan forwards to collect all occurrences
    const results = [];
    let currentIndex = startIndex;
    while (currentIndex < this.indexCache.length && this.indexCache[currentIndex].headword === searchTerm) {
      results.push(this.indexCache[currentIndex]);
      currentIndex++;
    }

    return results;
  }

  /**
   * Binary search for conjugated form in conjugation index
   * Returns the first matching entry (since there can be multiple)
   */
  binarySearchConjugation(conjugatedForm) {
    if (!this.conjugationIndexCache || this.conjugationIndexCache.length === 0) {
      return null;
    }

    const searchTerm = conjugatedForm.toLowerCase();
    let left = 0;
    let right = this.conjugationIndexCache.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.conjugationIndexCache[mid];

      if (entry.conjugatedForm === searchTerm) {
        return entry;
      } else if (entry.conjugatedForm < searchTerm) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return null;
  }

  /**
   * Fetch conjugation entries from fra.u8 file
   * Reads from offset until the conjugated form changes
   */
  async fetchConjugationEntries(offset, conjugatedForm) {
    const u8Path = chrome.runtime.getURL('data/fra.u8');
    const searchTerm = conjugatedForm.toLowerCase();

    try {
      // Read a reasonable chunk (we'll read line by line)
      // Most conjugated forms won't have more than 10-20 entries
      const chunkSize = 10000; // Read 10KB at a time
      const response = await fetch(u8Path, {
        headers: {
          'Range': `bytes=${offset}-${offset + chunkSize - 1}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch conjugation entries: ${response.status}`);
      }

      const text = await response.text();
      const lines = text.split('\n');
      const entries = [];

      // Parse lines until we find a different conjugated form
      for (const line of lines) {
        if (!line.trim()) continue;

        const parsed = this.parseConjugationEntry(line);
        if (!parsed) continue;

        // Stop when we encounter a different conjugated form
        if (parsed.conjugatedForm.toLowerCase() !== searchTerm) {
          break;
        }

        entries.push(parsed);
      }

      // Return the first entry (most likely the standard form)
      return entries.length > 0 ? entries[0] : null;
    } catch (error) {
      console.error('[French Popups] Error fetching conjugation entries:', error);
      return null;
    }
  }

  /**
   * Parse conjugation entry line
   * Format: conjugated_form<TAB>infinitive<TAB>tense(s)<TAB>ipa(s)<TAB>full_form
   */
  parseConjugationEntry(line) {
    const fields = line.split('\t');
    if (fields.length < 4) {
      return null;
    }

    return {
      conjugatedForm: fields[0],
      infinitive: fields[1],
      tenses: fields[2],
      ipas: fields[3],
      fullForm: fields[4] || fields[0]  // Use conjugatedForm as fullForm if not present
    };
  }

  /**
   * Format tense information for display
   * Example: "indicative;present" -> "indicative present"
   * Example: "imperative;present" -> "imperative"
   */
  formatTenseInfo(tenses, fullForm) {
    if (!tenses) return '';

    const parts = tenses.split(';');

    // Extract person/number from fullForm if present
    let personNumber = '';
    if (fullForm) {
      // Check for pronouns: je, tu, il/elle/on, nous, vous, ils/elles
      if (fullForm.startsWith('je ')) personNumber = '1st person singular';
      else if (fullForm.startsWith('tu ')) personNumber = '2nd person singular';
      else if (fullForm.match(/^(il|elle|on)\s/)) personNumber = '3rd person singular';
      else if (fullForm.startsWith('nous ')) personNumber = '1st person plural';
      else if (fullForm.startsWith('vous ')) personNumber = '2nd person plural';
      else if (fullForm.match(/^(ils|elles)\s/)) personNumber = '3rd person plural';
      else if (fullForm.match(/^qu['']?(il|elle|on)\s/)) personNumber = '3rd person singular';
      else if (fullForm.match(/^qu['']?(ils|elles)\s/)) personNumber = '3rd person plural';
      else if (fullForm.match(/^que\s+(je|j[''])\s/)) personNumber = '1st person singular';
      else if (fullForm.match(/^que\s+tu\s/)) personNumber = '2nd person singular';
      else if (fullForm.match(/^que\s+nous\s/)) personNumber = '1st person plural';
      else if (fullForm.match(/^que\s+vous\s/)) personNumber = '2nd person plural';
    }

    // Build tense description
    let tenseDesc = parts.join(' ');

    // Add person/number if present
    if (personNumber) {
      tenseDesc = `${tenseDesc}, ${personNumber}`;
    }

    return tenseDesc;
  }

  /**
   * Fetch dictionary entry from .u8 file
   */
  async fetchEntry(offset, length) {
    const u8Path = chrome.runtime.getURL(`data/fra-${this.currentLanguage}.u8`);

    try {
      const response = await fetch(u8Path, {
        headers: {
          'Range': `bytes=${offset}-${offset + length - 1}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch entry: ${response.status}`);
      }

      const text = await response.text();
      return this.parseEntry(text);
    } catch (error) {
      console.error('[French Popups] Error fetching entry:', error);
      return null;
    }
  }

  /**
   * Parse TSV entry line
   */
  parseEntry(line) {
    // Remove trailing newline but keep trailing tabs
    const trimmedLine = line.replace(/\n$/, '');
    const fields = trimmedLine.split('\t');

    // All dictionary entries should have 6 tab-separated fields
    // If a line ends with a tab, the 6th field is empty
    if (fields.length < 5) {
      console.warn('[Dict] Invalid entry format, expected at least 5 fields but got:', fields.length);
      return null;
    }

    // Pad with empty strings if needed (for entries ending with tab)
    while (fields.length < 6) {
      fields.push('');
    }

    // Unescape fields
    const unescape = (str) => {
      if (!str) return '';
      return str
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\');
    };

    return {
      headword: unescape(fields[0]),
      pos: unescape(fields[1]),
      gender: unescape(fields[2]),
      pronunciation: unescape(fields[3]),
      translations: unescape(fields[4]),
      definition: unescape(fields[5])
    };
  }

  /**
   * Look up a French word/expression and return definition
   * If followingText is provided, tries to find multi-word expressions
   */
  async lookup(word, followingText = '') {
    console.log('[Dict] Looking up word:', word, 'with following text:', followingText);

    if (!this.indexLoaded) {
      console.log('[Dict] Index not loaded, loading now...');
      await this.loadIndex();
    }

    if (!this.indexLoaded) {
      console.log('[Dict] Failed to load index');
      return null;
    }

    // Normalize the word for lookup (NFC normalization + lowercase + apostrophe normalization)
    // Convert straight apostrophes (') to curly apostrophes (') to match dictionary format
    let normalizedWord = word.normalize('NFC').toLowerCase();
    normalizedWord = normalizedWord.replace(/'/g, '\u2019');  // U+0027 -> U+2019
    console.log('[Dict] Normalized word:', normalizedWord);

    // If we have following text, try to find multi-word expressions first
    if (followingText && followingText.trim().length > 0) {
      const multiWordResult = await this.lookupMultiWord(normalizedWord, followingText);
      if (multiWordResult) {
        console.log('[Dict] Found multi-word expression:', multiWordResult.headword);
        return multiWordResult;
      }
    }

    // Try exact match
    let indexEntry = this.binarySearch(normalizedWord);
    console.log('[Dict] Binary search result:', indexEntry);

    let searchedForm = normalizedWord; // Track what form we searched for

    // If no exact match, try plural-to-singular heuristics
    if (!indexEntry) {
      console.log('[Dict] Exact match not found, trying plural heuristics...');
      const candidates = this.getPluralCandidates(normalizedWord);

      for (const candidate of candidates) {
        console.log('[Dict] Trying plural candidate:', candidate);
        const indexEntries = this.binarySearchAll(candidate);

        if (indexEntries.length > 0) {
          console.log('[Dict] Found', indexEntries.length, 'candidate(s) in index for:', candidate);

          // Try each entry until we find a valid one
          for (const indexEntry of indexEntries) {
            const entry = await this.fetchEntry(indexEntry.offset, indexEntry.length);
            console.log('[Dict] Checking entry - POS:', entry?.pos, 'Gender:', entry?.gender);

            if (entry && this.isValidPluralTransformation(normalizedWord, entry.headword, entry.pos)) {
              // Valid transformation!
              entry.searchedForm = normalizedWord;
              entry.inflectionNote = this.getInflectionNote(normalizedWord, entry.headword);
              console.log('[Dict] Validated plural form - POS:', entry.pos);
              return entry;
            } else {
              console.log('[Dict] Invalid plural transformation for this entry');
            }
          }
        }

        // If the plural candidate ends with 'e', try converting it from feminine to masculine
        if (candidate.endsWith('e')) {
          console.log('[Dict] Plural candidate ends with e, trying feminine-to-masculine conversion...');
          const feminineToMasculineCandidates = this.getFeminineCandidates(candidate);

          for (const masculineCandidate of feminineToMasculineCandidates) {
            console.log('[Dict] Trying feminine-to-masculine from plural candidate:', masculineCandidate);
            const masculineIndexEntries = this.binarySearchAll(masculineCandidate);

            if (masculineIndexEntries.length > 0) {
              for (const indexEntry of masculineIndexEntries) {
                const entry = await this.fetchEntry(indexEntry.offset, indexEntry.length);

                if (entry && this.isValidFeminineTransformation(candidate, entry.headword, entry.pos, entry.gender)) {
                  entry.searchedForm = normalizedWord;
                  entry.inflectionNote = this.getInflectionNote(normalizedWord, entry.headword);
                  entry.gender = 'f'; // Mark as feminine since we found it as a feminine form
                  console.log('[Dict] Validated feminine-to-masculine from plural form - POS:', entry.pos);
                  return entry;
                }
              }
            }
          }
        }
      }
    }

    // If still not found, try feminine-to-masculine heuristics
    if (!indexEntry) {
      console.log('[Dict] Trying feminine-to-masculine heuristics...');
      const masculineCandidates = this.getFeminineCandidates(normalizedWord);

      for (const candidate of masculineCandidates) {
        console.log('[Dict] Trying feminine candidate:', candidate);
        const indexEntries = this.binarySearchAll(candidate);

        if (indexEntries.length > 0) {
          console.log('[Dict] Found', indexEntries.length, 'candidate(s) in index for:', candidate);

          // Try each entry until we find a valid one
          for (const indexEntry of indexEntries) {
            const entry = await this.fetchEntry(indexEntry.offset, indexEntry.length);
            console.log('[Dict] Checking entry - POS:', entry?.pos, 'Gender:', entry?.gender);

            if (entry && this.isValidFeminineTransformation(normalizedWord, entry.headword, entry.pos, entry.gender)) {
              // Valid transformation!
              entry.searchedForm = normalizedWord;
              entry.inflectionNote = this.getFeminineInflectionNote(normalizedWord, entry.headword);
              entry.gender = 'f'; // Mark as feminine since we found it as a feminine form
              console.log('[Dict] Validated feminine form - POS:', entry.pos, 'Gender:', entry.gender);
              return entry;
            } else {
              console.log('[Dict] Invalid feminine transformation for this entry');
            }
          }
        }
      }
    }

    // If still not found, try conjugation lookup
    if (!indexEntry) {
      console.log('[Dict] Trying conjugation lookup...');

      // First try direct conjugation lookup
      let conjugationResult = await this.lookupConjugation(normalizedWord);

      // If not found and word ends with 'e' (possible feminine form), try masculine form
      if (!conjugationResult && normalizedWord.endsWith('e')) {
        console.log('[Dict] Conjugation lookup failed, trying to convert feminine to masculine...');
        const masculineCandidates = this.getFeminineCandidates(normalizedWord);

        for (const candidate of masculineCandidates) {
          console.log('[Dict] Trying conjugation lookup with masculine candidate:', candidate);
          conjugationResult = await this.lookupConjugation(candidate);
          if (conjugationResult) {
            console.log('[Dict] Found conjugation with masculine form:', candidate);
            break;
          }
        }
      }

      // If still not found and word ends with 's' (possible plural), try singular forms
      if (!conjugationResult && normalizedWord.endsWith('s')) {
        console.log('[Dict] Conjugation lookup failed, trying to convert plural to singular...');
        const singularCandidates = this.getPluralCandidates(normalizedWord);

        for (const candidate of singularCandidates) {
          console.log('[Dict] Trying conjugation lookup with singular candidate:', candidate);
          conjugationResult = await this.lookupConjugation(candidate);
          if (conjugationResult) {
            console.log('[Dict] Found conjugation with singular form:', candidate);
            break;
          }

          // If singular still not found and it ends with 'e', try feminine-to-masculine
          if (!conjugationResult && candidate.endsWith('e')) {
            console.log('[Dict] Trying feminine-to-masculine on plural candidate:', candidate);
            const feminineToMasculine = this.getFeminineCandidates(candidate);
            for (const mascCandidate of feminineToMasculine) {
              console.log('[Dict] Trying conjugation with masculine form from plural:', mascCandidate);
              conjugationResult = await this.lookupConjugation(mascCandidate);
              if (conjugationResult) {
                console.log('[Dict] Found conjugation with masculine form from plural:', mascCandidate);
                break;
              }
            }
          }

          if (conjugationResult) break;
        }
      }

      if (conjugationResult) {
        console.log('[Dict] Found conjugation, looking up infinitive:', conjugationResult.infinitive);

        // Now lookup the infinitive in the main dictionary
        const infinitiveEntry = await this.lookupInfinitive(conjugationResult.infinitive);

        if (infinitiveEntry) {
          // Augment the entry with conjugation info
          infinitiveEntry.searchedForm = normalizedWord;
          infinitiveEntry.conjugationInfo = conjugationResult;

          // Create inflection note
          const tenseInfo = this.formatTenseInfo(conjugationResult.tenses, conjugationResult.fullForm);
          infinitiveEntry.inflectionNote = `conjugated form of "${conjugationResult.infinitive}" (${tenseInfo})`;

          // Override pronunciation with conjugated form's IPA
          if (conjugationResult.ipas) {
            infinitiveEntry.pronunciation = conjugationResult.ipas;
          }

          console.log('[Dict] Successfully augmented infinitive entry with conjugation info');
          return infinitiveEntry;
        } else {
          console.log('[Dict] Could not find infinitive in dictionary');
        }
      }
    }

    // If still not found, try removing contractions
    if (!indexEntry) {
      const contractionResult = this.tryRemoveContraction(normalizedWord);
      if (contractionResult) {
        console.log('[Dict] Trying after removing contraction:', contractionResult.prefix, '+', contractionResult.word);

        // Try lookup with the de-contracted word
        const decontractedEntry = await this.lookup(contractionResult.word, followingText);
        if (decontractedEntry) {
          // Add note about the contraction
          decontractedEntry.contractionPrefix = contractionResult.prefix;
          decontractedEntry.originalSearched = normalizedWord;
          return decontractedEntry;
        }
      }
    }

    if (!indexEntry) {
      console.log('[Dict] Word not found in index (even after heuristics)');
      return null;
    }

    // Fetch full entry from .u8 file (exact match)
    console.log('[Dict] Fetching entry at offset:', indexEntry.offset, 'length:', indexEntry.length);
    const entry = await this.fetchEntry(indexEntry.offset, indexEntry.length);
    console.log('[Dict] Fetched entry:', entry);

    return entry;
  }

  /**
   * Look up multi-word expressions starting with a given word
   * Returns the longest matching expression, or null if no multi-word match found
   */
  async lookupMultiWord(firstWord, followingText) {
    console.log('[Dict] Looking for multi-word expressions starting with:', firstWord);

    // Find the position of the first word in the index
    const firstWordLower = firstWord.toLowerCase();
    let startIndex = -1;

    // Binary search to find the first occurrence of entries starting with firstWord
    let left = 0;
    let right = this.indexCache.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.indexCache[mid];

      if (entry.headword === firstWordLower) {
        startIndex = mid;
        // Find the very first occurrence
        while (startIndex > 0 && this.indexCache[startIndex - 1].headword === firstWordLower) {
          startIndex--;
        }
        break;
      } else if (entry.headword < firstWordLower) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // If we didn't find exact match, find where entries starting with firstWord would be
    if (startIndex === -1) {
      startIndex = left;
    }

    // Collect all candidate multi-word expressions starting with firstWord
    const candidates = [];
    let currentIndex = startIndex;

    // Scan forward to find all entries that start with our first word
    while (currentIndex < this.indexCache.length) {
      const entry = this.indexCache[currentIndex];
      const entryWords = entry.headword.split(/\s+/);

      // Stop if we've moved past entries starting with our first word
      if (!entry.headword.startsWith(firstWordLower)) {
        // Also check if it starts with firstWord followed by space
        if (entryWords[0] !== firstWordLower) {
          break;
        }
      }

      // Only consider entries with more than one word
      if (entryWords.length > 1 && entryWords[0] === firstWordLower) {
        candidates.push(entry);
      } else if (entry.headword === firstWordLower) {
        // Store single-word entry as fallback
        candidates.push(entry);
      }

      currentIndex++;
    }

    console.log('[Dict] Found', candidates.length, 'candidate expressions');

    // Now match against the following text
    // Normalize following text
    const normalizedFollowing = followingText.normalize('NFC').toLowerCase();
    const words = normalizedFollowing.split(/\s+/).filter(w => w.length > 0);

    let longestMatch = null;
    let longestMatchWordCount = 1; // At least the first word

    for (const candidate of candidates) {
      const candidateWords = candidate.headword.split(/\s+/);

      // Single word entries don't count as multi-word
      if (candidateWords.length === 1) {
        continue;
      }

      // Check if the remaining words match
      let matched = true;
      const remainingWords = candidateWords.slice(1); // Skip first word (already matched)

      for (let i = 0; i < remainingWords.length; i++) {
        if (i >= words.length || words[i] !== remainingWords[i]) {
          matched = false;
          break;
        }
      }

      if (matched && candidateWords.length > longestMatchWordCount) {
        longestMatch = candidate;
        longestMatchWordCount = candidateWords.length;
      }
    }

    if (longestMatch && longestMatchWordCount > 1) {
      console.log('[Dict] Found multi-word match:', longestMatch.headword, '(' + longestMatchWordCount + ' words)');
      const entry = await this.fetchEntry(longestMatch.offset, longestMatch.length);
      if (entry) {
        entry.matchedWords = longestMatchWordCount; // Add metadata about how many words were matched
      }
      return entry;
    }

    console.log('[Dict] No multi-word expression matched');
    return null;
  }

  /**
   * Look up a conjugated form in the conjugation dictionary
   */
  async lookupConjugation(conjugatedForm) {
    if (!this.conjugationIndexLoaded) {
      console.log('[Dict] Conjugation index not loaded');
      return null;
    }

    const indexEntry = this.binarySearchConjugation(conjugatedForm);
    if (!indexEntry) {
      console.log('[Dict] Conjugated form not found in conjugation index');
      return null;
    }

    console.log('[Dict] Found conjugation at offset:', indexEntry.offset);
    const conjugationEntry = await this.fetchConjugationEntries(indexEntry.offset, conjugatedForm);

    return conjugationEntry;
  }

  /**
   * Look up infinitive form in the dictionary (bypassing heuristics)
   */
  async lookupInfinitive(infinitive) {
    const normalizedInfinitive = infinitive.normalize('NFC').toLowerCase();

    // Get all entries for this infinitive
    const indexEntries = this.binarySearchAll(normalizedInfinitive);

    if (indexEntries.length === 0) {
      return null;
    }

    // If multiple entries exist, prefer verb entries
    for (const indexEntry of indexEntries) {
      const entry = await this.fetchEntry(indexEntry.offset, indexEntry.length);
      // Check if this is a verb entry
      if (entry && entry.pos && (entry.pos === 'v' || entry.pos.includes('verb'))) {
        return entry;
      }
    }

    // If no verb entry found, return the first entry
    const entry = await this.fetchEntry(indexEntries[0].offset, indexEntries[0].length);
    return entry;
  }

  /**
   * Try to remove French contractions from the beginning of a word
   * Returns {prefix, word} if contraction found, null otherwise
   *
   * French contractions:
   * l' = le/la (the) → l'amour, l'arrêt
   * d' = de (of/from) → d'ailleurs, d'abord
   * c' = ce (this/it) → c'est
   * j' = je (I) → j'aime
   * m' = me (me) → m'aide
   * t' = te (you) → t'aime
   * n' = ne (negation) → n'est
   * s' = se (reflexive) → s'appelle
   * qu' = que (that/what) → qu'il
   */
  tryRemoveContraction(word) {
    if (!word || word.length < 3) {
      return null;
    }

    const contractions = ['qu\u2019', 'l\u2019', 'd\u2019', 'c\u2019', 'j\u2019', 'm\u2019', 't\u2019', 'n\u2019', 's\u2019'];

    for (const contraction of contractions) {
      if (word.startsWith(contraction)) {
        return {
          prefix: contraction,
          word: word.substring(contraction.length)
        };
      }
    }

    return null;
  }

  /**
   * Get all possible singular candidates for a plural word
   * Returns array of candidates to try (most likely first)
   */
  getPluralCandidates(word) {
    const candidates = [];

    // Must be at least 3 characters
    if (word.length < 3) {
      return candidates;
    }

    // Check -eaux ending (noun: -eau → -eaux; adj: -eau → -eaux)
    if (word.endsWith('eaux')) {
      candidates.push(word.slice(0, -1)); // Remove x: eaux → eau
    }

    // Check -aux ending (noun: -al/-au/-ail → -aux; adj: -al → -aux)
    if (word.endsWith('aux')) {
      const stem = word.slice(0, -3);
      candidates.push(stem + 'al');   // Most common
      candidates.push(stem + 'au');   // Less common
      candidates.push(stem + 'ail');  // Rare
    }

    // Check -eux ending (noun: -eu → -eux)
    if (word.endsWith('eux') && !word.endsWith('ieux')) {
      candidates.push(word.slice(0, -1)); // Remove x: eux → eu
    }

    // Check -oux ending (noun: -ou → -oux, small set of exceptions)
    if (word.endsWith('oux')) {
      candidates.push(word.slice(0, -1)); // Remove x: oux → ou
    }

    // Basic rule: if ends with 's', try removing it
    if (word.endsWith('s') && word.length > 2) {
      candidates.push(word.slice(0, -1));
    }

    return candidates;
  }

  /**
   * Validate that a plural→singular transformation is valid for the given POS
   */
  isValidPluralTransformation(pluralForm, singularForm, pos) {
    // If no POS, we can't validate - but allow common patterns for nouns
    if (!pos || pos.trim() === '') {
      console.log('[Dict] No POS provided, allowing common noun plural patterns');
      // Allow common noun patterns even without POS
      if (pluralForm.endsWith('aux') && singularForm.endsWith('al')) return true;
      if (pluralForm.endsWith('aux') && singularForm.endsWith('au')) return true;
      if (pluralForm.endsWith('aux') && singularForm.endsWith('ail')) return true;
      if (pluralForm.endsWith('eaux') && singularForm.endsWith('eau')) return true;
      if (pluralForm.endsWith('eux') && singularForm.endsWith('eu')) return true;
      if (pluralForm.endsWith('oux') && singularForm.endsWith('ou')) return true;
      if (pluralForm.endsWith('s') && !singularForm.endsWith('s')) return true;
      return false;
    }

    const posLower = pos.toLowerCase().trim();

    // Only nouns and adjectives can pluralize
    if (posLower !== 'n' && posLower !== 'adj') {
      return false;
    }

    // Check transformation validity based on POS
    if (posLower === 'n') {
      // Noun plural rules
      if (pluralForm.endsWith('aux') && singularForm.endsWith('al')) return true;
      if (pluralForm.endsWith('aux') && singularForm.endsWith('au')) return true;
      if (pluralForm.endsWith('aux') && singularForm.endsWith('ail')) return true;
      if (pluralForm.endsWith('eaux') && singularForm.endsWith('eau')) return true;
      if (pluralForm.endsWith('eux') && singularForm.endsWith('eu')) return true;
      if (pluralForm.endsWith('oux') && singularForm.endsWith('ou')) return true;
      if (pluralForm.endsWith('s') && !singularForm.endsWith('s')) return true;
    } else if (posLower === 'adj') {
      // Adjective plural rules (more limited)
      if (pluralForm.endsWith('aux') && singularForm.endsWith('al')) return true;
      if (pluralForm.endsWith('eaux') && singularForm.endsWith('eau')) return true;
      if (pluralForm.endsWith('s') && !singularForm.endsWith('s')) return true;
    }

    return false;
  }

  /**
   * Get all possible masculine candidates for a feminine word
   * Returns array of candidates to try (most likely first)
   */
  getFeminineCandidates(word) {
    const candidates = [];

    // Must end with 'e' and be at least 3 characters
    if (!word.endsWith('e') || word.length < 3) {
      return candidates;
    }

    const stem = word.slice(0, -1); // Remove final 'e'

    // CHECK MORE SPECIFIC PATTERNS FIRST!
    // Note: stem has 'e' removed, so patterns don't include final 'e'

    // -ienne ending: chrétienne → stem="chrétien", check "ienn"
    if (stem.endsWith('ienn')) {
      candidates.push(stem.slice(0, -1)); // Remove last 'n': chrétienn → chrétien
      return candidates;
    }

    // -teuse ending (MUST check before -euse since "teus" ends with "eus")
    if (stem.endsWith('teus')) {
      const base = word.slice(0, -5); // Remove "teuse"
      candidates.push(base + 'teur'); // menteuse → menteur
      return candidates;
    }

    // -euse ending (check after -teuse)
    if (stem.endsWith('eus')) {
      const base = word.slice(0, -4); // Remove "euse" from original word
      candidates.push(base + 'eux'); // heureuse → heureux
      return candidates;
    }

    // -rice ending
    if (stem.endsWith('ric')) {
      const base = word.slice(0, -4); // Remove "rice"
      candidates.push(base + 'teur'); // actrice → acteur
      candidates.push(base + 'eur'); // Sometimes -rice → -eur
      return candidates;
    }

    // -ère ending
    if (stem.endsWith('èr')) {
      const base = word.slice(0, -3); // Remove "ère"
      candidates.push(base + 'er'); // première → premier
      return candidates;
    }

    // -elle ending
    if (stem.endsWith('ell')) {
      const base = word.slice(0, -4); // Remove "elle"
      candidates.push(base + 'el'); // cruelle → cruel
      return candidates;
    }

    // -enne ending (general, must be after -ienne)
    if (stem.endsWith('enn')) {
      const base = word.slice(0, -4); // Remove "enne"
      candidates.push(base + 'en'); // ancienne → ancien
      return candidates;
    }

    // -onne ending
    if (stem.endsWith('onn')) {
      const base = word.slice(0, -4); // Remove "onne"
      candidates.push(base + 'on'); // bonne → bon
      return candidates;
    }

    // -inne ending
    if (stem.endsWith('inn')) {
      const base = word.slice(0, -4); // Remove "inne"
      candidates.push(base + 'in'); // Some -inne → -in
      return candidates;
    }

    // -ette ending
    if (stem.endsWith('ett')) {
      const base = word.slice(0, -4); // Remove "ette"
      candidates.push(base + 'et'); // complette → complet
      return candidates;
    }

    // -ve ending
    if (stem.endsWith('v')) {
      const base = word.slice(0, -2); // Remove "ve"
      candidates.push(base + 'f'); // active → actif, neuve → neuf
      return candidates;
    }

    // -se ending (less specific, check after -euse)
    if (stem.endsWith('s')) {
      const base = word.slice(0, -2); // Remove "se"
      candidates.push(base + 'x'); // française → français
      return candidates;
    }

    // Spelling protection patterns
    if (stem.endsWith('qu')) {
      const base = word.slice(0, -3); // Remove "que"
      candidates.push(base + 'c'); // publique → public
      return candidates;
    }

    if (stem.endsWith('ch')) {
      const base = word.slice(0, -3); // Remove "che"
      candidates.push(base + 'c'); // blanche → blanc
      return candidates;
    }

    if (stem.endsWith('gu')) {
      const base = word.slice(0, -3); // Remove "gue"
      candidates.push(base + 'g'); // longue → long
      return candidates;
    }

    // Basic rule: just remove the 'e' (fatiguée → fatigué)
    candidates.push(stem);

    return candidates;
  }

  /**
   * Validate that a feminine→masculine transformation is valid
   */
  isValidFeminineTransformation(feminineForm, masculineForm, pos, gender) {
    // If no POS or gender, allow common patterns
    if (!pos || pos.trim() === '' || !gender || gender.trim() === '') {
      console.log('[Dict] No POS/gender provided, allowing common feminine patterns');
      // Check if this looks like a valid feminine transformation
      if (!feminineForm.endsWith('e')) return false;

      // Check known patterns
      if (feminineForm.endsWith('ienne') && masculineForm.endsWith('ien')) return true;
      if (feminineForm.endsWith('enne') && masculineForm.endsWith('en')) return true;
      if (feminineForm.endsWith('onne') && masculineForm.endsWith('on')) return true;
      if (feminineForm.endsWith('inne') && masculineForm.endsWith('in')) return true;
      if (feminineForm.endsWith('elle') && masculineForm.endsWith('el')) return true;
      if (feminineForm.endsWith('ette') && masculineForm.endsWith('et')) return true;
      if (feminineForm.endsWith('ve') && masculineForm.endsWith('f')) return true;
      if (feminineForm.endsWith('se') && masculineForm.endsWith('x')) return true;
      if (feminineForm.endsWith('ère') && masculineForm.endsWith('er')) return true;
      if (feminineForm.endsWith('euse') && masculineForm.endsWith('eux')) return true;
      if (feminineForm.endsWith('rice') && masculineForm.endsWith('teur')) return true;
      if (feminineForm.endsWith('rice') && masculineForm.endsWith('eur')) return true;
      if (feminineForm.endsWith('teuse') && masculineForm.endsWith('teur')) return true;
      if (feminineForm.endsWith('que') && masculineForm.endsWith('c')) return true;
      if (feminineForm.endsWith('che') && masculineForm.endsWith('c')) return true;
      if (feminineForm.endsWith('gue') && masculineForm.endsWith('g')) return true;

      // Basic pattern: feminine = masculine + e
      const femStem = feminineForm.slice(0, -1);
      if (femStem === masculineForm) return true;

      return false;
    }

    const posLower = pos.toLowerCase().trim();
    const genderLower = gender.toLowerCase().trim();

    // Only nouns and adjectives have gender
    if (posLower !== 'n' && posLower !== 'adj') {
      return false;
    }

    // Must be masculine in the dictionary
    if (genderLower !== 'm') {
      return false;
    }

    // Feminine must end with 'e', masculine must not (or be different)
    if (!feminineForm.endsWith('e')) {
      return false;
    }

    // Validate specific transformation patterns
    const femStem = feminineForm.slice(0, -1);

    // Check known patterns
    if (feminineForm.endsWith('ienne') && masculineForm.endsWith('ien')) return true;
    if (feminineForm.endsWith('enne') && masculineForm.endsWith('en')) return true;
    if (feminineForm.endsWith('onne') && masculineForm.endsWith('on')) return true;
    if (feminineForm.endsWith('inne') && masculineForm.endsWith('in')) return true;
    if (feminineForm.endsWith('elle') && masculineForm.endsWith('el')) return true;
    if (feminineForm.endsWith('ette') && masculineForm.endsWith('et')) return true;
    if (feminineForm.endsWith('ve') && masculineForm.endsWith('f')) return true;
    if (feminineForm.endsWith('se') && masculineForm.endsWith('x')) return true;
    if (feminineForm.endsWith('ère') && masculineForm.endsWith('er')) return true;
    if (feminineForm.endsWith('euse') && masculineForm.endsWith('eux')) return true;
    if (feminineForm.endsWith('rice') && masculineForm.endsWith('teur')) return true;
    if (feminineForm.endsWith('rice') && masculineForm.endsWith('eur')) return true;
    if (feminineForm.endsWith('teuse') && masculineForm.endsWith('teur')) return true;
    if (feminineForm.endsWith('que') && masculineForm.endsWith('c')) return true;
    if (feminineForm.endsWith('che') && masculineForm.endsWith('c')) return true;
    if (feminineForm.endsWith('gue') && masculineForm.endsWith('g')) return true;

    // Basic pattern: feminine = masculine + e
    if (femStem === masculineForm) return true;

    return false;
  }

  /**
   * Get inflection note for feminine forms
   */
  getFeminineInflectionNote(feminineForm, masculineForm) {
    return `feminine of "${masculineForm}"`;
  }

  /**
   * Get a note explaining the inflection
   */
  getInflectionNote(searchedForm, baseForm) {
    if (searchedForm.endsWith('s') && !baseForm.endsWith('s')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('aux') && baseForm.endsWith('al')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('aux') && baseForm.endsWith('au')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('aux') && baseForm.endsWith('ail')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('eaux') && baseForm.endsWith('eau')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('eux') && baseForm.endsWith('eu')) {
      return `plural of "${baseForm}"`;
    }
    if (searchedForm.endsWith('oux') && baseForm.endsWith('ou')) {
      return `plural of "${baseForm}"`;
    }
    return `inflected form of "${baseForm}"`;
  }

  /**
   * Check if a part of speech can have plural forms
   * Only nouns and adjectives typically pluralize
   */
  isPluralizable(pos) {
    if (!pos) return false;

    const posLower = pos.toLowerCase().trim();

    // Exact values from our TEI dictionary
    if (posLower === 'n' || posLower === 'adj') {
      return true;
    }

    return false;
  }

  /**
   * Check if a word exists in dictionary (for French detection)
   */
  async exists(word) {
    if (!this.indexLoaded) {
      await this.loadIndex();
    }

    const indexEntry = this.binarySearch(word);
    return indexEntry !== null;
  }

  /**
   * Change target language
   */
  async changeLanguage(language) {
    if (language !== this.currentLanguage) {
      this.currentLanguage = language;
      this.indexCache = null;
      this.indexLoaded = false;
      await this.loadIndex();
    }
  }
}

// Create singleton instance
const dictionary = new Dictionary();

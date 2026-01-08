# 🇫🇷 French Popups

A Chrome extension for instant French-to-multilanguage dictionary lookups. Hover over any French word on a webpage to see translations in your preferred language.

## Features

✨ **Instant Translations**: Hover over French words to see instant translations
🌍 **23 Languages**: Support for English, Spanish, German, Italian, Portuguese, and 18+ more
🔒 **100% Offline**: All dictionaries stored locally for privacy and speed
🎯 **Smart Detection**: Automatically activates on French pages
📚 **122,000+ Words**: Comprehensive dictionaries from WikDict/Wiktionary
🎨 **Beautiful UI**: Clean, professional popup design with French colors

## Supported Languages

- 🇬🇧 English (eng) - 122,147 entries
- 🇪🇸 Spanish (spa) - 52,659 entries
- 🇩🇪 German (deu)
- 🇮🇹 Italian (ita)
- 🇵🇹 Portuguese (por)
- 🇷🇺 Russian (rus)
- 🇳🇱 Dutch (nld)
- 🇵🇱 Polish (pol)
- 🇨🇿 Czech (ces)
- And 14 more languages!

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `french-popups` folder
6. The extension icon will appear in your toolbar

## Usage

1. **Automatic Activation**: Visit any French website - the extension will automatically detect French content and activate
2. **Choose Language**: Click the extension icon to select your preferred translation language
3. **Hover to Translate**: Simply hover your mouse over any French word to see its translation
4. **Manual Override**: Force enable/disable on any page via the extension popup

## How It Works

### Three-Layer French Detection

1. **HTML lang attribute**: Checks `<html lang="fr">` tag
2. **Character analysis**: Scans for French-specific accented characters (à, é, ç, etc.)
3. **Dictionary sampling**: Verifies random words against French dictionary

### Dictionary Format

- **`.u8` files**: UTF-8 tab-separated dictionary entries (headword, POS, gender, pronunciation, translations, definition)
- **`.idx` files**: Sorted binary-searchable index for O(log n) lookups

## Development

### File Structure

```
french-popups/
├── manifest.json          # Extension manifest
├── background.js          # Service worker
├── dict.js               # Dictionary lookup module
├── content.js            # Hover detection & popup display
├── content.css           # Popup styling
├── popup.html/css/js     # Extension popup UI
├── icons/                # Extension icons
└── data/                 # Dictionary files (.u8 + .idx)
```

### Dictionary Generation

Dictionaries are generated from WikDict TEI files using:

```bash
# Download latest dictionaries
cd DRIVE/wikdict
python3 wikdict_fra_xxx_downloader.py

# Convert to .u8/.idx format
python3 tei2utf8.py
```

## Credits

- **Dictionaries**: [WikDict](http://www.wikdict.com/) (Wiktionary-based)
- **Source Data**: [Wiktionary.org](https://www.wiktionary.org/) via [DBnary](http://kaiko.getalp.org/about-dbnary/)
- **License**: Creative Commons Attribution-ShareAlike 3.0 Unported

## Privacy

All dictionary lookups happen **100% offline** on your device. No data is sent to external servers.

## Version

**1.0.0** - Initial release (January 2026)

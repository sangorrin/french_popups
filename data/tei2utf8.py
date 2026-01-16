#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 sangorrin

"""
TEI to UTF-8 Dictionary Converter

Converts FreeDict/WikDict TEI XML dictionaries to:
- .u8: UTF-8 tab-separated format (headword, pos, gender, pron, translations, definition)
- .idx: Sorted index for binary search (headword_lower, byte_offset, byte_length)

Processes all *.tei files in the current directory.
"""

# pylint: disable=c-extension-no-member

import sys
import unicodedata
from pathlib import Path
from typing import Optional, Tuple

try:
    from lxml import etree
except ImportError:
    print("Error: lxml library is required. Install with: pip install lxml")
    sys.exit(1)


# TEI namespace
TEI_NS = "{http://www.tei-c.org/ns/1.0}"


def normalize_text(text: Optional[str]) -> str:
    """Normalize text: strip whitespace, apply NFC Unicode normalization."""
    if not text:
        return ""
    # Strip and normalize to NFC (canonical composition)
    normalized = unicodedata.normalize('NFC', text.strip())
    return normalized


def get_index_key(headword: str) -> str:
    """Get the key for indexing.
    - Keep acronyms (all uppercase) as-is
    - Lowercase everything else for case-insensitive lookup
    """
    if headword and len(headword) > 1 and headword == headword.upper() \
        and any(c.isupper() for c in headword):
        # It's an acronym, keep it as-is
        return headword
    # Everything else gets lowercased
    return headword.lower()


def escape_field(text: str) -> str:
    """Escape special characters for TSV format: tab, newline, carriage return, backslash."""
    if not text:
        return ""
    text = text.replace('\\', '\\\\')  # Backslash first
    text = text.replace('\t', '\\t')   # Tab
    text = text.replace('\n', '\\n')   # Newline
    text = text.replace('\r', '\\r')   # Carriage return
    return text


def extract_text_recursive(elem) -> str:
    """Extract all text content from an element and its children."""
    if elem is None:
        return ""
    # Get text and tail from element and all descendants
    parts = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        parts.append(extract_text_recursive(child))
        if child.tail:
            parts.append(child.tail)
    return ''.join(parts)


def parse_entry(entry_elem) -> Optional[Tuple[str, str, str, str, str, str]]:
    """
    Parse a single <entry> element and extract fields.

    Returns: (headword, pos, gender, pron, translations, definition) or None if invalid
    """
    # Extract headword from <form>/<orth>
    orth_elem = entry_elem.find(f".//{TEI_NS}orth")
    if orth_elem is None or not orth_elem.text:
        return None  # Skip entries without headword

    headword = normalize_text(orth_elem.text)
    if not headword:
        return None

    # Extract pronunciation(s) from <form>/<pron>
    # Use only the first pronunciation to avoid having multiple IPAs
    pron_elems = entry_elem.findall(f".//{TEI_NS}form/{TEI_NS}pron")
    pron = ""
    if pron_elems and pron_elems[0].text:
        pron = normalize_text(pron_elems[0].text)

    # Extract POS from <gramGrp>/<pos>
    pos_elem = entry_elem.find(f".//{TEI_NS}pos")
    pos = normalize_text(pos_elem.text) if pos_elem is not None and pos_elem.text else ""

    # Extract gender from <gramGrp>/<gen>
    gen_elem = entry_elem.find(f".//{TEI_NS}gen")
    gender_raw = normalize_text(gen_elem.text) if gen_elem is not None and gen_elem.text else ""
    # Map to short form: masc->m, fem->f, neut->n
    gender_map = {'masc': 'm', 'fem': 'f', 'neut': 'n', 'masculine': 'm',
                  'feminine': 'f', 'neuter': 'n'}
    gender = gender_map.get(gender_raw.lower(), gender_raw[:1]) if gender_raw else ""

    # Extract translations from <sense>/<cit type="trans">/<quote>
    # Note: cit may have xml:lang attribute but we take all translations
    quote_elems = entry_elem.findall(f".//{TEI_NS}sense/{TEI_NS}cit[@type='trans']/{TEI_NS}quote")
    translations = []
    for quote in quote_elems:
        trans_text = extract_text_recursive(quote)
        trans_text = normalize_text(trans_text)
        if trans_text:
            translations.append(trans_text)

    if not translations:
        return None  # Skip entries without translations

    # Remove duplicate translations
    translations = list(set(translations))
    translations_str = ';'.join(translations)

    # Extract definition from <sense>/<def> (optional)
    def_elems = entry_elem.findall(f".//{TEI_NS}sense/{TEI_NS}def")
    defs = []
    for def_elem in def_elems:
        def_text = extract_text_recursive(def_elem)
        def_text = normalize_text(def_text)
        if def_text:
            defs.append(def_text)
    definition = ' | '.join(defs) if defs else ""

    return (headword, pos, gender, pron, translations_str, definition)


def process_tei_file(tei_path: Path) -> Tuple[int, int]:
    """
    Process a single TEI file and generate .u8 and .idx files.

    Returns: (total_entries, successful_entries)
    """
    print(f"\nProcessing: {tei_path.name}")

    # Prepare output paths
    base_name = tei_path.stem  # e.g., 'fra-spa'
    u8_path = tei_path.parent / f"{base_name}.u8"
    idx_path = tei_path.parent / f"{base_name}.idx"

    # Track entries and index data
    entries_processed = 0
    entries_written = 0
    index_data = []  # List of (headword_lower, offset, length)

    try:
        # Open output file
        with open(u8_path, 'w', encoding='utf-8') as u8_file:
            # Parse TEI with iterparse for memory efficiency
            context = etree.iterparse(
                str(tei_path),
                events=('end',),
                tag=f'{TEI_NS}entry'
            )

            for _, entry_elem in context:
                entries_processed += 1

                # Parse entry
                result = parse_entry(entry_elem)
                if result is None:
                    entry_elem.clear()
                    continue

                headword, pos, gender, pron, translations, definition = result

                # Record byte offset before writing
                offset = u8_file.tell()

                # Escape fields and write TSV line
                fields = [
                    escape_field(headword),
                    escape_field(pos),
                    escape_field(gender),
                    escape_field(pron),
                    escape_field(translations),
                    escape_field(definition)
                ]
                line = '\t'.join(fields) + '\n'
                u8_file.write(line)

                # Calculate line length in bytes
                length = u8_file.tell() - offset

                # Add to index (keep acronyms, lowercase everything else)
                headword_index_key = get_index_key(headword)
                index_data.append((headword_index_key, offset, length))

                entries_written += 1

                # Clear element to free memory
                entry_elem.clear()
                while entry_elem.getprevious() is not None:
                    del entry_elem.getparent()[0]

                # Progress indicator
                if entries_processed % 5000 == 0:
                    print(f"  Processed {entries_processed:,} entries...", end='\r', flush=True)

        print(f"  Processed {entries_processed:,} entries (wrote {entries_written:,})")

        # Sort index by headword for binary search
        print("  Sorting index...")
        index_data.sort(key=lambda x: x[0])

        # Write index file
        print(f"  Writing index file: {idx_path.name}")
        with open(idx_path, 'w', encoding='utf-8') as idx_file:
            for headword_index_key, offset, length in index_data:
                # Escape headword for safety
                headword_escaped = escape_field(headword_index_key)
                idx_file.write(f"{headword_escaped}\t{offset}\t{length}\n")

        # Report file sizes
        u8_size_mb = u8_path.stat().st_size / (1024 * 1024)
        idx_size_mb = idx_path.stat().st_size / (1024 * 1024)
        print(f"  ✓ Generated: {u8_path.name} ({u8_size_mb:.2f} MB)")
        print(f"  ✓ Generated: {idx_path.name} ({idx_size_mb:.2f} MB)")

        return (entries_processed, entries_written)

    except Exception as e: # pylint: disable=broad-except
        print(f"  ✗ Error processing {tei_path.name}: {e}")
        import traceback # pylint: disable=import-outside-toplevel
        traceback.print_exc()
        return (entries_processed, 0)


def main():
    """Main entry point."""
    script_dir = Path(__file__).parent

    print("=" * 70)
    print("TEI to UTF-8 Dictionary Converter")
    print("=" * 70)

    # Find all .tei files
    tei_files = sorted(script_dir.glob("*.tei"))

    if not tei_files:
        print("\nNo .tei files found in current directory.")
        sys.exit(0)

    print(f"\nFound {len(tei_files)} TEI files:")
    for tei_file in tei_files:
        size_mb = tei_file.stat().st_size / (1024 * 1024)
        print(f"  - {tei_file.name} ({size_mb:.1f} MB)")

    # Process each file
    total_processed = 0
    total_written = 0
    successful_files = 0

    for tei_file in tei_files:
        processed, written = process_tei_file(tei_file)
        total_processed += processed
        total_written += written
        if written > 0:
            successful_files += 1

    print()
    print("=" * 70)
    print("Conversion complete:")
    print(f"  Files processed: {successful_files}/{len(tei_files)}")
    print(f"  Total entries: {total_processed:,}")
    print(f"  Entries written: {total_written:,}")
    print("=" * 70)


if __name__ == "__main__":
    main()

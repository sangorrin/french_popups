#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 sangorrin

"""
Extract French verb conjugations from fr-extract.jsonl and create:
- fra.u8: tab-separated file with conjugated forms and their metadata
- fra.idx: index file for fast lookups

Format of fra.u8:
conjugated_form<TAB>infinitive<TAB>tense(s)<TAB>ipa(s)<TAB>full_form
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

def normalize_text(text):
    """Normalize text: strip whitespace, apply NFC Unicode normalization, normalize apostrophes."""
    if not text:
        return ""
    # Strip and normalize to NFC (canonical composition)
    normalized = unicodedata.normalize('NFC', text.strip())
    # Normalize apostrophes to curly apostrophe (U+2019) to match main dictionary format
    normalized = normalized.replace("'", '\u2019')  # Straight apostrophe -> curly
    normalized = normalized.replace('\u2018', '\u2019')  # Left single quote -> curly apostrophe
    return normalized

def extract_conjugations(jsonl_path, output_u8, output_idx):
    """
    Parse fr-extract.jsonl and extract verb conjugations.

    Args:
        jsonl_path: Path to the input JSONL file
        output_u8: Path for the output .u8 file
        output_idx: Path for the output .idx file
    """
    conjugations = []

    print(f"Reading {jsonl_path}...")
    line_count = 0
    verb_count = 0
    form_count = 0

    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line_count += 1
            if line_count % 100000 == 0:
                print(f"Processed {line_count} lines, "
                      f"found {verb_count} verbs, {form_count} forms...")

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Only process French verbs with conjugation forms
            if (entry.get('lang_code') != 'fr' or
                entry.get('pos') != 'verb' or
                'forms' not in entry):
                continue

            infinitive = normalize_text(entry.get('word', ''))
            if not infinitive:
                continue

            verb_count += 1

            # Process each conjugated form
            for form_data in entry.get('forms', []):
                form = form_data.get('form', '')
                if not form or not form.strip():
                    continue

                tags = form_data.get('tags', [])
                ipas = form_data.get('ipas', [])

                # Skip multi-word constructions (auxiliary verb forms)
                if 'multiword-construction' in tags:
                    continue

                # Filter out the infinitive forms and participles as standalone entries
                # (we want conjugated forms for lookup)
                if tags == ['infinitive', 'present'] or tags == ['infinitive', 'past']:
                    continue

                # Extract the conjugated word (remove pronouns for indexing)
                # e.g., "je lis" -> "lis", "tu lis" -> "lis"
                conjugated_form = form.split()[-1] if ' ' in form else form
                conjugated_form = normalize_text(conjugated_form)

                # Join tenses with semicolon
                tenses = ';'.join(tags) if tags else ''

                # Process IPAs: remove backslashes and extract only the conjugated verb part
                processed_ipas = []
                for ipa in ipas:
                    # Remove backslashes from beginning and end
                    cleaned = ipa.strip('\\')
                    # Split by space and liaison character '‿'
                    parts = re.split(r'[\s‿]+', cleaned)
                    if parts:
                        # Take the last part which is the conjugated verb's IPA
                        conjugated_verb_ipa = parts[-1]
                        processed_ipas.append(conjugated_verb_ipa)

                # Join IPAs with semicolon
                ipa_str = ';'.join(processed_ipas) if processed_ipas else ''

                # Full form is the complete conjugation as it appears (normalized)
                full_form = normalize_text(form)

                # Create tab-separated entry
                entry_line = f"{conjugated_form}\t{infinitive}\t{tenses}\t{ipa_str}\t{full_form}\n"
                conjugations.append((conjugated_form.lower(), entry_line))
                form_count += 1

    print(f"\nTotal lines processed: {line_count}")
    print(f"Total verbs found: {verb_count}")
    print(f"Total conjugated forms extracted: {form_count}")

    # Sort conjugations alphabetically by the conjugated form
    print("\nSorting conjugations...")
    conjugations.sort(key=lambda x: x[0])

    # Write .u8 file and create index
    print(f"Writing {output_u8}...")
    print(f"Writing {output_idx}...")

    with open(output_u8, 'w', encoding='utf-8') as u8_file, \
         open(output_idx, 'w', encoding='utf-8') as idx_file:

        current_word = None
        word_start_offset = 0

        for conjugated_form_lower, entry_line in conjugations:
            # Write to .u8 file
            byte_offset = u8_file.tell()
            u8_file.write(entry_line)

            # Track start of each new word for index
            if conjugated_form_lower != current_word:
                if current_word is not None:
                    # Write index entry for previous word
                    idx_file.write(f"{current_word}\t{word_start_offset}\n")
                current_word = conjugated_form_lower
                word_start_offset = byte_offset

        # Write final index entry
        if current_word is not None:
            idx_file.write(f"{current_word}\t{word_start_offset}\n")

    print("\nDone! Created:")
    print(f"  - {output_u8} ({form_count} entries)")
    print(f"  - {output_idx} (index file)")

def main(): # pylint: disable=missing-function-docstring
    # Set up paths
    script_dir = Path(__file__).parent
    jsonl_path = script_dir / 'fr-extract.jsonl'
    output_u8 = script_dir / 'fra.u8'
    output_idx = script_dir / 'fra.idx'

    # Check if input file exists
    if not jsonl_path.exists():
        print(f"Error: {jsonl_path} not found!")
        print("Please run download_fr_extract.sh first or ensure the file exists.")
        sys.exit(1)

    # Extract conjugations
    extract_conjugations(jsonl_path, output_u8, output_idx)
    print("\nConjugation extraction complete!")

if __name__ == '__main__':
    main()

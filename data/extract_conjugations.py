#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 sangorrin

"""
Extract French verb conjugations from fr-extract.jsonl and create:
- fra.u8: deduplicated conjugations with all tenses merged
- fra.idx: index file for fast lookups

Pipeline:
1. Extract conjugations from fr-extract.jsonl
2. Deduplicate by conjugated form, keeping only the best entry
3. For entries with "participle;past", preserve only that tense
4. Generate index from deduplicated data

Format of fra.u8:
conjugated_form<TAB>infinitive<TAB>tense(s)<TAB>ipa(s)
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

def extract_conjugations(jsonl_path, output_u8):
    """
    Parse fr-extract.jsonl and extract verb conjugations.

    Args:
        jsonl_path: Path to the input JSONL file
        output_u8: Path for the output .u8 file
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

                # Process IPA: remove backslashes and extract only the conjugated verb part
                # Use only the first IPA to avoid having multiple variants
                ipa_str = ''
                if ipas:
                    # Take only the first IPA
                    ipa = ipas[0]
                    # Remove backslashes from beginning and end
                    cleaned = ipa.strip('\\')
                    # Split by space and liaison character '‿'
                    parts = re.split(r'[\s‿]+', cleaned)
                    if parts:
                        # Take the last part which is the conjugated verb's IPA
                        ipa_str = parts[-1]

                # Create tab-separated entry
                entry_line = f"{conjugated_form}\t{infinitive}\t{tenses}\t{ipa_str}\n"
                conjugations.append((conjugated_form.lower(), entry_line))
                form_count += 1

    print(f"\nTotal lines processed: {line_count}")
    print(f"Total verbs found: {verb_count}")
    print(f"Total conjugated forms extracted: {form_count}")

    # Sort conjugations alphabetically by the conjugated form
    print("\nSorting conjugations...")
    conjugations.sort(key=lambda x: x[0])

    # Write .u8 file
    print(f"Writing {output_u8}...")

    with open(output_u8, 'w', encoding='utf-8') as u8_file:
        for _, entry_line in conjugations:
            u8_file.write(entry_line)

    print(f"  - {output_u8} ({form_count} entries)")
    return conjugations

def load_valid_infinitives(idx_path, u8_path):
    """Load all verb infinitives from fra-eng.u8, keyed by headword"""
    valid_infinitives = {}
    try:
        # Read the u8 file to get POS info
        with open(u8_path, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split('\t')
                if len(parts) >= 2:
                    headword = parts[0].lower().strip()
                    pos = parts[1].lower().strip()
                    # Only include verbs (pos == 'v' or 'verb')
                    if headword and (pos == 'v' or pos == 'verb'):
                        valid_infinitives[headword] = pos
        print(f"[INFO] Loaded {len(valid_infinitives)} valid verb infinitives from {u8_path}")
        return valid_infinitives
    except (IOError, OSError) as e:
        print(f"[ERROR] Failed to load {u8_path}: {e}")
        sys.exit(1)

def parse_conjugation_entry(line):
    """Parse a conjugation entry line"""
    parts = line.rstrip('\n').split('\t')
    if len(parts) < 4:
        return None

    return {
        'conjugated_form': parts[0],
        'infinitive': parts[1],
        'tenses': parts[2],
        'ipas': parts[3]
    }

def merge_tenses(entries):
    """
    Merge tenses from multiple entries, grouping by mood.

    Format: mood;tense1;tense2;mood;tense1;...
    Multi-word tenses are joined with spaces: "past anterior" instead of "past;anterior"
    Example: indicative;past anterior;future perfect;subjunctive;past;pluperfect
    """
    # Common moods in French
    moods = {'indicative', 'subjunctive', 'conditional', 'imperative', 'participle',
             'gerund', 'infinitive'}

    # Collect tenses grouped by mood
    mood_tenses = {}

    for entry in entries:
        if entry['tenses']:
            tags = [t.strip() for t in entry['tenses'].split(';') if t.strip()]

            # Group consecutive non-mood tags into composite tenses
            current_mood = None
            current_tense_parts = []

            for tag in tags:
                if tag.lower() in moods:
                    # Start of a new mood
                    # Save previous tense if any
                    if current_tense_parts:
                        tense = ' '.join(current_tense_parts)
                        if current_mood:
                            mood_tenses[current_mood].add(tense)
                        current_tense_parts = []

                    current_mood = tag
                    if current_mood not in mood_tenses:
                        mood_tenses[current_mood] = set()
                else:
                    # This is a tense part, accumulate it
                    current_tense_parts.append(tag)

            # Don't forget the last tense
            if current_tense_parts and current_mood:
                tense = ' '.join(current_tense_parts)
                mood_tenses[current_mood].add(tense)

    # Build result: mood1;tense1;tense2;mood2;tense1;...
    result_parts = []
    for mood in ['indicative', 'subjunctive', 'conditional', 'imperative',
                 'participle', 'gerund', 'infinitive']:
        if mood in mood_tenses:
            result_parts.append(mood)
            # Add tenses for this mood in sorted order
            tenses = sorted(mood_tenses[mood])
            result_parts.extend(tenses)

    return ';'.join(result_parts) if result_parts else ''

def deduplicate_conjugations(u8_path, idx_path, u8_dict_path):
    """Deduplicate conjugations and return list of entries"""
    entries_by_form = {}
    skipped_invalid = 0
    skipped_no_valid = 0
    total_entries = 0

    print(f"\n[DEDUPLICATION] Loading valid verb infinitives from {u8_dict_path}...")
    valid_infinitives = load_valid_infinitives(idx_path, u8_dict_path)

    print(f"[DEDUPLICATION] Reading conjugations from {u8_path}...")

    try:
        with open(u8_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                if line_num % 100000 == 0:
                    print(f"[DEDUPLICATION] Processed {line_num} lines...")

                entry = parse_conjugation_entry(line)
                if not entry:
                    skipped_invalid += 1
                    continue

                total_entries += 1
                conjugated_form = entry['conjugated_form'].lower()

                if conjugated_form not in entries_by_form:
                    entries_by_form[conjugated_form] = []

                entries_by_form[conjugated_form].append(entry)

        print(f"[DEDUPLICATION] Total valid entries read: {total_entries}")
        print(f"[DEDUPLICATION] Unique conjugated forms: {len(entries_by_form)}")
        print(f"[DEDUPLICATION] Skipped invalid entries: {skipped_invalid}")

    except (IOError, OSError) as e:
        print(f"[ERROR] Failed to read {u8_path}: {e}")
        sys.exit(1)

    # Deduplicate each form
    print("[DEDUPLICATION] Deduplicating entries...")
    deduplicated = []

    for conjugated_form, entries in entries_by_form.items():
        # Filter by valid infinitives
        valid_entries = [e for e in entries
                        if e['infinitive'].lower().strip() in valid_infinitives]

        if not valid_entries:
            skipped_no_valid += len(entries)
            continue

        # Check if any entry has tenses == "participle;past"
        participle_past_entries = [e for e in valid_entries
                                   if e['tenses'] == 'participle;past']

        if participle_past_entries:
            # Use the participle;past entry without merging tenses
            best_entry = participle_past_entries[0]
            deduplicated.append(best_entry)
        else:
            # Score entries by completeness
            def score_entry(entry):
                score = 0
                if entry['conjugated_form'].strip():
                    score += 1
                if entry['infinitive'].strip():
                    score += 1
                if entry['tenses'].strip():
                    score += 1
                if entry['ipas'].strip():
                    score += 1
                return score

            # Select best entry
            best_entry = max(valid_entries, key=score_entry)

            # Merge tenses from ALL valid entries, grouping by mood
            merged_tenses = merge_tenses(valid_entries)
            best_entry['tenses'] = merged_tenses

            deduplicated.append(best_entry)

    print(f"[DEDUPLICATION] After deduplication: {len(deduplicated)} entries")
    print(f"[DEDUPLICATION] Skipped entries (infinitive not in fra-eng.idx): {skipped_no_valid}")

    return deduplicated

def generate_index(u8_path, idx_path, deduplicated_entries):
    """Generate index from deduplicated entries"""
    print(f"\n[INDEX] Writing deduplicated {u8_path}...")
    try:
        with open(u8_path, 'w', encoding='utf-8') as u8_file:
            for entry in deduplicated_entries:
                line = '\t'.join([
                    entry['conjugated_form'],
                    entry['infinitive'],
                    entry['tenses'],
                    entry['ipas']
                ])
                u8_file.write(line + '\n')

        print(f"[INDEX] Wrote {len(deduplicated_entries)} entries to {u8_path}")
    except (IOError, OSError) as e:
        print(f"[ERROR] Failed to write {u8_path}: {e}")
        sys.exit(1)

    # Generate index
    print(f"[INDEX] Generating index {idx_path}...")

    try:
        # Build offset map from the deduplicated u8 file
        offset_map = {}
        with open(u8_path, 'rb') as f:
            offset = 0
            for line in f:
                line_text = line.decode('utf-8', errors='replace').rstrip('\n')
                fields = line_text.split('\t')
                if len(fields) >= 1:
                    conjugated_form = fields[0].strip()
                    if conjugated_form:
                        offset_map[conjugated_form] = offset
                # offset is the byte position of the start of this line
                offset += len(line)  # line includes the newline in binary mode

        # Create sorted index entries
        index_entries = sorted(offset_map.items(), key=lambda x: x[0].lower())

        # Write index file
        with open(idx_path, 'w', encoding='utf-8') as idx_file:
            for conjugated_form, offset in index_entries:
                idx_file.write(f"{conjugated_form}\t{offset}\n")

        print(f"[INDEX] Wrote {len(index_entries)} index entries to {idx_path}")
    except (IOError, OSError) as e:
        print(f"[ERROR] Failed to generate index: {e}")
        sys.exit(1)

def main(): # pylint: disable=missing-function-docstring
    # Set up paths
    script_dir = Path(__file__).parent
    jsonl_path = script_dir / 'fr-extract.jsonl'
    fra_eng_idx = script_dir / 'fra-eng.idx'
    fra_eng_u8 = script_dir / 'fra-eng.u8'
    output_u8 = script_dir / 'fra.u8'
    output_idx = script_dir / 'fra.idx'

    # Check if input files exist
    if not jsonl_path.exists():
        print(f"Error: {jsonl_path} not found!")
        print("Please run download_fr_extract.sh first or ensure the file exists.")
        sys.exit(1)

    if not fra_eng_idx.exists():
        print(f"Error: {fra_eng_idx} not found!")
        print("This is required for deduplication.")
        sys.exit(1)

    if not fra_eng_u8.exists():
        print(f"Error: {fra_eng_u8} not found!")
        print("This is required to validate verb infinitives.")
        sys.exit(1)

    # Step 1: Extract conjugations
    print("=" * 70)
    print("STEP 1: Extracting conjugations from JSONL")
    print("=" * 70)
    extract_conjugations(jsonl_path, output_u8)

    # Step 2: Deduplicate
    print("\n" + "=" * 70)
    print("STEP 2: Deduplicating entries")
    print("=" * 70)
    deduplicated = deduplicate_conjugations(output_u8, fra_eng_idx, fra_eng_u8)

    # Step 3: Generate index
    print("\n" + "=" * 70)
    print("STEP 3: Generating index")
    print("=" * 70)
    generate_index(output_u8, output_idx, deduplicated)

    # Summary
    print("\n" + "=" * 70)
    print("COMPLETE")
    print("=" * 70)

    u8_size = output_u8.stat().st_size
    idx_size = output_idx.stat().st_size

    print("\nCreated:")
    print(f"  - {output_u8} ({u8_size / 1024 / 1024:.1f} MB, {len(deduplicated)} entries)")
    print(f"  - {output_idx} ({idx_size / 1024 / 1024:.1f} MB)")
    print(f"\nTotal output: {(u8_size + idx_size) / 1024 / 1024:.1f} MB")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 sangorrin

"""
WikDict French Dictionary Downloader

Automatically discovers and downloads all fra-*.tei dictionaries from WikDict.
No hardcoded language list - dynamically parses the directory listing.
"""

import re
import sys
from pathlib import Path
from urllib.request import urlopen, urlretrieve
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser


BASE_URL = "https://download.wikdict.com/dictionaries/tei/recommended/"


class DirectoryParser(HTMLParser):
    """Parse Apache/nginx directory listing to extract fra-*.tei filenames."""

    def __init__(self):
        super().__init__()
        self.files = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for attr, value in attrs:
                if attr == 'href' and value.startswith('fra-') and value.endswith('.tei'):
                    self.files.append(value)


def fetch_file_list():
    """Fetch and parse directory listing to get all fra-*.tei files."""
    print(f"Fetching directory listing from {BASE_URL}...")
    try:
        with urlopen(BASE_URL) as response:
            html = response.read().decode('utf-8')

        parser = DirectoryParser()
        parser.feed(html)

        # Sort files alphabetically for consistent output
        files = sorted(set(parser.files))

        if not files:
            print("Warning: No fra-*.tei files found in directory listing.")
            print("Falling back to regex pattern matching...")
            # Fallback: extract from text patterns like "fra-xxx.tei"
            files = sorted(set(re.findall(r'fra-[a-z]{3}\.tei', html)))

        return files

    except (URLError, HTTPError) as e:
        print(f"Error fetching directory listing: {e}")
        sys.exit(1)


def download_file(filename, output_dir):
    """Download a single file with progress indication."""
    url = BASE_URL + filename
    output_path = output_dir / filename

    # Skip if already exists
    if output_path.exists():
        print(f"  ✓ {filename} (already exists, skipping)")
        return True

    try:
        print(f"  ⬇ {filename} ... ", end='', flush=True)

        def progress_hook(block_count, block_size, total_size):
            if total_size > 0:
                downloaded = block_count * block_size
                percent = min(100, downloaded * 100 // total_size)
                print(f"\r  ⬇ {filename} ... {percent}%", end='', flush=True)

        urlretrieve(url, output_path, reporthook=progress_hook)
        print(f"\r  ✓ {filename} (downloaded)")
        return True

    except (URLError, HTTPError) as e:
        print(f"\r  ✗ {filename} (error: {e})")
        return False


def main():
    """Main entry point."""
    # Determine output directory (same as script location)
    script_dir = Path(__file__).parent
    output_dir = script_dir

    print("=" * 70)
    print("WikDict French Dictionary Downloader")
    print("=" * 70)
    print()

    # Fetch list of available dictionaries
    files = fetch_file_list()

    if not files:
        print("No files to download.")
        sys.exit(0)

    print(f"Found {len(files)} dictionaries:")
    for f in files:
        print(f"  - {f}")
    print()

    # Download all files
    print(f"Downloading to: {output_dir}")
    print()

    success_count = 0
    for filename in files:
        if download_file(filename, output_dir):
            success_count += 1

    print()
    print("=" * 70)
    print(f"Download complete: {success_count}/{len(files)} successful")
    print("=" * 70)


if __name__ == "__main__":
    main()

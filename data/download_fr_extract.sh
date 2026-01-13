#!/bin/bash
# Download and extract the French dictionary from kaikki.org
# This includes verb conjugations and other grammatical forms

URL="https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz"
OUTPUT_FILE="fr-extract.jsonl"

echo "Downloading French dictionary from kaikki.org..."
wget "$URL"

echo "Extracting compressed file..."
gunzip fr-extract.jsonl.gz

echo "Done! Output file: $OUTPUT_FILE"

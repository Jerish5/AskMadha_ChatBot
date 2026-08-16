# Bible Datasets (English & Tamil)

Structured, verse-level Bible text in JSON format for English and Tamil.

## Contents

| File | Language | Verses | Books |
|---|---|---|---|
| [`english_bible/English_bible_full.json`](english_bible/English_bible_full.json) | English | 35,453 | 73 |
| [`tamil_bible/tamil_bible_full.json`](tamil_bible/tamil_bible_full.json) | Tamil | 35,677 | 73 |

## Format

Each file is a JSON array of verse objects:

```json
{
  "book": "GENESIS",
  "chapter": 1,
  "verse": "1",
  "text": "In the beginning, God created the heavens and the earth."
}
```

- `book` — book name (uppercase in English; native script in Tamil)
- `chapter` — chapter number (integer)
- `verse` — verse number (string)
- `text` — verse text

## Notes

- The English dataset includes deuterocanonical books (Tobit, Judith, 1–2 Maccabees, Baruch).
- Both datasets now have 73 books, but book order differs structurally: English interleaves the deuterocanonical books within the Old Testament (e.g. Tobit/Judith before Esther, Maccabees after), while Tamil groups all of its deuterocanonical books together at the very end, after Revelation. Verse text is also not guaranteed to be 1:1 aligned by chapter/verse across languages (translations may split or condense verses differently) — treat each as an independent source rather than a parallel corpus.

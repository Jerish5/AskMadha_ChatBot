# Bible Datasets (English & Tamil)

Structured, verse-level Bible text in JSON format for English and Tamil.

## Contents

| File | Language | Verses | Books |
|---|---|---|---|
| [`english_bible/English_bible_full.json`](english_bible/English_bible_full.json) | English | 35,453 | 73 |
| [`tamil_bible/tamil_bible_full.json`](tamil_bible/tamil_bible_full.json) | Tamil | 36,097 | 74 |

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
- Book naming and verse counts differ slightly between the two datasets (73 vs. 74 books), so they are not guaranteed to be 1:1 aligned by book/chapter/verse — treat each as an independent source rather than a parallel corpus.

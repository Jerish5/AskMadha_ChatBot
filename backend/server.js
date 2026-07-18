import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { buildEnglishIndex, searchVerses, detectLanguage, findReferencesWithLLM, generateEnglishResponse, extractEnglishVersesFromText } from './src/services/englishSearch.js';
import { buildIndex, searchBible, extractVersesFromText } from './src/services/bibleSearch.js';
import { generateChatResponse } from './src/services/chatService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// === Load English Bible ===
console.log('Loading English Bible data...');
const englishPath = path.join(__dirname, '../data/english_bible/English_bible_full.json');
let englishIndex = null;
try {
  const rawBible = JSON.parse(fs.readFileSync(englishPath, 'utf-8'));
  let seenDeut31Verses = new Set();
  let inDeut32 = false;
  const englishBible = rawBible.map((v, i) => {
    let newV = { ...v, id: i + 1 };
    if (newV.book === 'DEUTERONOMY' && newV.chapter === 31) {
      const verseNum = parseInt(newV.verse);
      if (seenDeut31Verses.has(verseNum) || verseNum === 31 || inDeut32) {
        inDeut32 = true;
        return { ...newV, chapter: 32 };
      } else {
        seenDeut31Verses.add(verseNum);
      }
    }
    return newV;
  });
  console.log('Building English search index...');
  englishIndex = buildEnglishIndex(englishBible);
  console.log(`English index built: ${englishIndex.total} verses, ${englishIndex.wordDocFreq.size} unique terms.`);
} catch (error) {
  console.error('Failed to load English Bible data:', error);
}

// === Load Tamil Bible ===
console.log('Loading Tamil Bible data...');
const tamilPath = path.join(__dirname, '../data/tamil_bible/tamil_bible_full.json');
let tamilIndex = null;
try {
  const bibleData = JSON.parse(fs.readFileSync(tamilPath, 'utf-8'));
  const enriched = bibleData.map((v, i) => {
    const cleanVerse = String(v.verse).replace(/[a-zA-Z]/g, '');
    let cleanText = v.text.replace(/\\s*\\b\\d+[a-zA-Z]\\b\\s*/g, ' ').trim();
    cleanText = cleanText.replace(/\s+\d+\.\s+[஀-௿\s,.'"-]+$/, '').trim();
    return { ...v, id: i + 1, ref: `${v.book} ${v.chapter}:${cleanVerse}`, text: cleanText };
  });
  console.log('Building Tamil search index...');
  tamilIndex = buildIndex(enriched);
  console.log('Tamil search index built successfully.');
} catch (error) {
  console.error('Failed to load Tamil Bible data:', error);
  process.exit(1);
}

// Health check
app.get('/', (req, res) => res.send('Ask Madha API is running.'));

app.post('/api/chat', async (req, res) => {
  const { query, languagePreference, history = [], bookFilter = 'all' } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required.' });

  try {
    const detected = await detectLanguage(query, languagePreference);
    console.log(`Query: "${query}" → Detected: ${detected.lang}, Translated: "${detected.query}"`);

    if (detected.lang === 'tamil') {
      if (!tamilIndex) return res.status(503).json({ error: 'Tamil Bible service is unavailable.' });

      const results = searchBible(tamilIndex, detected.query.trim(), 12, bookFilter);
      const finalAnswer = await generateChatResponse(detected.query, history, results);
      const extractedVerses = extractVersesFromText(finalAnswer, tamilIndex.verses);

      const sources = [];
      const seenRefs = new Set();
      for (const v of extractedVerses) {
        if (!seenRefs.has(v.ref)) {
          seenRefs.add(v.ref);
          sources.push(v);
        }
      }
      sources.sort((a, b) => a.id - b.id);
      return res.json({ answer: finalAnswer, sources });
    }

    // === English path ===
    if (!englishIndex) return res.status(503).json({ error: 'English Bible service is unavailable.' });

    let semanticVerses = [];
    try {
      const llmRefs = await findReferencesWithLLM(query);
      for (const ref of llmRefs) {
        if (!ref || typeof ref !== 'object') continue;
        const book = String(ref.book || '').toUpperCase();
        const chapter = parseInt(ref.chapter);
        const verseStr = String(ref.verse || '').trim();

        let versesToFind = [verseStr];
        if (verseStr.includes('-')) {
          const parts = verseStr.split('-');
          const start = parseInt(parts[0]);
          const end = parseInt(parts[1]);
          if (!isNaN(start) && !isNaN(end) && start <= end && end - start < 10) {
            versesToFind = [];
            for (let i = start; i <= end; i++) versesToFind.push(String(i));
          }
        }

        for (const v of versesToFind) {
          const match = englishIndex.bible.find(item => item.book === book && item.chapter === chapter && item.verse === v);
          if (match) semanticVerses.push(match);
        }
      }
    } catch (e) {
      console.error('Failed to parse LLM refs:', e);
    }

    const keywordVerses = searchVerses(englishIndex, query);
    const relevantVerses = [];
    const seen = new Set();
    for (const v of [...semanticVerses, ...keywordVerses]) {
      const vId = `${v.book}_${v.chapter}_${v.verse}`;
      if (!seen.has(vId)) {
        seen.add(vId);
        relevantVerses.push(v);
        if (relevantVerses.length >= 30) break;
      }
    }

    const { answer, sources } = await generateEnglishResponse(query, relevantVerses);
    
    // Extract verses from AI's generated text
    const extractedVerses = extractEnglishVersesFromText(answer, englishIndex);
    
    // Combine them with the original sources (removing duplicates)
    const finalSources = [...sources];
    const sourceIds = new Set(finalSources.map(v => `${v.book}_${v.chapter}_${v.verse}`));
    for (const v of extractedVerses) {
      const vId = `${v.book}_${v.chapter}_${v.verse}`;
      if (!sourceIds.has(vId)) {
        sourceIds.add(vId);
        finalSources.push(v);
      }
    }

    finalSources.sort((a, b) => a.id - b.id);
    return res.json({ answer, sources: finalSources });

  } catch (error) {
    console.error('Error generating response:', error);
    const errorMessage = error.message ? `An error occurred: ${error.message}` : 'An error occurred while generating the response.';
    res.status(500).json({ error: errorMessage });
  }
});

app.listen(PORT, () => console.log(`Ask Madha API running on http://localhost:${PORT}`));

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { buildEnglishIndex, searchVerses, detectLanguage, findReferencesWithLLM, generateEnglishResponse, extractEnglishVersesFromText } from './src/services/englishSearch.js';
import { buildIndex, searchBible, extractVersesFromText } from './src/services/bibleSearch.js';
import { generateChatResponse } from './src/services/chatService.js';
import { isGreetingOnly, pickGreeting } from './src/services/greetings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// The model appends its own trailing "References" list to every answer (used
// to extract the `sources` array below), but the UI already renders those
// same verses with full text in a sources card — showing the plain list too
// would duplicate it, so strip it from the text we actually send back.
function stripTrailingReferenceList(text) {
  if (!text) return text;
  return text.replace(/\n+\s*(?:ஆதார(?:\s+விவிலிய)?\s+(?:குறிப்புகள்|மேற்கோள்கள்)|ஆதாரங்கள்|Biblical References|References)\s*:[\s\S]*$/i, '').trim();
}

// ─── Per-IP Rate Limiting ───────────────────────────────────────────────────
// Minimal in-memory fixed-window limiter for the one endpoint that spends
// real Gemini API budget per request — no external dependency needed for a
// single counter check. Not durable across restarts/instances, which is fine
// here: the goal is a ceiling against a runaway script hammering the public
// endpoint, not precise multi-instance quota enforcement.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitBuckets = new Map(); // ip -> { count, resetAt }

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Sweep expired buckets periodically so long-running instances don't
// accumulate one entry per distinct visitor forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// === Load English Bible ===
console.log('Loading English Bible data...');
const englishPath = path.join(__dirname, '../data/bible-datasets/english_bible/English_bible_full.json');
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
const tamilPath = path.join(__dirname, '../data/bible-datasets/tamil_bible/tamil_bible_full.json');
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
  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { query, languagePreference, history = [], bookFilter = 'all' } = req.body;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query is required.' });
  }
  if (query.length > 2000) {
    return res.status(400).json({ error: 'Query is too long (max 2000 characters).' });
  }

  // Greetings are answered with one of a fixed set of canned replies (see
  // the GREETINGS instructions in chatService.js / englishSearch.js) — for
  // an exact greeting-only message there's no need to spend an LLM call
  // just to have the model parrot one of those strings back.
  if (isGreetingOnly(query)) {
    return res.json({ answer: pickGreeting(query, languagePreference), sources: [] });
  }

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
      return res.json({ answer: stripTrailingReferenceList(finalAnswer), sources });
    }

    // === English path ===
    if (!englishIndex) return res.status(503).json({ error: 'English Bible service is unavailable.' });

    // Fire off the LLM reference lookup and run the local keyword search
    // concurrently instead of sequentially — the keyword search is pure CPU
    // work with no dependency on the LLM result, so it can run while we wait
    // on the network round-trip.
    const llmRefsPromise = findReferencesWithLLM(query);
    const keywordVerses = searchVerses(englishIndex, query);

    let semanticVerses = [];
    try {
      const llmRefs = await llmRefsPromise;
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
          const vNum = parseInt(v, 10);
          if (isNaN(vNum)) continue;
          const matches = englishIndex.verseByRef.get(`${book}|${chapter}|${vNum}`);
          if (matches && matches.length) semanticVerses.push(matches[0]);
        }
      }
    } catch (e) {
      console.error('Failed to parse LLM refs:', e);
    }

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
    return res.json({ answer: stripTrailingReferenceList(answer), sources: finalSources });

  } catch (error) {
    console.error('Error generating response:', error);
    const errorMessage = error.message ? `An error occurred: ${error.message}` : 'An error occurred while generating the response.';
    res.status(500).json({ error: errorMessage });
  }
});

app.listen(PORT, () => console.log(`Ask Madha API running on http://localhost:${PORT}`));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

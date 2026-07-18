import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const stopWords = new Set([
  "a", "an", "the",
  "and", "but", "if", "or", "because", "as", "so", "than", "yet", "nor", "for",
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "who", "whom", "whose", "which", "that",
  "this", "these", "those", "what",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "having",
  "do", "does", "did", "doing",
  "will", "would", "shall", "should",
  "may", "might", "must", "can", "could",
  "in", "on", "at", "to", "of", "by", "up", "out", "off",
  "from", "with", "into", "over", "under", "about",
  "between", "through", "during", "before", "after",
  "above", "below", "against", "among", "upon",
  "not", "no", "nor", "only", "own", "same",
  "too", "very", "just", "also", "now", "here", "there",
  "when", "where", "why", "how", "again", "further",
  "then", "once", "more", "most", "other", "some",
  "any", "all", "both", "each", "few", "such",
  "one", "anyone", "everyone", "someone", "nobody", "nothing", "anything", "something",
]);

export const synonyms = {
  "death": ["die", "died", "dead"],
  "died": ["death", "die", "dead"],
  "die": ["death", "died", "dead"],
  "buried": ["bury", "burial", "tomb"],
  "burial": ["buried", "bury", "tomb"],
  "tomb": ["grave", "buried", "burial"],
  "aron": ["aaron"],
  "breastpiece": ["breast-piece", "breastplate", "breast piece"],
  "breastplate": ["breastpiece", "breast-piece"],
};

export function getStem(word) {
  if (word.length <= 4) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('ing')) return word.slice(0, -3);
  return word;
}

export function buildEnglishIndex(bible) {
  const wordDocFreq = new Map();
  const verseWords = bible.map(verse => {
    const words = new Set(verse.text.toLowerCase().split(/\W+/).filter(w => w.length > 0));
    for (const word of words) {
      wordDocFreq.set(word, (wordDocFreq.get(word) || 0) + 1);
    }
    return words;
  });
  return { bible, wordDocFreq, verseWords, total: bible.length };
}

function getIDF(wordDocFreq, total, word) {
  const df = wordDocFreq.get(word) || 0;
  if (df === 0) return 0;
  return Math.log(total / df);
}

export function searchVerses(englishIndex, query) {
  const { bible, wordDocFreq, verseWords, total } = englishIndex;

  const queryParts = query.toLowerCase().split(/_+/).map(p => p.trim()).filter(p => p.length > 2);
  const cleanQuery = query.toLowerCase().replace(/-/g, '');
  const tokens = cleanQuery.split(/\W+/).filter(word => word.length > 2 && !stopWords.has(word));

  let expandedTokens = [];
  for (const t of tokens) {
    expandedTokens.push(t);
    if (synonyms[t]) expandedTokens.push(...synonyms[t]);
  }
  expandedTokens = [...new Set(expandedTokens)];

  if (expandedTokens.length === 0 && queryParts.length === 0) {
    return [];
  }

  const scoredVerses = bible.map((verse, idx) => {
    let score = 0;
    const text = verse.text.toLowerCase();
    const wordSet = verseWords[idx];

    for (const part of queryParts) {
      const partWords = part.split(/\W+/).filter(w => w.length > 0);
      const hasSignificantWord = partWords.some(w => w.length > 2 && !stopWords.has(w));
      if (!hasSignificantWord) continue;
      if (text.includes(part)) score += 100 * part.length;
    }

    for (const token of expandedTokens) {
      if (wordSet.has(token)) {
        const weight = getIDF(wordDocFreq, total, token);
        score += 10 * weight;
      } else {
        const stem = getStem(token);
        if (text.includes(stem) || text.includes(token)) {
          const weight = getIDF(wordDocFreq, total, token);
          score += 8 * weight;
        }
      }
    }

    const originalTokensMatched = tokens.filter(t => wordSet.has(t) || text.includes(t)).length;
    if (originalTokensMatched === tokens.length && tokens.length > 0) score += 50;
    if (score > 0) score -= (text.length / 1000);

    return { verse, score, idx };
  });

  const smoothedScores = scoredVerses.map(item => {
    let windowScore = item.score;
    const idx = item.idx;
    if (idx > 0 && bible[idx - 1].book === item.verse.book && bible[idx - 1].chapter === item.verse.chapter) {
      windowScore += scoredVerses[idx - 1].score * 0.5;
    }
    if (idx < bible.length - 1 && bible[idx + 1].book === item.verse.book && bible[idx + 1].chapter === item.verse.chapter) {
      windowScore += scoredVerses[idx + 1].score * 0.5;
    }
    return { verse: item.verse, score: windowScore };
  });

  smoothedScores.sort((a, b) => b.score - a.score);
  return smoothedScores.filter(item => item.score > 0).slice(0, 30).map(item => item.verse);
}

function containsTamilScript(text) {
  return /[஀-௿]/.test(text);
}

export async function detectLanguage(query, languagePreference = 'auto') {
  if (languagePreference === 'english') {
    return { lang: 'english', query };
  }

  if (containsTamilScript(query)) {
    return { lang: 'tamil', query };
  }

  let prompt = `Analyze the following text: "${query}"
1. If it is English, return JSON: {"lang": "english", "query": "${query}"}
2. If it is Tamil written in English letters (Tanglish), return JSON with lang="tamil" and the query translated into proper Tamil script. Example for "Kadavul Yaar?": {"lang": "tamil", "query": "கடவுள் யார்?"}
Return ONLY valid JSON.`;

  if (languagePreference === 'tamil') {
    prompt = `The user's language preference is Tamil.
Translate the following text into proper Tamil script: "${query}"
Even if the text is in English, translate it to Tamil. If it is Tanglish, transliterate it to proper Tamil.
Return JSON with lang="tamil" and the query translated into proper Tamil script.
Example 1 (Tanglish): "Kadavul Yaar?" -> {"lang": "tamil", "query": "கடவுள் யார்?"}
Example 2 (English): "Who is Jesus?" -> {"lang": "tamil", "query": "இயேசு யார்?"}
Return ONLY valid JSON.`;
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    const result = await model.generateContent(prompt);
    const data = JSON.parse(result.response.text());
    console.log(`Language detected: ${data.lang}`);
    return { lang: data.lang || 'english', query: data.query || query };
  } catch (e) {
    console.error('Language detection error:', e.message);
    return { lang: 'english', query };
  }
}

export async function findReferencesWithLLM(query) {
  const prompt = `You are a Bible reference finder.
User query: "${query}"

INSTRUCTIONS:
1. Find the most relevant Bible verses that answer the query or match the statement (up to 5).
2. If the user query is a fill-in-the-blank question (containing underscores like "_______" or "___"), identify the possible biblical phrases that could fill the blank (e.g., "hung on a tree" in Deuteronomy 21:23 / Galatians 3:13, or "does not abide by all things..." in Deuteronomy 27:26 / Galatians 3:10). Return the references for all likely biblical matches that complete the phrase.
3. Return ONLY a valid JSON list of objects. Each object must have keys: "book" (string, fully capitalized like "GENESIS"), "chapter" (integer), "verse" (string).
If no verses match, return [].
Example: [{"book": "DEUTERONOMY", "chapter": 19, "verse": "15"}]`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch (err) {
    console.error('LLM reference retrieval error:', err.message);
    return [];
  }
}const englishAbbrMap = {
  "GEN": "GENESIS", "EX": "EXODUS", "EXOD": "EXODUS", "LEV": "LEVITICUS", "NUM": "NUMBERS", 
  "DEUT": "DEUTERONOMY", "JOSH": "JOSHUA", "JUDG": "JUDGES", "RUTH": "RUTH", 
  "1 SAM": "1SAMUEL", "2 SAM": "2SAMUEL", "1 KGS": "1KINGS", "2 KGS": "2KINGS", 
  "1 KIN": "1KINGS", "2 KIN": "2KINGS", "1 CHR": "1CHRONICLES", "2 CHR": "2CHRONICLES",
  "1 CHRON": "1CHRONICLES", "2 CHRON": "2CHRONICLES", "EZRA": "EZRA", "NEH": "NEHEMIAH",
  "ESTH": "ESTHER", "JOB": "JOB", "PS": "PSALMS", "PSA": "PSALMS", "PROV": "PROVERBS",
  "ECCL": "ECCLESIASTES", "SONG": "THESONGOFSOLOMON", "CANT": "THESONGOFSOLOMON",
  "ISA": "ISAIAH", "JER": "JEREMIAH", "LAM": "LAMENTATIONS", "EZEK": "EZEKIEL",
  "DAN": "DANIEL", "HOS": "HOSEA", "JOEL": "JOEL", "AMOS": "AMOS", "OBAD": "OBADIAH",
  "JONAH": "JONAH", "MIC": "MICAH", "NAH": "NAHUM", "HAB": "HABAKKUK", "ZEPH": "ZEPHANIAH",
  "HAG": "HAGGAI", "ZECH": "ZECHARIAH", "MAL": "MALACHI", "MATT": "MATTHEW", "MT": "MATTHEW",
  "MARK": "MARK", "MK": "MARK", "MRK": "MARK", "LUKE": "LUKE", "LK": "LUKE", "JOHN": "JOHN",
  "JN": "JOHN", "ACTS": "ACTS", "ROM": "ROMANS", "1 COR": "1CORINTHIANS", "2 COR": "2CORINTHIANS",
  "GAL": "GALATIANS", "EPH": "EPHESIANS", "PHIL": "PHILIPPIANS", "COL": "COLOSSIANS",
  "1 THESS": "1THESSALONIANS", "2 THESS": "2THESSALONIANS", "1 TIM": "1TIMOTHY",
  "2 TIM": "2TIMOTHY", "TITUS": "TITUS", "PHILEM": "PHILEMON", "HEB": "HEBREWS",
  "JAS": "JAMES", "1 PET": "1PETER", "2 PET": "2PETER", "1 JN": "1JOHN", "2 JN": "2JOHN",
  "3 JN": "3JOHN", "JUDE": "JUDE", "REV": "REVELATION"
};

export function extractEnglishVersesFromText(text, englishIndex) {
  if (!text || !englishIndex || !englishIndex.bible) return [];
  
  const uniqueBooks = Array.from(new Set(englishIndex.bible.map(v => v.book)));
  const regex = /((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+):\s*(\d+)(?:\s*-\s*(\d+))?/gi;
  const matches = [...text.matchAll(regex)];
  
  const extracted = [];
  const seenRefs = new Set();
  
  for (const match of matches) {
    let bookQuery = match[1].trim().toUpperCase();
    const chapter = parseInt(match[2], 10);
    const startVerse = parseInt(match[3], 10);
    const endVerse = match[4] ? parseInt(match[4], 10) : startVerse;
    
    // Normalize book query (replace multiple spaces with a single space)
    bookQuery = bookQuery.replace(/\s+/g, ' ');
    
    // 1. Try exact match in abbreviation map
    let fullBook = englishAbbrMap[bookQuery];
    
    // 2. Try prefix match in unique books
    if (!fullBook) {
      fullBook = uniqueBooks.find(b => b === bookQuery || b.startsWith(bookQuery) || b.replace(' ', '').startsWith(bookQuery.replace(' ', '')));
    }
    
    if (!fullBook) continue;
    
    const matchingVerses = englishIndex.bible.filter(v => {
      if (v.book !== fullBook) return false;
      if (v.chapter !== chapter) return false;
      const vNum = parseInt(v.verse, 10);
      if (isNaN(vNum)) return false;
      return vNum >= startVerse && vNum <= endVerse;
    });
    
    for (const v of matchingVerses) {
      const vId = `${v.book}_${v.chapter}_${v.verse}`;
      if (!seenRefs.has(vId)) {
        seenRefs.add(vId);
        extracted.push(v);
      }
    }
  }
  
  return extracted;
}

export async function generateEnglishResponse(query, relevantVerses) {
  let contextText = relevantVerses.map(v => `${v.book} ${v.chapter}:${v.verse} - "${v.text}"`).join('\n');
  if (relevantVerses.length === 0) contextText = 'No direct verses found matching the keywords.';

  const prompt = `You are an expert, precise Bible Chatbot.
The user asked a question or provided a fill-in-the-blank phrase, and I have found the following most relevant verses from the english Bible text provided by the user:

${contextText}

User's input: ${query}

CRITICAL INSTRUCTIONS:
1. Primary Source & Fallback: Attempt to base your answers on the provided context verses. HOWEVER, if the provided verses do not contain the answer or are completely irrelevant, YOU MUST NEVER mention that the verses lack the information. Completely ignore the context verses and rely ENTIRELY on your comprehensive general biblical knowledge to answer the question accurately, providing correct biblical citations from memory.
2. If the user's input contains blanks (like _______), you MUST find the specific verse in the context that matches the text before/after the blanks. Note that the blank phrase might be a paraphrase or come from a different Bible translation (such as NIV) than the provided ESV text (e.g., "Any one hung on a tree is under God's curse" is the NIV translation corresponding to Deuteronomy 21:23, where ESV says "a hanged man is cursed by God"). In such cases, identify the correct verse by its meaning and theology, fill in the blank to match the expected biblical completion, and cite the correct verse.
3. Fill in the blanks exactly as the text appears in the matching verse (or standard translation representing the blank if it differs from ESV), and explicitly cite the verse using standard English abbreviations (e.g., "Deut 21:23").
4. DEPTH OF EXPLANATION: You are REQUIRED to use your broader biblical knowledge to provide a highly detailed, comprehensive explanation of meanings, historical context, and theological concepts. When discussing feasts, offerings, characters, or practices, you MUST include deep historical background, Hebrew names (if applicable), dates/timing, alternative names, and their deep theological significance. When discussing events, tribes, or locations, you MUST connect them to related historical events (e.g., later migrations, outcomes, related prophecies) across the Bible to provide a complete picture.
5. FORMATTING: First, answer the question directly and concisely in a single sentence. If the question asks why an event happened and there is a verse in the context that gives the direct biblical explanation, you MUST prioritize using the phrasing of that specific verse in your first sentence, and you MUST NOT repeat or paraphrase the question in your first sentence (e.g., do NOT start with "God forbade Moses because..." or "Moses was forbidden to enter the Promised Land because..."). Jump straight to the direct biblical statement (e.g., answering "Why did God forbid Moses to enter the Promised Land?" with "Moses broke faith with God in the midst of the people of Israel at the waters of Meribah-kadesh, in the wilderness of Zin (Deut 32:51)"). Then, if needed, you may provide a brief explanation based on the user's question. NEVER mention the context or verses provided to you. You MUST NEVER use phrases like "The provided verses do not mention", "The text doesn't say", "Based on the provided context", or "According to the provided text". Your user does not know you are being provided with context verses. Act as an omniscient Bible scholar and give the answer directly.
6. ABBREVIATE CITATIONS: When displaying Bible references in your answer, you MUST convert full book names into standard 3-4 letter English abbreviations (e.g., use 'Deut 2:5' instead of 'Deuteronomy 2:5', use 'Lev 25' instead of 'Leviticus 25'). NEVER use the full book name in citations.
7. STRUCTURE RULE: Mostly follow this exact response structure for your answers:
ANSWER: [Your concise answer here]

EXPLANATION: [Your highly detailed explanation here. Include deep historical and theological context, Hebrew names, dates, and significance.]

Biblical References:
[List comprehensive Bible references related to the topic at the end]

8. ENUMERATION RULE: If the user asks to list, enumerate, or describe multiple items, you MUST explicitly number them in your response (e.g., 1) Item One, 2) Item Two) and ensure you capture ALL items mentioned in the relevant text. Be thorough so you do not miss any items (e.g., if listing offerings in Leviticus 1-6, include all 5: Burnt, Grain/Cereal, Peace, Sin, and Guilt Offerings).

9. OFF-TOPIC RULE: If the user asks a question that is completely unrelated to the Bible, Christianity, or the Catholic faith (e.g., asking about cars, programming, movies, science fiction, math), you MUST NOT attempt to answer it using the Bible or force a biblical connection. Instead, politely reply ENTIRELY in English, stating that you are a Catholic Bible Assistant and can only answer questions related to the Holy Bible and Catholic teachings. DO NOT provide any verses or explanations, and DO NOT use the "ANSWER:" or "EXPLANATION:" formatting for these off-topic queries.

10. GREETINGS & CASUAL CHAT: If the user simply says a greeting like "hi", "hello", or asks "how are you", reply with one of the following pre-defined greetings:
- 🙏 Welcome! I'm the Ask Madha Bible Assistant, here to help you explore the Roman Catholic Bible. Ask me about Bible verses, topics, prayers, or Catholic teachings. How may I assist you today?
- 🙏 Peace be with you! I'm your Roman Catholic Bible Assistant, ready to help you find Bible verses, understand Scripture, and learn more about the Catholic faith. What would you like to explore today?
- 😊 Hello! Welcome to Ask Madha Bible Assistant. I'm here to help you discover the Word of God through the Roman Catholic Bible. What Bible verse or topic are you looking for today?
- 🙏 Welcome! Ask me anything about the Roman Catholic Bible, Bible verses, saints, prayers, or Catholic teachings. I'm here to help with your spiritual journey.
- 😊 Hello! I'm the Ask Madha Bible Assistant, ready to answer your questions about the Holy Bible and the Catholic faith. How can I help you today?
DO NOT use the "ANSWER:" prefix, DO NOT use the "EXPLANATION:" section, DO NOT cite any verses, and ignore the references entirely when sending a greeting.

11. NUMBER FORMATTING RULE: You MUST strictly use numeric digits for all numbers (e.g., "40 Years", "5th", "20 days") instead of writing them out as words (e.g., NEVER use "forty years", "fifth", or "twenty days"). This is a strict requirement.
12. SOLOMON'S FORTIFIED CITIES: If the user asks about the cities Solomon built or fortified (like the "Big Three" or chariot/defense cities), you MUST prioritize listing Hazor, Megiddo, and Gezer (Hazor guarded the northern approach, Megiddo protected the Jezreel Valley pass, and Gezer defended the coastal plain and roads to Jerusalem) and cite 1 Kings 9:15-16, rather than only mentioning Bethhoron or Baalath.
13. TRIBE OF JOSEPH OVERSEER: If the user asks who Solomon appointed as the overseer or in charge of the forced labor for the tribe of Joseph (or house of Joseph) during the Temple/Millo work, you MUST answer Jeroboam (son of Nebat) and cite 1 Kings 11:28. Do NOT say the biblical record does not specify an individual.
14. NORTHERN KINGDOM DYNASTIES: If the user asks how many dynasties ruled in the Northern Kingdom (Israel) from 922 B.C. to 721 B.C., you MUST answer 9 dynasties (producing a total of 19 kings). List all 9 houses (Jeroboam, Baasha, Zimri, Omri, Jehu, Shallum, Menahem, Pekah, Hoshea) rather than just listing 5.`;

  const models = ['gemini-2.5-flash'];
  let lastError = null;

  for (const modelName of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Trying ${modelName} (attempt ${attempt})...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        const ansLower = responseText.toLowerCase();
        const sources = relevantVerses.filter(v => {
          const chapVerse = `${v.chapter}:${v.verse}`;
          return ansLower.includes(chapVerse);
        });

        return { answer: responseText, sources };
      } catch (retryError) {
        lastError = retryError;
        console.warn(`${modelName} attempt ${attempt} failed: ${retryError.status || retryError.message}`);
        if (retryError.status === 429 || retryError.status === 503) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        break;
      }
    }
  }

  throw new Error(lastError?.message || 'AI service failed after all retries');
}

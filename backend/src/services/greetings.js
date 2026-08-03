/**
 * Shared greeting content — single source of truth used both by the
 * zero-LLM-call short-circuit in server.js and by the LLM prompts in
 * chatService.js / englishSearch.js (as their fallback for greeting
 * phrasings the short-circuit regex below doesn't catch).
 */

// Pre-sanitized to match what chatService.js's sanitizeCsiText/TERM_REPLACEMENTS
// would already rewrite these to (RC terminology, e.g. வசனம் -> வார்த்தை,
// விசுவாசம் -> நம்பிக்கை, சமாதானம் -> அமைதி) — verified against that function
// directly rather than hand-guessed, so this short-circuit path (which skips
// sanitization entirely) still serves the same wording the LLM path always has.
export const TAMIL_GREETINGS = [
  '🙏 ஆண்டவர் உங்களோடு இருப்பாராக! நான் Ask Madha, திருவிவிலிய வார்த்தைகளையும் கத்தோலிக்க போதனைகளையும் தேட உங்களுக்கு உதவும் உதவியாளன். இன்று நீங்கள் தேடும் வார்த்தை அல்லது தலைப்பு என்ன?',
  '🙏 இயேசுவுக்கே புகழ்! மரியாயே வாழ்க! Ask Madha-வுக்கு அன்புடன் வரவேற்கிறேன் — திருவிவிலிய வார்த்தைகள், விளக்கங்கள், செபங்கள் மற்றும் நம்பிக்கை சார்ந்த தகவல்களை நான் மகிழ்ச்சியுடன் அளிக்கிறேன். இன்று என்ன அறிய விரும்புகிறீர்கள்?',
  '✝️ கிறிஸ்துவின் அமைதி உங்களோடு இருப்பதாக! திருவிவிலிய வார்த்தைகள், தலைப்புகள், புனிதர்கள் மற்றும் கத்தோலிக்க போதனைகள் குறித்து உங்களுக்கு உதவ நான் தயாராக உள்ளேன். இன்று என்ன அறிய விரும்புகிறீர்கள்?',
  '🙏 ஆண்டவரின் அருளும் அமைதியும் உங்களோடு இருப்பதாக! திருவிவிலியத்தில் நீங்கள் தேடும் வார்த்தை, விளக்கம் அல்லது ஆன்மீக வழிகாட்டுதலைக் கண்டறிய நான் மகிழ்ச்சியுடன் உதவுகிறேன்.',
  '🕊️ பரிசுத்த ஆவியாரின் ஒளி உங்கள்மேல் இருப்பதாக! நான் Ask Madha — திருவிவிலிய வார்த்தைகள், அதிகாரங்கள் மற்றும் கத்தோலிக்க செபங்களைத் தேட உங்களுடன் இருக்கிறேன். எந்த வார்த்தை அல்லது தலைப்பிலிருந்து தொடங்கலாம்?',
  '😊 வணக்கம், அன்பே! Ask Madha திருவிவிலிய உதவியாளனுக்கு உங்களை வரவேற்கிறேன். திருவிவிலிய வார்த்தைகள், தலைப்புகள் அல்லது கத்தோலிக்க நம்பிக்கை குறித்த எந்த கேள்வியையும் என்னிடம் கேளுங்கள்.',
];

export const ENGLISH_GREETINGS = [
  "🙏 Welcome! I'm Ask Madha, your Roman Catholic Bible Assistant — here to help you explore Scripture, prayers, saints, and Church teaching. What would you like to look up today?",
  "🙏 Peace be with you! I'm Ask Madha, ready to help you find Bible verses, understand Scripture, and learn more about the Catholic faith. What can I help you with today?",
  "😊 Hello, and welcome to Ask Madha! I'm here to help you discover God's Word through the Roman Catholic Bible — verses, chapters, or teachings, just ask. What are you looking for today?",
  "✝️ Praised be Jesus Christ! I'm Ask Madha, your companion for exploring the Roman Catholic Bible, prayers, and the lives of the saints. How may I assist you today?",
  "🕊️ Grace and peace to you! Ask me anything about Bible verses, Catholic prayers, or Church teaching — I'm here to walk through Scripture with you. Where would you like to start?",
  "😊 Hi there! I'm Ask Madha, your Roman Catholic Bible Assistant, ready to help with Scripture, saints, prayers, and questions about the faith. What's on your mind today?",
];

// Matches ONLY messages that are basically just a greeting (with optional
// trailing punctuation) — deliberately strict so it never fires on a real
// question that happens to start with a greeting word.
const GREETING_ONLY_RE = /^(?:hi+|hello+|hey+|hai|greetings|vanakkam|good\s*(?:morning|afternoon|evening|night)|how\s+are\s+you|வணக்கம்)[\s!.,?]*$/iu;

export function isGreetingOnly(query) {
  return typeof query === 'string' && GREETING_ONLY_RE.test(query.trim());
}

function resolveGreetingLanguage(query, languagePreference) {
  if (languagePreference === 'english') return 'english';
  if (languagePreference === 'tamil') return 'tamil';
  if (/[஀-௿]/.test(query) || /vanakkam/i.test(query)) return 'tamil';
  return 'english';
}

export function pickGreeting(query, languagePreference) {
  const pool = resolveGreetingLanguage(query, languagePreference) === 'tamil' ? TAMIL_GREETINGS : ENGLISH_GREETINGS;
  return pool[Math.floor(Math.random() * pool.length)];
}

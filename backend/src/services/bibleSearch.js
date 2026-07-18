/**
 * Tamil RC Bible Search Engine v2
 * ─────────────────────────────────
 * High-accuracy retrieval for 35K+ verses using:
 *  • Tamil morphological suffix stripping
 *  • TF-IDF weighted scoring
 *  • Pre-built inverted index (O(1) candidate lookup)
 *  • Bigram / phrase matching
 *  • Thematic keyword expansion
 *  • Direct verse reference parsing (e.g. "மத்தேயு 5:44")
 *  • Cross-book diversity in final results
 */

// ─── Tamil Stop Words ───────────────────────────────────────────────────────
// Common grammatical particles, pronouns, auxiliaries, and high-frequency
// filler words that carry no search signal in Bible verse retrieval.
const TAMIL_STOP_WORDS = new Set([
  // Pronouns
  'நான்', 'நீ', 'அவன்', 'அவள்', 'அவர்', 'அது', 'இது', 'நாம்', 'நாங்கள்',
  'நீங்கள்', 'அவர்கள்', 'அவை', 'இவை', 'தான்', 'தாம்',
  // Possessives
  'என்', 'உன்', 'அவன்', 'எங்கள்', 'உங்கள்', 'தன்',
  // Demonstratives / determiners
  'இந்த', 'அந்த', 'எந்த', 'ஒரு', 'ஒவ்வொரு', 'சில', 'பல', 'எல்லா', 'அனைத்து',
  // Question words (when used alone)
  'என்ன', 'எங்கே', 'எப்படி', 'யார்', 'எது', 'எதற்கு', 'ஏன்',
  // Postpositions / particles
  'மற்றும்', 'அல்லது', 'ஆகிய', 'பற்றி', 'உள்ள', 'என்று', 'போல்', 'வரை',
  'பிறகு', 'முன்', 'பின்', 'மேல்', 'கீழ்', 'உடன்', 'ஆக', 'ஆன', 'ஆகும்',
  'ஆனால்', 'எனவே', 'ஏனெனில்', 'ஆகையால்', 'அதனால்',
  // Verb auxiliaries / common verb forms
  'இருந்தது', 'இருந்தார்', 'இருக்கும்', 'இருக்கிறது', 'இருக்கிறார்',
  'என்றார்', 'என்றான்', 'செய்தார்', 'செய்தான்', 'வந்தார்', 'வந்தான்',
  'சொன்னார்', 'கொண்டு', 'கொண்டார்', 'போனார்',
  // Extremely common Bible words (too frequent to be diagnostic)
  'ஆண்டவர்', 'கடவுள்',
  // Generic fillers
  'தான்', 'கூட', 'மட்டும்', 'தான்', 'போது', 'வேண்டும்', 'முடியும்',
  'இல்லை', 'உண்டு', 'அங்கு', 'இங்கு', 'அப்போது', 'இப்போது',
]);

// ─── Tamil Suffix Stripping ─────────────────────────────────────────────────
// Tamil is agglutinative: one root can take 15+ suffixes.
// We strip common case markers, plural markers, and postpositional clitics
// so "அன்பின்", "அன்பால்", "அன்பிற்கு" all reduce to "அன்" or "அன்பு".
// Ordered longest-first so we match the most specific suffix first.
const TAMIL_SUFFIXES = [
  // Compound / long suffixes
  'களுக்கு', 'களிடம்', 'களில்', 'களின்', 'களை', 'கள்',
  'விலிருந்து', 'இலிருந்து', 'ிலிருந்து',
  'ுக்காக', 'க்காக', 'த்தால்', 'த்தின்', 'த்தை',
  // Case markers
  'க்கு', 'இடம்', 'உடன்', 'ஆல்', 'ால்', 'இல்', 'ில்',
  'ின்', 'ைய', 'ுடன்', 'ிடம்',
  // Short suffixes
  'ை', 'ா', 'ு', 'ி', 'ே', 'ோ',
];

/**
 * Strip common Tamil suffixes to approximate the root form.
 * Only strips if the remaining root is ≥ 2 chars (Tamil characters).
 */
function stemTamil(word) {
  for (const suffix of TAMIL_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 2) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

// ─── Thematic Keyword Expansion ─────────────────────────────────────────────
// Maps common Bible themes to related theological terms so thematic queries
// retrieve a broader, more accurate set of verses.
const THEME_MAP = {
  'அன்பு': ['அன்பின்', 'அன்பால்', 'அன்பிற்கு', 'கருணை', 'பாசம்', 'நேசம்', 'நேசி', 'காதல்', 'இரக்கம்'],
  'நம்பிக்கை': ['நம்பு', 'நம்புங்கள்', 'நம்பினேன்', 'உறுதி', 'ஆறுதல்'],
  'மன்னிப்பு': ['மன்னி', 'மன்னித்து', 'பாவமன்னிப்பு', 'ஒப்புரவு', 'பாவம்', 'மனமாற்றம்', 'மனந்திரும்பு'],
  'இயேசு': ['கிறிஸ்து', 'இயேசுவின்', 'இயேசுவை', 'மெசியா', 'மீட்பர்', 'இறையமகன்', 'மனுமகன்'],
  'உயிர்ப்பு': ['உயிர்த்தெழுந்த', 'உயிர்த்தெழு', 'உயிர்ப்பித்த', 'எழுந்தார்', 'மரணம்', 'கல்லறை', 'அடக்கம்'],
  'செபம்': ['செபி', 'செபிக்க', 'மன்றாட்டு', 'மன்றாடு', 'வேண்டுதல்', 'வேண்டு', 'ஜெபம்'],
  'திருமுழுக்கு': ['முழுக்கு', 'ஞானஸ்நானம்', 'தண்ணீர்', 'யோர்தான்'],
  'நற்கருணை': ['அப்பம்', 'இரத்தம்', 'உடல்', 'திருவிருந்து', 'பாஸ்கா', 'கோப்பை'],
  'தூய ஆவி': ['ஆவியார்', 'தூய ஆவியார்', 'ஆவி', 'பரிசுத்த ஆவி'],
  'சமாதானம்': ['அமைதி', 'சமாதான', 'நிம்மதி', 'அமைதியான', 'கலக்கம்'],
  'ஞானம்': ['அறிவு', 'புத்தி', 'ஞானமுள்ள', 'அறிவுரை', 'போதனை'],
  'வான்னரசு': ['விண்ணரசு', 'வானுலக', 'விண்ணக', 'ஆட்சி', 'அரசு', 'நிலைவாழ்வு'],
  'படைப்பு': ['படைத்த', 'படைத்தார்', 'உருவாக்கி', 'தொடக்க', 'சிருஷ்டி'],
  'இரக்கம்': ['இரக்கமுள்ள', 'கருணை', 'இரங்கு', 'பரிவு', 'அனுதாபம்'],
  'நீதி': ['நீதியான', 'நீதியுள்ள', 'நேர்மை', 'நியாயம்', 'நியாயத்தீர்ப்பு', 'தீர்ப்பு'],
  'பாவம்': ['பாவி', 'பாவங்கள்', 'குற்றம்', 'தீமை', 'அக்கிரமம்', 'அநீதி'],
  'மீட்பு': ['மீட்பர்', 'மீட்டு', 'இரட்சிப்பு', 'மீட்கும்', 'விடுதலை', 'விடுவி'],
  'உடன்படிக்கை': ['உடன்படிக்கையின்', 'ஒப்பந்தம்', 'வாக்குறுதி', 'வாக்கு'],
};

// ─── Curated Topic References ────────────────────────────────────────────────
// Maps specific complex theological questions to exact highly-relevant verses.
const CURATED_TOPICS = [
  {
    topic: 'wicked_prospering',
    // Must match at least one word from EACH group
    keywordGroups: [
      ['தீமை', 'தீய', 'கெட்ட', 'துன்மார்க்க', 'பாவி', 'அநீதி', 'குற்ற'], // Group 1: wicked/evil
      ['வளம்', 'செழி', 'நன்றாக', 'வாழ', 'வெற்றி', 'சுக', 'செல்வ', 'மகிழ்'] // Group 2: prosper/success/wealth
    ],
    refs: [
      'யோபு 12:6', 'யோபு 21:13', 
      'திருப்பாடல்கள் 37:1', 'திருப்பாடல்கள் 37:2', 
      'திருப்பாடல்கள் 73:3', 'திருப்பாடல்கள் 73:12', 
      'திருப்பாடல்கள் 49:16', 'திருப்பாடல்கள் 49:17', 
      'எரேமியா 12:1'
    ]
  },
  {
    topic: 'god_hiding',
    // Matches questions like "கடவுள் தன்னையே ஏன் மறைத்துக் கொள்கிறார்?"
    keywordGroups: [
      ['கடவுள்', 'இறைவன்', 'ஆண்டவர்'], // Group 1: God
      ['மறை', 'ஒளி'] // Group 2: Hide (மறைத்து, ஒளித்து)
    ],
    refs: [
      'எசாயா 45:15'
    ]
  },
  {
    topic: 'god_allowing_injustice',
    // Matches questions like "ஏன் அநீதியை கடவுள் அனுமதிக்கிறார்?"
    keywordGroups: [
      ['கடவுள்', 'இறைவன்', 'ஆண்டவர்'], // Group 1: God
      ['அநீதி', 'தீமை', 'அக்கிரமம்', 'கொடுமை'], // Group 2: Injustice/Evil
      ['அனுமதிக்', 'விடு', 'பொறுத்', 'பார்க்கி', 'சகிக்'] // Group 3: Allowing/Watching/Tolerating
    ],
    refs: [
      'திருப்பாடல்கள் 74:10',
      'திருப்பாடல்கள் 74:11',
      'அபக்கூக்கு 1:2',
      'அபக்கூக்கு 1:3'
    ]
  },
  {
    topic: 'righteous_suffering',
    // Matches questions like "ஏன் நீதிமான் யோபு துன்புற வேண்டும்?"
    keywordGroups: [
      ['நீதிமான்', 'யோபு', 'நல்லவர்', 'நல்லவர்கள்'], // Group 1: Righteous/Job/Good
      ['துன்ப', 'கஷ்ட', 'வேதனை', 'பாடுக', 'அவதி'] // Group 2: Suffer/Pain/Hardship
    ],
    refs: [
      'யோபு 1:8',
      'யோபு 1:9',
      'யோபு 1:12',
      'யோபு 3:1',
      'யோபு 42:10',
      'யோபு 42:12',
      'யாக்கோபு 5:11',
      'உரோமையர் 8:28'
    ]
  },
  {
    topic: 'suffering_as_punishment',
    // Matches questions like "மனித துன்பம் கடவுளின் தண்டனையா?"
    keywordGroups: [
      ['துன்பம்', 'கஷ்டம்', 'வேதனை', 'பாடுகள்', 'வியாதி', 'நோய்'], // Group 1: Suffering/Sickness
      ['கடவுள்', 'இறைவன்', 'ஆண்டவர்', 'கடவுளின்'], // Group 2: God
      ['தண்டனை', 'தண்டனையா', 'பாவத்தின்', 'சாபமா', 'சாபம்'] // Group 3: Punishment/Curse/Sin
    ],
    refs: [
      'யோபு 4:7',
      'யோபு 42:7',
      'யோவான் 9:2',
      'யோவான் 9:3',
      'லூக்கா 13:2',
      'லூக்கா 13:3'
    ]
  },
  {
    topic: 'god_using_evil_nations',
    // Matches questions like "கடவுள் தீய நாடுகளைத் தன் கருவியாகப் பயன்படுத்துவாரா?"
    keywordGroups: [
      ['தீய', 'பொல்லாத', 'அந்நிய'], // Group 1: Evil/Foreign
      ['நாடுகளை', 'நாடுகள்', 'தேசங்களை', 'அரசர்களை'], // Group 2: Nations/Kings
      ['கருவியாக', 'கருவி', 'பயன்படுத்துவாரா', 'பயன்படுத்துகிறாரா'] // Group 3: Instrument/Use
    ],
    refs: [
      'புலம்பல் 5:20',
      'எரேமியா 14:19',
      'எசாயா 10:5',
      'எசாயா 10:6',
      'அபக்கூக்கு 1:6',
      'எரேமியா 27:6'
    ]
  },
  {
    topic: 'justice_and_mercy',
    // Matches questions like "கடவுள் எப்படி நீதியும் இரக்கமும் உள்ளவராக இருக்க முடியும்?"
    keywordGroups: [
      ['நீதி', 'நீதியும்', 'நீதியானவர்', 'நியாயம்'], // Group 1: Justice
      ['இரக்கம்', 'இரக்கமும்', 'பரிவு', 'அன்பு', 'அருள்'], // Group 2: Mercy/Love
      ['எப்படி', 'ஒன்றாக', 'இருக்க', 'முடியும்'] // Group 3: How/Together/Can be
    ],
    refs: [
      'விடுதலைப் பயணம் 34:6',
      'விடுதலைப் பயணம் 34:7',
      'எசாயா 30:18',
      'எரேமியா 31:3',
      'எரேமியா 31:20',
      'எரேமியா 31:34',
      'திருப்பாடல்கள் 85:10',
      'உரோமையர் 3:26'
    ]
  },
  {
    topic: 'father_abandoning_jesus',
    // Matches questions like "இயேசுவின் இவ்வுலக வாழ்வில் வானகத்தந்தை அவரை கைவிட்டு விட்டாரா?"
    keywordGroups: [
      ['இயேசு', 'இயேசுவின்', 'கிறிச்து'], // Group 1: Jesus/Christ
      ['கைவிட்டு', 'கைவிட்டாரா', 'தனியாக', 'விட்டுவிட்டாரா'], // Group 2: Forsaken/Abandoned/Alone
      ['தந்தை', 'இறைவன்', 'ஆண்டவர்', 'கடவுள்', 'வானகத்தந்தை'] // Group 3: Father/God
    ],
    refs: [
      'மாற்கு 15:34',
      'மத்தேயு 27:46',
      'திருப்பாடல்கள் 22:1',
      'திருப்பாடல்கள் 22:24',
      'யோவான் 8:29',
      'யோவான் 16:32',
      'யோவான் 10:30'
    ]
  }
];

// ─── Normalization & Tokenization ───────────────────────────────────────────

/**
 * Normalize a Tamil string for comparison.
 * Lowercases, strips punctuation, and collapses whitespace.
 */
export function normalize(value) {
  return value
    .toLocaleLowerCase('ta-IN')
    .replace(/[.,!?;:"""'''()\[\]{}\-–—*#@&%^~`|\\/<>+=$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a Tamil string: normalize → split → filter stop words → stem.
 */
export function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !TAMIL_STOP_WORDS.has(w));
}

/**
 * Tokenize and stem for index/search purposes.
 */
function tokenizeAndStem(value) {
  return tokenize(value).map(stemTamil);
}

/**
 * Extract bigrams (consecutive pairs) from token array.
 */
function bigrams(tokens) {
  const pairs = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    pairs.push(tokens[i] + ' ' + tokens[i + 1]);
  }
  return pairs;
}

// ─── Direct Reference Parser ────────────────────────────────────────────────
// Matches patterns like "மத்தேயு 5:44", "திருப்பாடல்கள் 23", "1 யோவான் 4:8", "திபா 74: 10-11"

const REF_PATTERN = /^(\d?\s*[^\d\s:]+(?:\s+[^\d\s:]+)*)\s+(\d+)(?::\s*(\d+)(?:\s*-\s*(\d+))?)?$/u;

// Common book abbreviations
const BOOK_ABBREVIATIONS = {
  'தொநூ': 'தொடக்க நூல்', 'விப': 'விடுதலைப் பயணம்', 'லேவி': 'லேவியர்',
  'எண்': 'எண்ணிக்கை', 'இச': 'இணைச் சட்டம்', 'யோசு': 'யோசுவா',
  'நீத': 'நீதித் தலைவர்கள்', 'ரூத்': 'ரூத்து',
  '1 சாமு': '1 சாமுவேல்', '2 சாமு': '2 சாமுவேல்',
  '1 அர': '1 அரசர்கள்', '2 அர': '2 அரசர்கள்',
  '1 குறி': '1 குறிப்பேடு', '2 குறி': '2 குறிப்பேடு',
  'எஸ்': 'எஸ்ரா', 'நெகே': 'நெகேமியா', 'தோபி': 'தோபித்து', 'யூதி': 'யூதித்து',
  'எஸ்த': 'எஸ்தர்', '1 மக்க': '1 மக்கபேயர்', '2 மக்க': '2 மக்கபேயர்',
  'யோபு': 'யோபு', 'திபா': 'திருப்பாடல்கள்', 'சங்': 'திருப்பாடல்கள்',
  'நீமொ': 'நீதிமொழிகள்', 'சஉ': 'சபை உரையாளர்', 'இபா': 'இனிமைமிகு பாடல்',
  'சாஞா': 'சாலமோனின் ஞானம்', 'சீஞா': 'சீராக்',
  'எசா': 'எசாயா', 'எரே': 'எரேமியா', 'புல': 'புலம்பல்', 'பாரூ': 'பாரூக்கு',
  'எசே': 'எசேக்கியேல்', 'தானி': 'தானியேல்',
  'ஒசே': 'ஒசேயா', 'யோவே': 'யோவேல்', 'ஆமோ': 'ஆமோஸ்', 'ஒப': 'ஒபதியா',
  'யோனா': 'யோனா', 'மீக்': 'மீக்கா', 'நாகூ': 'நாகூம்', 'அப': 'அபக்கூக்கு',
  'செப்': 'செப்பனியா', 'ஆகா': 'ஆகாய்', 'செக்': 'செக்கரியா', 'மலா': 'மலாக்கி',
  'மத்': 'மத்தேயு', 'மாற்': 'மாற்கு', 'லூக்': 'லூக்கா', 'யோவா': 'யோவான்',
  'திப': 'திருத்தூதர் பணிகள்', 'உரோ': 'உரோமையர்',
  '1 கொரி': '1 கொரிந்தியர்', '2 கொரி': '2 கொரிந்தியர்',
  'கலா': 'கலாத்தியர்', 'எபே': 'எபேசியர்', 'பிலி': 'பிலிப்பியர்',
  'கொலோ': 'கொலோசையர்',
  '1 தெச': '1 தெசலோனிக்கர்', '2 தெச': '2 தெசலோனிக்கர்',
  '1 திமொ': '1 திமொத்தேயு', '2 திமொ': '2 திமொத்தேயு',
  'தீத்': 'தீத்து', 'பில': 'பிலமோன்', 'எபி': 'எபிரேயர்', 'யாக்': 'யாக்கோபு',
  '1 பேது': '1 பேதுரு', '2 பேது': '2 பேதுரு',
  '1 யோவா': '1 யோவான்', '2 யோவா': '2 யோவான்', '3 யோவா': '3 யோவான்',
  'யூதா': 'யூதா', 'வெளி': 'திருவெளிப்பாடு', 'திவெ': 'திருவெளிப்பாடு',
  'விவிஅறி': 'விவிலிய முன்னுரை', 'நூல்அறி': 'நூல் அறிமுகங்கள்'
};

/**
 * Try to parse a query as a direct verse reference.
 * Returns matching verses or null if the query isn't a reference.
 */
function parseDirectReference(verses, query) {
  const q = query.trim();
  const m = q.match(REF_PATTERN);
  if (!m) return null;

  let bookQuery = m[1].trim();
  
  // Expand abbreviation if it exists
  for (const [abbr, full] of Object.entries(BOOK_ABBREVIATIONS)) {
    if (bookQuery === abbr || bookQuery === abbr + '.') {
      bookQuery = full;
      break;
    }
  }
  
  bookQuery = normalize(bookQuery);
  const chapter = parseInt(m[2], 10);
  const startVerse = m[3] ? parseInt(m[3], 10) : null;
  const endVerse = m[4] ? parseInt(m[4], 10) : startVerse; // If no range, endVerse = startVerse

  // Find matching book (fuzzy: normalize both sides)
  const matchingVerses = verses.filter((v) => {
    const bookNorm = normalize(v.book);
    if (!bookNorm.includes(bookQuery) && !bookQuery.includes(bookNorm)) return false;
    if (v.chapter !== chapter) return false;
    
    if (startVerse !== null) {
      const vNum = parseInt(v.verse, 10);
      if (isNaN(vNum)) return false;
      if (vNum < startVerse || vNum > endVerse) return false;
    }
    return true;
  });

  return matchingVerses.length > 0 ? matchingVerses : null;
}

// ─── Inverted Index ─────────────────────────────────────────────────────────

/**
 * Build an inverted index from an array of enriched verse objects.
 * Returns { index: Map<stem, Set<verseIndex>>, df: Map<stem, number>, verses }
 *
 * Call once at load time (~200ms for 35K verses).
 */
export function buildIndex(verses) {
  const index = new Map();       // stem → Set of verse indices
  const df = new Map();          // stem → number of verses containing it
  const verseStemCache = [];     // per-verse: array of stems (for scoring)
  const verseNormCache = [];     // per-verse: normalized full text (for phrase match)

  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    const fullText = `${v.book} ${v.chapter} ${v.verse} ${v.text}`;
    const normText = normalize(fullText);
    const stems = tokenizeAndStem(fullText);
    const uniqueStems = new Set(stems);

    verseStemCache[i] = stems;
    verseNormCache[i] = normText;

    for (const stem of uniqueStems) {
      if (!index.has(stem)) {
        index.set(stem, new Set());
        df.set(stem, 0);
      }
      index.get(stem).add(i);
      df.set(stem, df.get(stem) + 1);
    }
  }

  return { index, df, verses, verseStemCache, verseNormCache, N: verses.length };
}

// ─── TF-IDF Scoring ─────────────────────────────────────────────────────────

/**
 * Compute IDF weight for a term.
 * log(N / (df + 1)) — smoothed to avoid division by zero.
 */
function idf(N, docFreq) {
  return Math.log((N + 1) / (docFreq + 1)) + 1;
}

/**
 * Score a single verse against the query.
 */
function scoreVerse(verseIdx, queryStems, queryBigrams, normQuery, bibleIndex) {
  const { df, verseStemCache, verseNormCache, N } = bibleIndex;
  const verseStems = verseStemCache[verseIdx];
  const verseNorm = verseNormCache[verseIdx];

  let score = 0;

  // ── 1. TF-IDF token scoring ──
  // For each query stem, count how many times it appears in the verse (TF)
  // and weight by IDF (rarity across the entire Bible).
  for (const qStem of queryStems) {
    const termDF = df.get(qStem) || 0;
    if (termDF === 0) continue;

    // Term frequency in this verse
    let tf = 0;
    for (const vStem of verseStems) {
      if (vStem === qStem) tf++;
      // Partial/prefix match bonus (for stems that share a root)
      else if (vStem.length >= 3 && qStem.length >= 3) {
        if (vStem.startsWith(qStem) || qStem.startsWith(vStem)) {
          tf += 0.5;
        }
      }
    }
    if (tf > 0) {
      // Sublinear TF: 1 + log(tf) to dampen repeated terms
      const tfWeight = 1 + Math.log(tf);
      score += tfWeight * idf(N, termDF);
    }
  }

  // ── 2. Exact phrase match bonus ──
  // If the entire normalized query appears as a substring in the verse text,
  // it's a very strong signal.
  if (normQuery.length > 3 && verseNorm.includes(normQuery)) {
    score += 25;
  }

  // ── 3. Bigram match bonus ──
  // Consecutive token pairs matching indicate phrase-level relevance.
  for (const bg of queryBigrams) {
    if (verseNorm.includes(bg)) {
      score += 8;
    }
  }

  // ── 4. Token coverage bonus ──
  // Reward verses that match more unique query terms (breadth).
  const stemSet = new Set(verseStems);
  let matchedTerms = 0;
  for (const qStem of queryStems) {
    if (stemSet.has(qStem)) matchedTerms++;
    else {
      // Check prefix match
      for (const vs of stemSet) {
        if (vs.length >= 3 && qStem.length >= 3 &&
            (vs.startsWith(qStem) || qStem.startsWith(vs))) {
          matchedTerms += 0.5;
          break;
        }
      }
    }
  }
  const coverage = queryStems.length > 0 ? matchedTerms / queryStems.length : 0;
  if (coverage >= 0.8) score += 10;   // Most terms matched
  else if (coverage >= 0.5) score += 4;

  return score;
}

// ─── Main Search Function ───────────────────────────────────────────────────

/**
 * Search the Bible using the pre-built index.
 *
 * @param {object} bibleIndex - Result of buildIndex()
 * @param {string} query - User's Tamil query
 * @param {number} maxResults - Max results to return (default 12)
 * @param {string} bookFilter - Optional book name to filter by ('all' = no filter)
 * @returns {Array} Top matching verse objects
 */
export function searchBible(bibleIndex, query, maxResults = 12, bookFilter = 'all') {
  if (!query || !query.trim() || !bibleIndex) return [];

  const { index, verses } = bibleIndex;

  // ── Step 1: Direct reference check ──
  const directMatch = parseDirectReference(verses, query.trim());
  if (directMatch) return directMatch.slice(0, maxResults);

  // ── Step 2: Expand query with thematic synonyms ──
  const rawTokens = tokenize(query);
  const expandedTokens = [...rawTokens];
  for (const token of rawTokens) {
    // Check theme map for the raw token and its stem
    const stem = stemTamil(token);
    for (const [theme, synonyms] of Object.entries(THEME_MAP)) {
      const themeStem = stemTamil(theme);
      if (token === theme || stem === themeStem || synonyms.some(s => stemTamil(s) === stem)) {
        // Add theme synonyms (but don't duplicate)
        for (const syn of synonyms) {
          if (!expandedTokens.includes(syn)) expandedTokens.push(syn);
        }
        if (!expandedTokens.includes(theme)) expandedTokens.push(theme);
      }
    }
  }

  const queryStems = [...new Set(expandedTokens.map(stemTamil))];
  const normQuery = normalize(query);
  const queryBigrams = bigrams(tokenizeAndStem(query));

  if (queryStems.length === 0) return [];

  // ── Step 2.5: Curated Topic Matching ──
  // If the query matches a curated topic, we forcefully inject those verses 
  // with a massive score bonus so the AI gets the perfect context.
  const curatedBonus = new Map();
  for (const curated of CURATED_TOPICS) {
    let groupsMatched = 0;
    for (const group of curated.keywordGroups) {
      // Check if at least one keyword in this group matches the query
      const hasMatch = group.some(kw => {
        const stemKw = stemTamil(kw);
        return normQuery.includes(stemKw) || expandedTokens.includes(kw);
      });
      if (hasMatch) groupsMatched++;
    }
    
    // If every semantic group has at least one match, we trigger the topic
    if (groupsMatched === curated.keywordGroups.length) {
      for (const r of curated.refs) {
        const [book, cv] = r.split(' ');
        const [c, v] = cv.split(':');
        const matchIdx = verses.findIndex(x => x.book === book && String(x.chapter) === c && String(x.verse) === v);
        if (matchIdx !== -1) {
          curatedBonus.set(matchIdx, 1000); // Massive bonus to ensure top ranking
        }
      }
    }
  }

  // ── Step 3: Gather candidate verses from inverted index ──
  // Union of all verse indices that contain at least one query stem.
  const candidateSet = new Set();
  
  // Always include curated matches
  for (const idx of curatedBonus.keys()) {
    candidateSet.add(idx);
  }

  for (const stem of queryStems) {
    const posting = index.get(stem);
    if (posting) {
      for (const idx of posting) candidateSet.add(idx);
    }
    // Also check prefix matches for short stems
    if (stem.length >= 3) {
      for (const [key, posting2] of index) {
        if (key.length >= 3 && (key.startsWith(stem) || stem.startsWith(key))) {
          for (const idx of posting2) candidateSet.add(idx);
        }
      }
    }
  }

  if (candidateSet.size === 0) return [];

  // ── Step 4: Apply book filter ──
  let candidates = [...candidateSet];
  if (bookFilter && bookFilter !== 'all') {
    candidates = candidates.filter((idx) => verses[idx].book === bookFilter);
  }

  // ── Step 5: Score all candidates ──
  const scored = candidates
    .map((idx) => {
      let baseScore = scoreVerse(idx, queryStems, queryBigrams, normQuery, bibleIndex);
      if (curatedBonus.has(idx)) baseScore += curatedBonus.get(idx);
      return {
        idx,
        verse: verses[idx],
        score: baseScore,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // ── Step 6: Cross-book diversity ──
  // Ensure results span multiple books for broader AI context.
  const topPool = scored.slice(0, Math.min(40, scored.length));
  const selected = [];
  const seenBooks = new Set();

  // Pass 0: ALWAYS include curated matches first, bypassing diversity filters
  for (const item of topPool) {
    if (item.score >= 1000 && selected.length < maxResults) {
      selected.push(item);
      seenBooks.add(item.verse.book);
    }
  }

  // Pass 1: Top result from each unique book
  for (const item of topPool) {
    if (!selected.includes(item) && !seenBooks.has(item.verse.book) && selected.length < maxResults) {
      selected.push(item);
      seenBooks.add(item.verse.book);
    }
  }

  // Pass 2: Fill remaining with highest-scoring
  for (const item of topPool) {
    if (selected.length >= maxResults) break;
    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  // Final sort by score
  selected.sort((a, b) => b.score - a.score);

  return selected.slice(0, maxResults).map((item) => item.verse);
}

/**
 * List of all books in the RC Tamil Bible (75 books including deuterocanonical)
 */
export const BIBLE_BOOKS = [
  'தொடக்க நூல்', 'விடுதலைப் பயணம்', 'லேவியர்', 'எண்ணிக்கை', 'இணைச் சட்டம்',
  'யோசுவா', 'நீதித் தலைவர்கள்', 'ரூத்து', '1 சாமுவேல்', '2 சாமுவேல்',
  '1 அரசர்கள்', '2 அரசர்கள்', '1 குறிப்பேடு', '2 குறிப்பேடு', 'எஸ்ரா',
  'நெகேமியா', 'எஸ்தர்', 'யோபு', 'திருப்பாடல்கள்', 'நீதிமொழிகள்',
  'சபை உரையாளர்', 'இனிமைமிகு பாடல்', 'எசாயா', 'எரேமியா', 'புலம்பல்',
  'எசேக்கியேல்', 'தானியேல்', 'ஒசேயா', 'யோவேல்', 'ஆமோஸ்', 'ஒபதியா',
  'யோனா', 'மீக்கா', 'நாகூம்', 'அபக்கூக்கு', 'செப்பனியா', 'ஆகாய்',
  'செக்கரியா', 'மலாக்கி', 'தோபித்து', 'யூதித்து', 'எஸ்தர் (கி)',
  'சாலமோனின் ஞானம்', 'சீராக்', 'பாரூக்கு', 'தானியேல் (இ)',
  '1 மக்கபேயர்', '2 மக்கபேயர்', 'மத்தேயு', 'மாற்கு', 'லூக்கா',
  'யோவான்', 'திருத்தூதர் பணிகள்', 'உரோமையர்', '1 கொரிந்தியர்',
  '2 கொரிந்தியர்', 'கலாத்தியர்', 'எபேசியர்', 'பிலிப்பியர்',
  'கொலோசையர்', '1 தெசலோனிக்கர்', '2 தெசலோனிக்கர்', '1 திமொத்தேயு',
  '2 திமொத்தேயு', 'தீத்து', 'பிலமோன்', 'எபிரேயர்', 'யாக்கோபு',
  'யூதா', 'திருவெளிப்பாடு', 'விவிலிய முன்னுரை', 'நூல் அறிமுகங்கள்',
];

/**
 * Extract all Bible verses cited in a block of text, mapping them to the full verses array.
 * Supports ranges like "மத்தேயு 5:44-48"
 */
export function extractVersesFromText(text, verses) {
  if (!text || !verses) return [];
  
  // Collect unique books from the loaded database (including prefaces and intros)
  const uniqueBooks = Array.from(new Set(verses.map(v => v.book)));
  
  // Sort books by length descending to match longest first
  const allBooks = [...uniqueBooks, ...Object.keys(BOOK_ABBREVIATIONS)].sort((a, b) => b.length - a.length);
  const bookRegexStr = allBooks.map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  
  // (Book Name) (Chapter):(Verse)(-(Verse))?
  const regex = new RegExp(`(${bookRegexStr})\\s+(\\d+):\\s*(\\d+)(?:\\s*-\\s*(\\d+))?`, 'giu');
  
  const matches = [...text.matchAll(regex)];
  const extracted = [];
  const seenRefs = new Set();
  
  for (const match of matches) {
    const bookQuery = match[1];
    const chapter = parseInt(match[2], 10);
    const startVerse = parseInt(match[3], 10);
    const endVerse = match[4] ? parseInt(match[4], 10) : startVerse;
    
    let fullBook = bookQuery;
    const nq = normalize(bookQuery);
    // Find the full book name if it's an abbreviation, otherwise rely on BIBLE_BOOKS match
    for (const [abbr, full] of Object.entries(BOOK_ABBREVIATIONS)) {
      if (nq === normalize(abbr)) {
        fullBook = full; break;
      }
    }
    
    const matchingVerses = verses.filter(v => {
      const vBookNorm = normalize(v.book);
      const qBookNorm = normalize(fullBook);
      if (vBookNorm !== qBookNorm && !vBookNorm.includes(qBookNorm)) return false;
      if (v.chapter !== chapter) return false;
      const vNum = parseInt(v.verse, 10);
      if (isNaN(vNum)) return false;
      return vNum >= startVerse && vNum <= endVerse;
    });
    
    for (const v of matchingVerses) {
      if (!seenRefs.has(v.ref)) {
        seenRefs.add(v.ref);
        extracted.push(v);
      }
    }
  }
  
  return extracted;
}

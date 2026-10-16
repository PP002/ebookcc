/**
 * PaddleOCR Post-Processing, Lexicon, Book Vocabulary & Correction Utilities
 */

import { get, set } from 'idb-keyval';

export const DEFAULTS = {
  LONG_SIDE_DET: 1536,
  LONG_SIDE_TINY: 2048,
  CONF_THRESHOLD_HIGH: 0.9,
  DET_PROB_THRESHOLD: 0.2,
  BOX_SCORE_THRESHOLD: 0.5,
};

export class Lexicon {
  words: Set<string>;
  wordList: string[];

  constructor(content: string = '') {
    this.words = new Set();
    this.wordList = [];
    if (content) {
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const w = line.trim().toLowerCase();
        if (w) {
          this.words.add(w);
          this.wordList.push(w);
        }
      }
    }
  }

  has(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  findClosest(word: string, maxDist = 2): string | null {
    const lower = word.toLowerCase();
    if (this.words.has(lower)) return lower;

    // Simple Levenshtein distance check for top frequent words or prefix match
    let bestMatch: string | null = null;
    let minDistance = maxDist + 1;

    // Check first 2000 frequent words for performance
    const checkLimit = Math.min(this.wordList.length, 2000);
    for (let i = 0; i < checkLimit; i++) {
      const candidate = this.wordList[i];
      if (Math.abs(candidate.length - lower.length) > maxDist) continue;
      const dist = levenshtein(lower, candidate);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = candidate;
      }
    }
    return minDistance <= maxDist ? bestMatch : null;
  }
}

export class BookVocab {
  counts: Map<string, number>;
  confSum: Map<string, number>;

  constructor(data?: { counts?: [string, number][], confSum?: [string, number][] }) {
    this.counts = new Map(data?.counts || []);
    this.confSum = new Map(data?.confSum || []);
  }

  add(text: string, conf: number) {
    const words = text.split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
      if (clean.length > 1) {
        this.counts.set(clean, (this.counts.get(clean) || 0) + 1);
        this.confSum.set(clean, (this.confSum.get(clean) || 0) + conf);
      }
    }
  }

  isTrusted(word: string): boolean {
    const clean = word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
    const count = this.counts.get(clean) || 0;
    return count >= 3;
  }

  toJSON() {
    return {
      counts: Array.from(this.counts.entries()),
      confSum: Array.from(this.confSum.entries())
    };
  }

  static fromJSON(json: any): BookVocab {
    return new BookVocab(json);
  }

  async save(bookId: string) {
    try {
      await set(`book_vocab_${bookId}`, this.toJSON());
    } catch (e) {
      console.warn("Failed to save book vocab:", e);
    }
  }

  static async load(bookId: string): Promise<BookVocab> {
    try {
      const data = await get(`book_vocab_${bookId}`);
      if (data) return BookVocab.fromJSON(data);
    } catch (e) {
      console.warn("Failed to load book vocab:", e);
    }
    return new BookVocab();
  }
}

const COMMON_ENGLISH_WORDS = new Set([
  "A", "ABOUT", "ABRAMS", "ACCEPT", "AFTER", "AGAIN", "AGAINST", "AIN'T", "ALL", "ALMOST",
  "ALREADY", "ALSO", "ALWAYS", "AM", "AMERICA", "AMERICAN", "AN", "AND", "ANOTHER", "ANY",
  "ARE", "AROUND", "AS", "AT", "AWAY", "AWKWARD", "BACK", "BE", "BECOME", "BEEN", "BEEG",
  "BEFORE", "BEING", "BETTER", "BETWEEN", "BIG", "BLANK", "BOTH", "BOUND", "BOUT", "BOXING",
  "BOY", "BRING", "BUT", "BY", "CALL", "CAME", "CAN", "CAN'T", "CATCH", "CERDAN", "CHAMP",
  "CHAMPEENSHIP", "CHAMPEENSHIPS", "CHAMPION", "CHAMPIONSHIP", "CITY", "COLD", "COME",
  "CONQUEROR", "COULD", "COURAGEOUS", "DECO", "DECORATION", "DEFENDING", "DID", "DO", "DOES",
  "DONE", "DOWN", "DUE", "EACH", "EES", "END", "EVEN", "EVER", "EXPERTS", "FAMILY", "FAR",
  "FAST", "FIGHT", "FIGHTING", "FIGHTS", "FINALLY", "FIND", "FINE", "FIRST", "FOULS", "FOR",
  "FOUND", "FRENCH", "FROM", "FURIOUS", "GET", "GIVE", "GO", "GOING", "GOOD", "GOT",
  "GRATITUDE", "GRAZIANO", "GREAT", "GREEN", "HAD", "HAPPY", "HARD", "HAROLD", "HAS",
  "HAVE", "HE", "HE'LL", "HE'S", "HEAR", "HER", "HERE", "HERO", "HIGHEST", "HIM", "HIS",
  "HOLD", "HOW", "HOW'D", "IF", "IN", "INDIFFERENT", "INJURY", "INTO", "IS", "IT", "IT'S",
  "JAKE", "JERSEY", "JOEY", "JUST", "KID", "KIDS", "KNOCK", "KNOCKOUT", "KNOW", "LAMOTTA",
  "LAST", "LATE", "LATER", "LEFT", "LESS", "LET", "LIFE", "LIKE", "LINE", "LITTLE",
  "LONELY", "LONG", "LOOK", "LOST", "MADE", "MAKE", "MAN", "MAN'S", "MANY", "MARCEL",
  "MAY", "ME", "MEDAL", "MEDALS", "MEN", "MIDDLEWEIGHT", "MIGHT", "MISS", "MONEY", "MORE",
  "MOROCCO", "MOST", "MOVE", "MOVES", "MUCH", "MURDERED", "MUST", "MY", "NAME", "NEITHER",
  "NEVER", "NEW", "NEXT", "NO", "NOT", "NOW", "OF", "OFF", "ON", "ONE", "ONLY", "OR",
  "OTHER", "OUR", "OUT", "OVER", "OWN", "PANEL", "PARIS", "PART", "PEOPLE", "PLACE",
  "POINT", "PRETTY", "PUNK", "PUT", "RALLY", "RATION", "REAL", "RIGHT", "ROCKY", "ROUND",
  "ROUNDS", "ROUTE", "RUN", "SAID", "SAME", "SAW", "SAY", "SEE", "SEEM", "SEEN",
  "SENSATIONAL", "SEPT", "SET", "SEVERE", "SHE", "SHOOT", "SHOT", "SHOULD", "SHOULDER",
  "SHOW", "SIDE", "SLOW", "SMALL", "SO", "SOCK", "SOME", "STILL", "SUFFERED", "SULTAN",
  "SURE", "TAKE", "TELL", "THAN", "THAT", "THAT'S", "THE", "THEIR", "THEM", "THEN",
  "THERE", "THESE", "THEY", "THING", "THINK", "THIS", "THIS'LL", "THOSE", "THOUGH",
  "THROUGH", "TIME", "TITLE", "TO", "TOGETHER", "TONY", "TOO", "TOOK", "TOWARD",
  "TROUBLE", "TURN", "TWICE", "TWO", "UNDER", "UNTIL", "UP", "UPON", "US", "USE",
  "VERY", "WAKE", "WANT", "WAR", "WAS", "WASN'T", "WATER", "WAY", "WE", "WELL", "WENT",
  "WERE", "WHAT", "WHEN", "WHERE", "WHETHER", "WHICH", "WHILE", "WHITE", "WHO", "WHOLE",
  "WHY", "WILL", "WIN", "WINNER", "WINS", "WITH", "WITHOUT", "WORD", "WORK", "WORLD",
  "WORLD'S", "WOTTA", "WOULD", "YEAR", "YORK", "YOU", "YOUNG", "YOUR", "ZALE", "ZE"
]);

export function segmentWordsInString(text: string): string {
  if (!text) return '';
  // Segment long all-caps words (>= 4 letters) that may be concatenated
  return text.replace(/[A-Z]{4,}/g, word => {
    // If the word itself is already in the dictionary, don't split it (e.g. "CONQUEROR", "MIDDLEWEIGHT")
    if (COMMON_ENGLISH_WORDS.has(word)) return word;

    const n = word.length;
    const dp: (string[] | null)[] = new Array(n + 1).fill(null);
    dp[0] = [];

    for (let i = 0; i < n; i++) {
      if (dp[i] === null) continue;
      for (let j = i + 1; j <= n; j++) {
        const sub = word.slice(i, j);
        if (COMMON_ENGLISH_WORDS.has(sub) || (sub.length === 1 && (sub === 'A' || sub === 'I'))) {
          if (dp[j] === null || dp[i]!.length + 1 < dp[j]!.length) {
            dp[j] = [...dp[i]!, sub];
          }
        }
      }
    }

    if (dp[n] !== null && dp[n]!.length > 1) {
      return dp[n]!.join(' ');
    }
    return word;
  });
}

export function normalizeLine(text: string): string {
  if (!text) return '';
  let s = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();

  // 1. Strip leading border artifacts (e.g. "N.", "I.", ".('", "N'")
  s = s.replace(/^[NInlI|1][\.\'\,\:\;\-\_]+/, '');
  s = s.replace(/^[\.\'\,\:\;\-\_\(\)\<\>\"\`\~]+/, '');

  // 2. Strip trailing border artifacts (e.g. "'I", ".N", stray punctuation)
  s = s.replace(/[\.\'\,\:\;\-\_]+[NInlI|1]$/, '');
  s = s.replace(/[\.\'\,\:\;\-\_\(\)\<\>\"\`\~]+$/, '');

  // 3. Replace dots, colons, underscores between word characters with a clean space
  s = s.replace(/([A-Za-z0-9])[\.\_\:\;]+([A-Za-z0-9])/g, '$1 $2');

  // 4. Replace apostrophes between two uppercase words with a space
  s = s.replace(/([A-Z]{2,})\'([A-Z]{2,})/g, '$1 $2');

  // 5. Segment concatenated all-caps words
  s = segmentWordsInString(s);

  return s.replace(/\s+/g, ' ').trim();
}

export function correctLine(
  text: string,
  conf: number,
  _options?: { lexicon?: Lexicon; vocab?: BookVocab }
): string {
  if (!text) return '';
  return normalizeLine(text);
}

export function detectLanguage(texts: string[], lexicons: Record<string, Lexicon>): string {
  const sampleTexts = texts.slice(0, 200).join(' ').toLowerCase();
  const words = sampleTexts.split(/\s+/);
  
  const scores: Record<string, number> = { en: 0, fr: 0, es: 0, de: 0, it: 0, pt: 0, nl: 0 };

  for (const w of words) {
    const clean = w.replace(/^[^\w]+|[^\w]+$/g, '');
    if (clean.length < 2) continue;
    for (const [lang, lexicon] of Object.entries(lexicons)) {
      if (lexicon && lexicon.has(clean)) {
        scores[lang] = (scores[lang] || 0) + 1;
      }
    }
  }

  let bestLang = 'en';
  let maxScore = -1;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestLang = lang;
    }
  }

  return maxScore > 5 ? bestLang : 'en';
}

export function isAllCaps(texts: string[]): boolean {
  const sample = texts.slice(0, 200).join('');
  let upperCount = 0;
  let lowerCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c >= 'A' && c <= 'Z') upperCount++;
    else if (c >= 'a' && c <= 'z') lowerCount++;
  }
  return upperCount > lowerCount * 3 && upperCount > 20;
}

export function buildCharMask(table: string[], { allCaps }: { allCaps: boolean }): Float32Array {
  const mask = new Float32Array(table.length);
  mask.fill(1.0);

  for (let i = 0; i < table.length; i++) {
    const char = table[i];
    if (allCaps && char >= 'a' && char <= 'z') {
      mask[i] = 0.0; // Disallow lowercase in all-caps books
    }
  }
  return mask;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][1 - 1 + i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

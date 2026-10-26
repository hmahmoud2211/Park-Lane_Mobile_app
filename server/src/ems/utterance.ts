/**
 * Understanding what a customer said, in whatever Arabic they speak it.
 *
 * Alexa hands the skill either slot values (from TurnOn/TurnOff/Status) or,
 * through VoiceCommandIntent's AMAZON.SearchQuery slot, the whole phrase as
 * heard. This module turns either into words the device matcher can compare:
 *
 *  - spelling folded (أ/إ/آ→ا, ة→ه, ى→ي, diacritics, tatweel);
 *  - attached prefixes split off (ال، وال، بال، لل، فال…), so «بالمطبخ» is «مطبخ»;
 *  - dialect synonyms mapped to one concept, so «ضو»، «لمبة»، «إضاءة» and
 *    "light" all match a device called «نور»;
 *  - Gulf, Egyptian, Levantine and MSA verbs read as on, off or a question,
 *    with attached pronouns («شغّليه»، «سكّرها») and polite filler dropped.
 *
 * Nothing here guesses a device: it only produces the action and the words
 * the customer used; voice.ts decides which device, or asks.
 */

export type ParsedAction = 'on' | 'off' | 'status';

export interface ParsedCommand {
  action: ParsedAction | null;
  /** One entry per device named («النور والمكيف» gives two), as heard, minus filler. */
  targets: string[];
  /** «كل الأنوار»، «الكل»، "all the lights". */
  all: boolean;
}

/** Folds the spellings speech recognition varies between, in Arabic and English. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '') // harakat, dagger alif, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Vocabulary (normalized spellings) ----------------------------------------------------

/** Words for the same thing, mapped to one concept. Keys are concepts; never spoken. */
const SYNONYMS: Record<string, readonly string[]> = {
  light: ['نور', 'انوار', 'ضو', 'ضوء', 'اضواء', 'ضي', 'لمبه', 'لمبات', 'لمض', 'اضاءه', 'انارة', 'اناره', 'نجفه', 'ثريا', 'سبوت', 'سبوتات', 'لايت', 'light', 'lights', 'lamp', 'lamps', 'bulb'],
  plug: ['فيش', 'فيشه', 'افياش', 'بريزه', 'برايز', 'مقبس', 'بلك', 'بلج', 'plug', 'socket', 'outlet'],
  ac: ['مكيف', 'مكيفات', 'تكييف', 'كندشن', 'كنديشن', 'سبلت', 'ac', 'aircon'],
  fan: ['مروحه', 'مراوح', 'شفاط', 'fan'],
  heater: ['سخان', 'هيتر', 'دفايه', 'heater'],
  tv: ['تلفزيون', 'تلفاز', 'تليفزيون', 'شاشه', 'تي في', 'tv', 'television'],
  curtain: ['ستاره', 'ستاير', 'ستائر', 'برداية', 'برده', 'curtain', 'curtains', 'blinds'],
  switch: ['مفتاح', 'سويتش', 'سويچ', 'switch'],
  room: ['غرفه', 'غرف', 'اوضه', 'اوده', 'حجره', 'روم', 'room'],
  sleep: ['نوم', 'bedroom'],
  living: ['صاله', 'صالون', 'ليفنج', 'ليفينج', 'معيشه', 'living', 'lounge'],
  kitchen: ['مطبخ', 'kitchen'],
  majlis: ['مجلس', 'ديوانيه', 'majlis'],
  bath: ['حمام', 'بانيو', 'bathroom', 'toilet'],
  office: ['مكتب', 'office', 'study'],
  kids: ['اطفال', 'عيال', 'بزران', 'ولاد', 'kids', 'children'],
  garden: ['حديقه', 'جنينه', 'حوش', 'حوشه', 'garden', 'yard'],
  hall: ['ممر', 'مدخل', 'كوريدور', 'hall', 'hallway', 'entrance'],
};

const CONCEPT = new Map<string, string>();
for (const [concept, words] of Object.entries(SYNONYMS)) {
  for (const word of words) {
    CONCEPT.set(word, concept);
  }
}

/** Command verbs, including imperative, feminine, plural and verbal-noun forms. */
const ON_VERBS = new Set([
  'شغل', 'شغلي', 'شغلو', 'شغلوا', 'اشغل', 'تشغل', 'تشغلي', 'تشغيل', 'شغلولي',
  'ولع', 'ولعي', 'ولعو', 'تولع', 'تولعي', 'اشعل', 'شعل', 'شعلي', 'تشعل',
  'افتح', 'افتحي', 'فتح', 'افتحو', 'تفتح', 'تفتحي',
  'دور', 'دوري', 'تدور', 'شغله', 'قوم', 'قومي', 'وصل', 'وصلي',
  'start', 'enable', 'activate', 'open',
]);
const OFF_VERBS = new Set([
  'طفي', 'اطفي', 'طف', 'اطف', 'اطفيء', 'اطفا', 'اطفاء', 'طفو', 'تطفي', 'تطفيه',
  'سكر', 'سكري', 'اسكر', 'تسكر', 'تسكري', 'سكرو',
  'اقفل', 'اقفلي', 'قفل', 'قفلي', 'تقفل', 'تقفلي',
  'بند', 'بندي', 'تبند', 'وقف', 'وقفي', 'توقف', 'ايقاف', 'اغلق', 'اغلقي', 'تغلق', 'اغلاق',
  'افصل', 'افصلي', 'فصل', 'تفصل', 'سكت', 'نيم',
  'stop', 'disable', 'deactivate', 'kill', 'cut', 'close',
]);
/** States that answer, or with «خلي» request, on and off. */
const ON_STATES = new Set(['شغال', 'شغاله', 'مشغل', 'مشغله', 'شغالين', 'مولع', 'مولعه', 'منور', 'منوره', 'مفتوح', 'مفتوحه', 'on']);
const OFF_STATES = new Set(['طافي', 'طافيه', 'مطفي', 'مطفيه', 'مطفا', 'مسكر', 'مسكره', 'مقفول', 'مقفوله', 'مقفل', 'مغلق', 'مغلقه', 'واقف', 'واقفه', 'off']);
const MAKE = new Set(['خلي', 'خليه', 'خليها', 'خليهم', 'اجعل', 'خلو', 'خل', 'حط', 'خليلي']);
const QUESTION = new Set([
  'هل', 'وش', 'ايش', 'شو', 'ايه', 'شنو', 'كيف', 'حاله', 'وضع', 'شلون', 'اش', 'مين', 'ليش',
  'is', 'are', 'was', 'were', 'what', 'whats', 'which', 'how', 'hows', 'check', 'status', 'state', 'did', 'whether',
]);
/** Plurals mean every device of that kind: "lights off", «طفي الأنوار». */
const PLURALS = new Set(['lights', 'lamps', 'bulbs', 'plugs', 'sockets', 'fans', 'heaters', 'انوار', 'اضواء', 'لمبات', 'لمض', 'افياش', 'مكيفات', 'مراوح', 'سبوتات']);

/** English verbs that take on/off after the object: "turn the kitchen light on". */
const TURN = new Set(['turn', 'switch', 'power', 'put', 'set', 'shut', 'flip', 'get']);
const ALL = new Set(['كل', 'جميع', 'كلها', 'كلهم', 'الكل', 'all', 'every', 'everything']);
/** Wanting, asking and politeness, which carry no meaning for the command. */
const FILLER = new Set([
  'ابي', 'ابغي', 'ابغا', 'ابغى', 'ابا', 'عايز', 'عاوز', 'عاوزه', 'عايزه', 'بدي', 'بدنا', 'اريد', 'اريدك', 'نبي', 'نبغي', 'حابب', 'حابه', 'ودي',
  'ممكن', 'تقدر', 'تقدري', 'اقدر', 'يمكنك', 'لو', 'سمحت', 'سمحتي', 'فضلك', 'فضلكي', 'بليز', 'رجاء', 'رجاءا', 'الله', 'يخليك', 'يخليكي', 'يرحم', 'والديك',
  'ريت', 'يا', 'اليكسا', 'الكسا', 'الیکسا', 'please', 'alexa', 'can', 'could', 'you', 'would', 'kindly', 'i', 'want', 'need', 'to',
  // Generic «thing»/«devices», as in «طفي كل شي»، «كل الأجهزة».
  'شي', 'شيء', 'اشي', 'حاجه', 'حاجات', 'اغراض', 'جهاز', 'اجهزه', 'thing', 'things', 'device', 'devices',
  // English pronouns, contractions ("what's" folds to "what s") and conversational padding.
  'it', 's', 'd', 'll', 'm', 're', 't', 'them', 'they', 'that', 'this', 'these', 'those', 'hey', 'ok', 'okay', 'let', 'lets', 'us', 'me',
  'mind', 'like', 'go', 'ahead', 'for', 'will', 'do', 'does', 'have', 'get', 'got', 'currently', 'right', 'still', 'left', 'leave',
  'tell', 'if', 'there', 'anything', 'something', 'thanks', 'too', 'also', 'as', 'well', 'with', 'by', 'to', 'into', 'set', 'put', 'flip', 'shut',
  'لي', 'لنا', 'الحين', 'الان', 'هلا', 'هلق', 'دلوقتي', 'هسا', 'هسه', 'بسرعه', 'شوي', 'شويه', 'now', 'just',
  'حق', 'تبع', 'بتاع', 'بتاعه', 'تبعه', 'حقت', 'الي', 'اللي', 'يلي', 'اللذي', 'الذي', 'التي', 'هذا', 'هذي', 'هاذا', 'ده', 'دي',
  'في', 'على', 'من', 'عن', 'الى', 'لـ', 'the', 'my', 'in', 'on', 'of', 'a', 'an', 'at', 'and', 'off', 'is', 'are', 'status', 'what', 'turn', 'switch', 'power', 'shut', 'down', 'up',
]);

/** Pronouns and particles glued to a verb: «شغّليه»، «سكّرها»، «طفّيلي». */
const VERB_SUFFIXES = ['هملي', 'هالي', 'هم', 'ها', 'لي', 'ه', 'و', 'ي'];
/** Prefixes glued to a noun: «والمكيف»، «بالمطبخ»، «للصالة»، «فالغرفة». */
const NOUN_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال'];

function verbOf(word: string): ParsedAction | null {
  const forms = [word, ...VERB_SUFFIXES.filter((suffix) => word.length > suffix.length + 1 && word.endsWith(suffix)).map((suffix) => word.slice(0, -suffix.length))];
  if (forms.some((form) => ON_VERBS.has(form))) {
    return 'on';
  }
  if (forms.some((form) => OFF_VERBS.has(form))) {
    return 'off';
  }
  return null;
}

function stateOf(word: string): ParsedAction | null {
  return ON_STATES.has(word) ? 'on' : OFF_STATES.has(word) ? 'off' : null;
}

/** The word without attached prefixes, mapped to its concept when it has one. */
export function canonicalWord(raw: string): string {
  let word = raw;
  for (const prefix of NOUN_PREFIXES) {
    if (word.startsWith(prefix) && word.length - prefix.length >= 2) {
      word = word.slice(prefix.length);
      break;
    }
  }
  // A bare «و» (and) only when what follows is a word we know: «ولع» and «وقف» are verbs.
  if (word === raw && word.startsWith('و') && word.length > 3 && CONCEPT.has(word.slice(1))) {
    word = word.slice(1);
  }
  return CONCEPT.get(word) ?? CONCEPT.get(raw) ?? word;
}

/** The comparable words of a device name, room or spoken phrase. */
export function words(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return normalize(value)
    .split(' ')
    .filter((word) => word && !FILLER.has(word))
    .map(canonicalWord)
    .filter((word) => word && !FILLER.has(word));
}

/** Same word, allowing one slip of speech recognition in longer words. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  // Levenshtein distance, stopping once it passes 1.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > 1) {
      return false;
    }
    previous = current;
  }
  return previous[b.length] <= 1;
}

const SEGMENT_SPLIT = /\s+و(?=ال)|\s+و\s+|\s+and\s+|،|,|\s+كمان\s+|\s+وكمان\s+/;

/**
 * Reads a whole phrase: what to do, to which devices, and whether to all of them.
 * «لو سمحت شغّل نور غرفة النوم والمكيف» → { action: 'on', targets: ['نور غرفه النوم', 'المكيف'] }.
 */
export function parseUtterance(text: string): ParsedCommand {
  const folded = normalize(text)
    // English phrasal verbs before their words are dropped as filler.
    .replace(/\b(turn|switch|power) on\b|\bturn it on\b/g, ' شغل ')
    .replace(/\b(turn|switch|power|shut) (off|down)\b|\bturn it off\b/g, ' طفي ');

  let verb: ParsedAction | null = null;
  let made: ParsedAction | null = null;
  let state: ParsedAction | null = null;
  let question = false;
  let all = false;
  let turning = false;
  /** "lights on" / "kitchen off": an English on/off with no question is a command. */
  let englishState: ParsedAction | null = null;
  const targets: string[] = [];

  for (const segment of folded.split(SEGMENT_SPLIT)) {
    const kept: string[] = [];
    let making = false;
    for (const word of segment.split(' ').filter(Boolean)) {
      const asVerb = verbOf(word);
      if (asVerb) {
        verb = verb ?? asVerb;
        continue;
      }
      if (MAKE.has(word)) {
        making = true;
        continue;
      }
      if (TURN.has(word)) {
        turning = true;
        continue;
      }
      const asState = stateOf(word);
      if (asState) {
        if (turning && (word === 'on' || word === 'off')) {
          verb = verb ?? asState;
          continue;
        }
        if (word === 'on' || word === 'off') {
          englishState = englishState ?? asState;
        }
        if (making) {
          made = made ?? asState;
        } else {
          state = state ?? asState;
        }
        continue;
      }
      if (QUESTION.has(word)) {
        question = true;
        continue;
      }
      if (ALL.has(word)) {
        all = true;
        continue;
      }
      if (PLURALS.has(word.replace(/^(وال|بال|فال|كال|لل|ال)/, ''))) {
        all = true;
      }
      kept.push(word);
    }
    // Kept as heard (minus filler), so it can be spoken back; matching maps it to concepts.
    const target = kept.filter((word) => !FILLER.has(word)).join(' ');
    if (words(target).length > 0) {
      targets.push(target);
    }
  }

  // A command verb wins; «خلّي النور شغال» is a command too; a bare state or question asks.
  const action: ParsedAction | null =
    verb ?? made ?? (englishState && !question ? englishState : null) ?? (state || question ? 'status' : null);
  return { action, targets, all };
}

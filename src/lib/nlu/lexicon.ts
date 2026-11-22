/**
 * Word lists for the rule-based Hindi/Hinglish/Magahi (Begusarai) NLU layer.
 *
 * This is deliberately NOT a claim of full dialect coverage — see
 * src/app/language-lab for the testing loop that is meant to grow this list
 * from real call samples over time.
 */

// Devanagari digits 0-9 -> Latin digit.
export const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

// Spoken number words -> numeric value. Keys are normalized (lowercased,
// diacritics kept as-is) Roman transliterations AND Devanagari spellings,
// covering standard Hindi plus common Bihar/Bhojpuri/Maithili/Magahi forms.
export const NUMBER_WORDS: Record<string, number> = {
  shunya: 0, "शून्य": 0,
  ek: 1, "एक": 1,
  do: 2, "दो": 2,
  teen: 3, "तीन": 3,
  char: 4, chaar: 4, "चार": 4,
  panch: 5, paanch: 5, "पांच": 5, "पाँच": 5,
  chhah: 6, chhe: 6, che: 6, "छह": 6, "छे": 6,
  saat: 7, "सात": 7,
  aath: 8, "आठ": 8,
  nau: 9, "नौ": 9,
  das: 10, dus: 10, "दस": 10,
  gyarah: 11, "ग्यारह": 11,
  barah: 12, "बारह": 12,
  terah: 13, "तेरह": 13,
  chaudah: 14, "चौदह": 14,
  pandrah: 15, "पंद्रह": 15, "पन्द्रह": 15,
  solah: 16, "सोलह": 16,
  satrah: 17, "सत्रह": 17,
  atharah: 18, "अठारह": 18,
  unnis: 19, "उन्नीस": 19,
  bees: 20, bis: 20, "बीस": 20,
  pachees: 25, pachchees: 25, "पच्चीस": 25,
  tees: 30, tis: 30, "तीस": 30,
  paintees: 35, "पैंतीस": 35,
  chalis: 40, chaalis: 40, "चालीस": 40,
  paintalis: 45, "पैंतालीस": 45,
  pachas: 50, pachaas: 50, pachaash: 50, "पचास": 50,
  dui: 2, "दुइ": 2, chari: 4, "चारि": 4, // Maithili variants of do/char
  pachpan: 55, "पचपन": 55,
  saath: 60, sath: 60, "साठ": 60,
  paisath: 65, "पैंसठ": 65,
  sattar: 70, "सत्तर": 70,
  pachhattar: 75, pachattar: 75, "पचहत्तर": 75,
  assi: 80, "अस्सी": 80,
  pachasi: 85, "पचासी": 85,
  nabbe: 90, "नब्बे": 90,
  pachanve: 95, "पचानवे": 95,
  sau: 100, "सौ": 100,
  dedh: 1.5, "डेढ़": 1.5, // "dedh lakh" = 1.5 lakh, "dedh sau" = 150
  dhai: 2.5, "ढाई": 2.5,
};

// Multiplier words -> factor.
export const MULTIPLIER_WORDS: Record<string, number> = {
  sau: 100, "सौ": 100,
  hazar: 1000, hazaar: 1000, hajar: 1000, "हजार": 1000, "हज़ार": 1000,
  lakh: 100000, laakh: 100000, "लाख": 100000,
  crore: 10000000, karod: 10000000, "करोड़": 10000000, "करोड": 10000000,
};

export const FRACTION_WORDS: Record<string, number> = {
  aadha: 0.5, aadhi: 0.5, adha: 0.5, "आधा": 0.5, "आधी": 0.5,
  pura: 1, poora: 1, puri: 1, sara: 1, saara: 1, "पूरा": 1, "पूरी": 1, "सारा": 1,
  chauthai: 0.25, "चौथाई": 0.25,
};

export const RELATIVE_DAY_WORDS: Record<string, number> = {
  aaj: 0, "आज": 0,
  kal: 1, "कल": 1, // future-leaning in a payment-promise context
  parso: 2, parson: 2, "परसों": 2, "परसो": 2,
  narso: 3, narson: 3, "नरसों": 3,
  // English
  today: 0, tomorrow: 1,
};

export const WEEKDAY_WORDS: Record<string, number> = {
  ravivar: 0, sunday: 0, "रविवार": 0, itwar: 0, "इतवार": 0,
  somvar: 1, somar: 1, monday: 1, "सोमवार": 1, "सोमर": 1,
  mangalvar: 2, mangal: 2, tuesday: 2, "मंगलवार": 2,
  budhvar: 3, budh: 3, wednesday: 3, "बुधवार": 3,
  guruvar: 4, brihaspativar: 4, thursday: 4, "गुरुवार": 4, "बृहस्पतिवार": 4,
  shukravar: 5, friday: 5, "शुक्रवार": 5,
  shanivar: 6, saturday: 6, "शनिवार": 6,
};

export const NEXT_MARKERS = [
  "agle", "agla", "aglaa", "agli", "agila", "agile",
  "अगले", "अगला", "अगली", "अगिला", "अगिले",
  "next", "aane wale", "aanewale",
];

export const PARTIAL_MARKERS = [
  "thoda", "thodi", "kuch", "jitna ho payega", "jitna abhi ho payega", "jitna ban payega",
  "sirf", "kewal", "bas itna",
  "थोड़ा", "थोड़ी", "कुछ", "जितना हो पाएगा", "जितना अभी हो पाएगा",
  "सिर्फ", "सिर्फ़", "केवल", "बस इतना",
  // Magahi/Maithili
  "थोड़েক", "किछु", "सिरिफ",
  // English
  "only", "just", "as much as i can",
];

/**
 * A stated amount smaller than the outstanding balance is NOT by itself
 * treated as a partial payment (see extract.ts's isPartialAmount comment —
 * "₹50,000 out of ₹75,000" alone is still a normal WILL_PAY promise). These
 * phrases are the second, narrower signal: the customer's own words say more
 * money is coming AFTER what they just promised ("10000 abhi, baaki baad
 * mein") — only then does the engine additionally ask when the remainder
 * will be paid. See engine.ts's progressAfterExtraction.
 */
export const REMAINDER_LATER_PHRASES = [
  "baad mein", "baad me", "phir baad", "aur baad", "baaki", "baki paise", "baki paisa",
  "baaki paisa", "baaki paise", "aur paisa baad",
  "बाद में", "फिर बाद में", "और बाद में", "बाकी", "बाकी पैसा", "बाकी पैसे",
  // Magahi/Maithili
  "बाद मे", "बाँकी",
  // English
  "later", "the rest later", "rest later", "remaining later", "remaining amount later",
];

export const AFTER_DAYS_PATTERN = /(\d+|[a-zA-Z]+|[ऀ-ॿ]+)\s*din\s*(baad|bad|ke\s*baad)/i;
export const AFTER_DAYS_PATTERN_DEVANAGARI = /(\d+|[ऀ-ॿ]+)\s*दिन\s*(बाद|के\s*बाद)/;
// English: "5 days later" / "in 5 days" / "5 days from now"
export const AFTER_DAYS_PATTERN_ENGLISH =
  /(\d+|[a-zA-Z]+)\s*days?\s*(later|from\s*now|after|from\s*today)|in\s*(\d+|[a-zA-Z]+)\s*days?/i;

// Keyword sets for intent classification. All lowercase.
// Magahi (Begusarai) additions below extend the validated client-sample
// morphology (-तै/-लक/-लियै/-ियो endings, "जनि" negative imperative) into
// each intent category — see the comment on MAGAHI_MARKERS in
// src/lib/nlu/language.ts for provenance and the language-lab validation loop.

export const ALREADY_PAID_PHRASES = [
  "de diye", "de diya", "de diya hai", "de chuke", "de chuke hain", "de chuki",
  "kar diya", "kar diye", "kar diya hai", "kar chuke", "pay kar diya", "payment kar diya",
  "payment kar diye", "cash de diye", "staff ko de diye", "dukan me de diye",
  "paisa de diya", "paise de diye", "paisa jama kar diya", "diya tha maine",
  "de dinhe", "de dinhi", "dihe", "dei dihni",
  "पैसा दे दिए", "पइसा पहिले ही दे दिए", "पैसे दे दिए", "पैसा जमा कर दिया", "पेमेंट कर दिया",
  "दे दिए हैं", "दे दिया है",
  // Magahi
  "पइसा दे देलियै", "पइसा पहिलहीं दे देलियै", "पेमेंट हो गेलै", "पइसा जमा करा देलियै",
  "दुकान में दे देलियै", "हम त दे देलियै", "पइसा दे देलक",
  // Maithili
  "पैसा दऽ देलहुँ", "पहिनहि दऽ देलहुँ", "पेमेंट भऽ गेल अछि", "दोकान मे दऽ देलहुँ", "हम तँ दऽ देलहुँ",
  // English
  "already paid", "i have paid", "i already paid", "paid it already", "paid last week",
  "i gave the money", "i gave it to your staff", "already given",
];

export const CANNOT_PAY_PHRASES = [
  "nahi de payenge", "nahi de paunga", "abhi paisa nahi hai", "paisa nahi hai",
  "abhi nahi", "abhi possible nahi", "tang hu", "paise ki dikkat hai",
  "nahi ho payega abhi", "kaam nahi chal raha", "ghata ho gaya",
  "अभी पैसा नइखे", "पैसा नहीं है", "अभी संभव नहीं",
  // Magahi
  "अभी हमरा लगे पइसा नइखे", "अखने पइसा के दिक्कत छै", "अभी नइखे हो पातै", "पइसा के इंतजाम नइखे",
  // Maithili
  "अखन हमरा लग पैसा नहि अछि", "अखन दिक्कत अछि", "अखन नहि भऽ पाओत", "पैसाक इंतजाम नहि अछि",
  // English
  "i don't have money right now", "i can't pay right now", "no money right now",
  "having a tough time financially", "business is not doing well", "not possible right now",
];

export const REFUSED_PHRASES = [
  "nahi dunga", "nahi denge", "paisa nahi milega", "bilkul nahi", "kabhi nahi",
  "wapas nahi karunga", "maine kuch nahi liya", "galat charge kiya",
  "नहीं दूंगा", "बिल्कुल नहीं",
  // Magahi
  "हम नइखे देतिए", "कबहूं नइखे देबियो", "बिलकुल नइखे देतिए", "हमरा से कुछ नइखे लेलक",
  // Maithili
  "हम नहि देब", "कहियो नहि देब", "बिलकुल नहि देब", "हमरा सँ किछु नहि लेल गेल",
  // English
  "i won't pay", "i will not pay", "never paying", "i refuse to pay", "not paying this",
];

export const CALLBACK_PHRASES = [
  "baad me call karo", "baad mein call kijiye", "thodi der baad call", "abhi busy hu",
  "abhi baat nahi kar sakta", "kal baat karte hain call pe", "shaam ko call karo",
  "फिर कॉल करो", "बाद में कॉल कीजिए",
  // Magahi
  "बाद में फोन करियो", "अभी हम व्यस्त छियै", "बाद में बात करतिए", "साँझ के फोन करियो",
  // Maithili
  "बाद मे फोन करू", "अखन व्यस्त छी", "बाद मे बात करब", "साँझ मे फोन करू",
  // English
  "call me later", "call back later", "i'm busy right now", "can't talk right now",
  "call me in the evening", "call me tomorrow",
];

export const WRONG_NUMBER_PHRASES = [
  "wrong number", "galat number", "aisa yaha koi nahi", "yaha koi nahi rehta",
  "aap galat number pe", "ye number kisi aur ka hai",
  "गलत नंबर", "यहाँ कोई नहीं रहता",
  // Magahi
  "ई नंबर गलत छै", "इहाँ केहू नइखे रहतै", "ई नंबर हमर नइखे",
  // Maithili
  "ई नंबर गलत अछि", "एतय केओ नहि रहैत अछि", "ई नंबर हमर नहि अछि",
  // English
  "no one by that name here", "this is not my number", "you have the wrong number",
];

export const ANGRY_PHRASES = [
  "baar baar call mat karo", "bar bar call mat karo", "pareshan mat karo", "tang mat karo",
  "bakwas band karo", "chup raho", "gussa", "chilla", "phone mat karo", "kitni baar call karoge",
  "फालतू", "बकवास", "परेशान मत करो", "बार बार कॉल मत करो", "गुस्सा",
  // Magahi
  "बार-बार फोन जनि करियो", "परेशान जनि करियो", "तंग जनि करियो", "फोन जनि करियो", "गुस्सा हो गेलियै",
  // Maithili
  "बेर बेर फोन जनि करू", "परेशान जनि करू", "तंग जनि करू", "फोन जनि करू", "गुस्सा भऽ गेलहुँ",
  // English
  "stop calling me", "don't call me again and again", "stop harassing me",
  "how many times will you call", "this is nonsense",
];

export const AFFIRMATIVE_PHRASES = [
  "haan", "haanji", "ha", "ji haan", "ji", "yes", "bilkul", "theek hai", "sahi hai",
  "हां", "हाँ", "जी हां", "जी हाँ", "बिलकुल", "ठीक है", "सही है", "haanji ji",
  // Magahi
  "हँ", "हौ", "ठीक छै", "सही छै",
  // Maithili
  "ठीक अछि", "सही अछि",
  // English
  "sure", "correct", "okay", "that's right", "yeah",
];

export const NEGATIVE_PHRASES = [
  "nahi", "nahin", "na", "ji nahi", "no", "galat", "नहीं", "जी नहीं", "ना",
  // Magahi
  "नाहीं", "ना छै", "नइखे",
  // Maithili
  "नहि", "नहि अछि",
  // English
  "not correct", "that's wrong", "incorrect",
];

export const NO_CONSENT_LANGUAGE_ISSUE_PHRASES = [
  "samajh nahi aaya", "phir se boliye", "hindi nahi aati", "english bolo",
  "kya bola aapne", "dubara boliye",
  "समझ नहीं आया", "फिर से बोलिए",
  // Magahi
  "बुझल नइखे", "फेर से बोलियो", "का कहलक अपने",
  // Maithili
  "बुझल नहि", "फेर सँ कहू", "की कहलहुँ अहाँ",
  // English
  "i didn't understand", "could you say that again", "please repeat", "what did you say",
];

/**
 * Localized AI dialogue lines, keyed by Customer.preferredLanguage.
 *
 * The call engine's DECISIONS (stage transitions, what counts as a promise,
 * when to escalate) never change by language — only the words spoken to the
 * customer do. Keeping that logic in engine.ts and only the text here keeps
 * the "AI never records a payment" and anti-spam invariants language-independent.
 *
 * "magahi" uses Begusarai's actual local speech (Magahi/Maithili-influenced
 * Devanagari text, matching MAGAHI_MARKERS in src/lib/nlu/language.ts) — it
 * was previously mislabeled "begusarai"/Bhojpuri; that key is now an alias
 * for back-compat with existing Customer.preferredLanguage rows. See
 * README's Bhashini caveat: the TTS *voice* speaking these lines over a real
 * call still uses Bhashini's Hindi model, since Magahi isn't a confirmed
 * Bhashini voice. The text is genuinely Magahi; the voice reading it is not
 * (until Bhashini confirms Magahi coverage — see
 * src/lib/providers/bhashiniPipeline.ts). This file only covers the TEXT
 * layer — see getDialogue's caller comment for scope.
 */

export interface DialogueLines {
  /** businessName comes from AppSettings.businessName — see engine.ts's startCall. */
  greeting(customerName: string, businessName: string): string;
  reasonAndAsk(amountText: string): string;
  confirmation(amountText: string, dateText: string): string;
  alreadyPaid(): string;
  wrongNumberIdentity(): string;
  unclearIdentity(): string;
  wrongNumberPaymentInfo(): string;
  callbackRequested(): string;
  refused(): string;
  cannotPay(): string;
  uncertain(): string;
  askUnclear(): string;
  clarifyAmount(): string;
  clarifyDate(): string;
  angryDeescalate(): string;
  confirmed(customerName: string, dateText: string): string;
  /** Asked when a partial-payment promise leaves outstandingAmount uncovered. */
  askRemainder(remainingAmountText: string): string;
  /** confirmationLine variant used once a remainder date has also been collected. */
  confirmationPartial(amountText: string, dateText: string, remainingAmountText: string, remainingDateText: string): string;
}

const hinglish: DialogueLines = {
  greeting: (name, businessName) => `Namaste! ${businessName} se baat kar rahe hain. Kya hum ${name} ji se baat kar rahe hain?`,
  reasonAndAsk: (amount) =>
    `Ji, aapke account mein jo baki payment hai uske sambandh mein baat karni thi. ` +
    `Aapke account mein ${amount} baki dikh raha hai. Aap payment kab tak kar paayenge?`,
  confirmation: (amount, date) => `Achha ji, aap keh rahe hain ki ${amount} ${date} ko denge, sahi samjhe?`,
  alreadyPaid: () =>
    "Samajh gaya. Hum is payment ko verify karwa lenge — hamara staff aapse jald sampark karega. Dhanyavaad.",
  wrongNumberIdentity: () => "Theek hai, maaf kijiye taklif ke liye. Hum record update kar denge.",
  unclearIdentity: () => "Koi baat nahi, hum baad mein dobara call karenge. Dhanyavaad.",
  wrongNumberPaymentInfo: () => "Theek hai, maaf kijiye taklif ke liye.",
  callbackRequested: () => "Koi baat nahi, hum baad mein call karenge. Dhanyavaad.",
  refused: () => "Theek hai ji, hum is baare mein hamare staff se baat karwa denge. Dhanyavaad aapke samay ke liye.",
  cannotPay: () => "Koi baat nahi ji. Aap expect karte hain ki kab tak payment kar payenge?",
  uncertain: () => "Maaf kijiye, mujhe poori tarah samajh nahi aaya. Hamara staff member aapko jald call karega. Dhanyavaad.",
  askUnclear: () => "Maaf kijiye, samajh nahi aaya. Kya aap dobara bata sakte hain ki aap kab tak aur kitna payment kar payenge?",
  clarifyAmount: () => "Ji, aap kitni raashi de payenge?",
  clarifyDate: () => "Ji, aap yeh payment kab tak kar payenge?",
  angryDeescalate: () =>
    "Maaf kijiye agar aapko takleef hui. Hum aapko dobara pareshan nahi karenge. " +
    "Kya aap chahenge ki hamara staff member aapse seedha baat kare?",
  confirmed: (name, date) => `Dhanyavaad ${name} ji! Hum ${date} ko follow-up karenge.`,
  askRemainder: (remainingAmount) => `Theek hai, aur baaki ${remainingAmount} aap kab tak de payenge?`,
  confirmationPartial: (amount, date, remainingAmount, remainingDate) =>
    `Achha ji, aap ${amount} ${date} ko denge, aur baaki ${remainingAmount} ${remainingDate} ko — sahi samjhe?`,
};

const hindi: DialogueLines = {
  greeting: (name, businessName) => `नमस्ते! ${businessName} से बात कर रहे हैं। क्या हम ${name} जी से बात कर रहे हैं?`,
  reasonAndAsk: (amount) =>
    `जी, आपके खाते में जो बकाया भुगतान है उसके संबंध में बात करनी थी। ` +
    `आपके खाते में ${amount} बकाया दिख रहा है। आप भुगतान कब तक कर पाएंगे?`,
  confirmation: (amount, date) => `अच्छा जी, आप कह रहे हैं कि ${amount} ${date} को देंगे, सही समझे?`,
  alreadyPaid: () => "समझ गया। हम इस भुगतान को सत्यापित करवा लेंगे — हमारा स्टाफ आपसे जल्द संपर्क करेगा। धन्यवाद।",
  wrongNumberIdentity: () => "ठीक है, माफ कीजिए तकलीफ के लिए। हम रिकॉर्ड अपडेट कर देंगे।",
  unclearIdentity: () => "कोई बात नहीं, हम बाद में दोबारा कॉल करेंगे। धन्यवाद।",
  wrongNumberPaymentInfo: () => "ठीक है, माफ कीजिए तकलीफ के लिए।",
  callbackRequested: () => "कोई बात नहीं, हम बाद में कॉल करेंगे। धन्यवाद।",
  refused: () => "ठीक है जी, हम इस बारे में हमारे स्टाफ से बात करवा देंगे। धन्यवाद आपके समय के लिए।",
  cannotPay: () => "कोई बात नहीं जी। आप उम्मीद करते हैं कि कब तक भुगतान कर पाएंगे?",
  uncertain: () => "माफ कीजिए, मुझे पूरी तरह समझ नहीं आया। हमारा स्टाफ सदस्य आपको जल्द कॉल करेगा। धन्यवाद।",
  askUnclear: () => "माफ कीजिए, समझ नहीं आया। क्या आप दोबारा बता सकते हैं कि आप कब तक और कितना भुगतान कर पाएंगे?",
  clarifyAmount: () => "जी, आप कितनी राशि दे पाएंगे?",
  clarifyDate: () => "जी, आप यह भुगतान कब तक कर पाएंगे?",
  angryDeescalate: () =>
    "माफ कीजिए अगर आपको तकलीफ हुई। हम आपको दोबारा परेशान नहीं करेंगे। " +
    "क्या आप चाहेंगे कि हमारा स्टाफ सदस्य आपसे सीधे बात करे?",
  confirmed: (name, date) => `धन्यवाद ${name} जी! हम ${date} को फॉलो-अप करेंगे।`,
  askRemainder: (remainingAmount) => `ठीक है, और बाकी ${remainingAmount} आप कब तक दे पाएंगे?`,
  confirmationPartial: (amount, date, remainingAmount, remainingDate) =>
    `अच्छा जी, आप ${amount} ${date} को देंगे, और बाकी ${remainingAmount} ${remainingDate} को — सही समझे?`,
};

/**
 * Matches the real Begusarai speech pattern a client sample provided (verb
 * forms like "छै"/"होलै"/"गेलै"/"बुझलहो", polite imperatives like
 * "करियो"/"देबियो"/"बतइयो", "अपने" for "aap") rather than the more generic
 * Bhojpuri-proper ("बा"/"बानी"/"करब") style used before — Begusarai's local
 * speech leans Magahi/Maithili-influenced, and this is closer to how it's
 * actually spoken there than a textbook Bhojpuri would be.
 */
const magahi: DialogueLines = {
  greeting: (name, businessName) => `नमस्ते! ${businessName} से बोलतिए। का अपने ${name} जी छियै?`,
  reasonAndAsk: (amount) =>
    `अपने के खाता में ${amount} बकाया छै, ई बहुत दिन से बाकी होलै। ` +
    `अपने कहिया तक ई पेमेंट पूरा करियो?`,
  confirmation: (amount, date) => `त ठीक छै, अपने ${amount} ${date} तक देबियो — बात बुझलहो?`,
  alreadyPaid: () => "ठीक छै। हम ई पेमेंट के जाँच करा लेतिए — हमरे स्टाफ अपने से जल्दी बात करतै। धन्यवाद।",
  wrongNumberIdentity: () => "ठीक छै, कष्ट खातिर माफी। हम रिकॉर्ड ठीक करा देतिए।",
  unclearIdentity: () => "कोई बात नइखे, हम बाद में फेर से फोन करतिए। धन्यवाद।",
  wrongNumberPaymentInfo: () => "ठीक छै, कष्ट खातिर माफी।",
  callbackRequested: () => "कोई बात नइखे, हम बाद में फोन करतिए। धन्यवाद।",
  refused: () => "ठीक छै। ई बात पर हमरे स्टाफ अपने से बात करतै। अपने के समय खातिर धन्यवाद।",
  cannotPay: () => "कोई बात नइखे। अपने कहिया तक पेमेंट कर सकियो, ई बतइयो?",
  uncertain: () => "माफ करियो, हमरा पूरा बात बुझा नइखे। हमरे स्टाफ अपने से जल्दी बात करतै। धन्यवाद।",
  askUnclear: () => "माफ करियो, बात बुझा नइखे। अपने फेर से बतइयो, कहिया तक आ केतना पेमेंट करियो?",
  clarifyAmount: () => "अपने केतना रुपैया देबियो, ई बतइयो?",
  clarifyDate: () => "अपने ई पेमेंट कहिया तक करियो?",
  angryDeescalate: () =>
    "अपने के तकलीफ भेलै त माफी। हम अपने के दोबारा परेशान नइखे करतिए। " +
    "का अपने चाहतिए कि हमरे स्टाफ अपने से सीधा बात करै?",
  confirmed: (name, date) => `धन्यवाद ${name} जी! हम ${date} के फॉलो-अप करतिए।`,
  askRemainder: (remainingAmount) => `ठीक छै, आ बाकी ${remainingAmount} अपने कहिया तक देबियो?`,
  confirmationPartial: (amount, date, remainingAmount, remainingDate) =>
    `त ठीक छै, अपने ${amount} ${date} तक देबियो, आ बाकी ${remainingAmount} ${remainingDate} तक — बात बुझलहो?`,
};

/**
 * Maithili (Mithila/Begusarai region) — Begusarai sits on the Magahi/Maithili
 * transition belt, so this is a second, distinct dialect option alongside
 * `magahi` above (which came from a validated real client call sample), not
 * a replacement for it. Same honesty caveat: a good-faith Maithili text set,
 * not a claim of full native-speaker coverage — see MAITHILI_MARKERS in
 * src/lib/nlu/language.ts and grow this via the Language Lab.
 */
const maithili: DialogueLines = {
  greeting: (name, businessName) => `प्रणाम! ${businessName} सँ बजैत छी। की अहाँ ${name} जी छी?`,
  reasonAndAsk: (amount) =>
    `अहाँक खाता मे ${amount} बाकी अछि, बहुत दिन सँ बाकी अछि। ` +
    `अहाँ कहिया धरि ई पेमेंट पूरा करब?`,
  confirmation: (amount, date) => `ठीक अछि, अहाँ कहि रहल छी जे ${amount} ${date} धरि देब — सही बुझलहुँ?`,
  alreadyPaid: () => "ठीक अछि। हम एहि पेमेंट के जाँच करा लेब — हमर स्टाफ अहाँ सँ जल्दी संपर्क करत। धन्यवाद।",
  wrongNumberIdentity: () => "ठीक अछि, कष्ट लेल क्षमा। हम रिकॉर्ड ठीक कऽ देब।",
  unclearIdentity: () => "कोनो बात नहि, हम बाद मे फेर फोन करब। धन्यवाद।",
  wrongNumberPaymentInfo: () => "ठीक अछि, कष्ट लेल क्षमा।",
  callbackRequested: () => "कोनो बात नहि, हम बाद मे फोन करब। धन्यवाद।",
  refused: () => "ठीक अछि। ई विषय पर हमर स्टाफ अहाँ सँ बात करत। अहाँक समय लेल धन्यवाद।",
  cannotPay: () => "कोनो बात नहि। अहाँ कहिया धरि पेमेंट कऽ सकब, ई बताउ?",
  uncertain: () => "क्षमा करू, हमरा पूरा बुझल नहि अछि। हमर स्टाफ अहाँ सँ जल्दी बात करत। धन्यवाद।",
  askUnclear: () => "क्षमा करू, बुझल नहि। अहाँ फेर सँ बताउ, कहिया धरि आ केतेक पेमेंट करब?",
  clarifyAmount: () => "अहाँ केतेक राशि दऽ सकब, ई बताउ?",
  clarifyDate: () => "अहाँ ई पेमेंट कहिया धरि करब?",
  angryDeescalate: () =>
    "अहाँक कष्ट भेल तँ क्षमा। हम अहाँ के दोबारा परेशान नहि करब। " +
    "की अहाँ चाहब जे हमर स्टाफ अहाँ सँ सीधा बात करथि?",
  confirmed: (name, date) => `धन्यवाद ${name} जी! हम ${date} के फॉलो-अप करब।`,
  askRemainder: (remainingAmount) => `ठीक अछि, आ बाकी ${remainingAmount} अहाँ कहिया धरि देब?`,
  confirmationPartial: (amount, date, remainingAmount, remainingDate) =>
    `ठीक अछि, अहाँ ${amount} ${date} धरि देब, आ बाकी ${remainingAmount} ${remainingDate} धरि — सही बुझलहुँ?`,
};

const english: DialogueLines = {
  greeting: (name, businessName) => `Hello! This is ${businessName} calling. Am I speaking with ${name}?`,
  reasonAndAsk: (amount) =>
    `I'm calling regarding the pending payment on your account. Your account shows ${amount} outstanding. ` +
    `By when will you be able to make the payment?`,
  confirmation: (amount, date) => `Okay, so you're saying you'll pay ${amount} by ${date} — is that correct?`,
  alreadyPaid: () => "Understood. We'll get this payment verified — our staff will contact you shortly. Thank you.",
  wrongNumberIdentity: () => "I see, apologies for the inconvenience. We'll update our records.",
  unclearIdentity: () => "No problem, we'll call again later. Thank you.",
  wrongNumberPaymentInfo: () => "I see, apologies for the inconvenience.",
  callbackRequested: () => "No problem, we'll call you later. Thank you.",
  refused: () => "Understood. We'll have our staff follow up with you on this. Thank you for your time.",
  cannotPay: () => "That's alright. By when do you expect to be able to make the payment?",
  uncertain: () => "Sorry, I didn't fully understand that. A staff member will call you shortly. Thank you.",
  askUnclear: () => "Sorry, I didn't understand. Could you tell me again by when and how much you'll be able to pay?",
  clarifyAmount: () => "How much amount will you be able to pay?",
  clarifyDate: () => "By when will you be able to make this payment?",
  angryDeescalate: () =>
    "I'm sorry for the inconvenience caused. We won't disturb you again. " +
    "Would you like a staff member to speak with you directly?",
  confirmed: (name, date) => `Thank you, ${name}! We'll follow up on ${date}.`,
  askRemainder: (remainingAmount) => `Okay, and when will you be able to pay the remaining ${remainingAmount}?`,
  confirmationPartial: (amount, date, remainingAmount, remainingDate) =>
    `Okay, so you'll pay ${amount} by ${date}, and the remaining ${remainingAmount} by ${remainingDate} — is that correct?`,
};

/**
 * Customer.preferredLanguage is a free-text field seeded from a fixed set of
 * UI options (see src/app/(app)/customers/page.tsx) but never DB-constrained,
 * so this normalizes loosely rather than exact-matching. Unknown/未-set
 * values fall back to "hinglish" — the pre-existing default behaviour, so
 * existing customers/tests are unaffected.
 */
export function getDialogue(preferredLanguage: string | null | undefined): DialogueLines {
  const key = (preferredLanguage || "").trim().toLowerCase();
  if (key === "hindi") return hindi;
  if (key === "maithili" || key.includes("maithili")) return maithili;
  if (key === "magahi" || key === "begusarai" || key.includes("bhojpuri") || key.includes("magahi")) return magahi;
  if (key === "english") return english;
  return hinglish;
}

/** Human-readable language name for LLM prompts — see callEngine/llmRephrase.ts. */
export function getLanguageLabel(preferredLanguage: string | null | undefined): string {
  const key = (preferredLanguage || "").trim().toLowerCase();
  if (key === "hindi") return "Hindi";
  if (key === "maithili" || key.includes("maithili")) return "Maithili (Mithila/Begusarai region, Devanagari script)";
  if (key === "magahi" || key === "begusarai" || key.includes("bhojpuri") || key.includes("magahi"))
    return "Magahi (Begusarai, Bihar dialect, Devanagari script)";
  if (key === "english") return "English";
  return "Hindi-English code-mixed (Hinglish, Roman script)";
}

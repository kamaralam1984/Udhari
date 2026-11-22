/**
 * Shared ULCA pipeline lookup for Bhashini (bhashini.gov.in). Bhashini's
 * inference auth is two-step: a ULCA user/key pair resolves a pipeline into
 * a per-task serviceId + a scoped inference key + callback URL, which is
 * then used for the actual ASR/TTS calls. That resolved handle is cached per
 * process (not per utterance) since it behaves like static configuration,
 * not a session token.
 *
 * NOTE: exact ULCA request/response field names below reflect Bhashini's
 * generally documented API shape at the time this was written — verify
 * against Bhashini's current published API docs before relying on this in
 * production, and adjust as needed.
 */

export type BhashiniTask = "asr" | "tts";

export interface BhashiniPipelineHandle {
  serviceId: string;
  callbackUrl: string;
  inferenceApiKey: string;
  sourceLanguage: string;
}

const ULCA_PIPELINE_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";

// Keyed by "task:language" — a resolved serviceId is specific to the language
// it was requested for, so a Hindi handle can't be reused to serve English
// (or any other) requests. See getBhashiniPipeline.
const pipelineCache = new Map<string, Promise<BhashiniPipelineHandle>>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

async function fetchPipeline(task: BhashiniTask, sourceLanguage: string): Promise<BhashiniPipelineHandle> {
  const userId = requireEnv("BHASHINI_USER_ID");
  const ulcaApiKey = requireEnv("BHASHINI_ULCA_API_KEY");
  const pipelineId = requireEnv("BHASHINI_PIPELINE_ID");

  const taskType = task === "asr" ? "asr" : "tts";
  const res = await fetch(ULCA_PIPELINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      userID: userId,
      ulcaApiKey,
    },
    body: JSON.stringify({
      pipelineTasks: [{ taskType, config: { language: { sourceLanguage } } }],
      pipelineRequestConfig: { pipelineId },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Bhashini getModelsPipeline failed (${res.status}) for task ${task}: ${detail}`);
  }

  const data = (await res.json()) as {
    pipelineInferenceAPIEndPoint?: {
      callbackUrl?: string;
      inferenceApiKey?: { value?: string };
    };
    pipelineResponseConfig?: { config?: { serviceId?: string }[] }[];
  };

  const callbackUrl = data.pipelineInferenceAPIEndPoint?.callbackUrl;
  const inferenceApiKey = data.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;
  const serviceId = data.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;

  if (!callbackUrl || !inferenceApiKey || !serviceId) {
    throw new Error(`Bhashini getModelsPipeline response missing expected fields for task ${task}.`);
  }

  return { serviceId, callbackUrl, inferenceApiKey, sourceLanguage };
}

/**
 * `language` should be a code Bhashini is confirmed to support (see the
 * README's Magahi/Bhojpuri/Maithili caveat) — defaults to
 * BHASHINI_LANGUAGE_CODE ("hi") when not given.
 */
/**
 * Maps a Customer.preferredLanguage value (see callEngine/dialogue.ts) to a
 * Bhashini ASR/TTS language code.
 *
 * "mag" is ISO 639-3 for Magahi. Magahi is NOT one of India's Eighth
 * Schedule languages, and this codebase has not confirmed Bhashini's model
 * catalog actually has a Magahi ASR/TTS pair for the pipeline configured by
 * BHASHINI_PIPELINE_ID — calling getBhashiniPipeline with an unsupported
 * code makes Bhashini's getModelsPipeline fail, breaking every Magahi
 * customer's real voice call. So "mag" is only returned when
 * BHASHINI_MAGAHI_SUPPORTED=true is explicitly set — set it only after
 * verifying (via Bhashini's getModelsPipeline / console) that a Magahi
 * model actually exists for your pipeline ID. Until then, Magahi customers
 * keep getting the Hindi voice model like before; the dialogue TEXT
 * (dialogue.ts) is already Magahi regardless of this flag.
 */
export function resolveBhashiniLanguageCode(preferredLanguage: string | null | undefined): string {
  const key = (preferredLanguage || "").trim().toLowerCase();
  if (key === "english") return "en";
  const isMagahi = key === "magahi" || key === "begusarai" || key.includes("bhojpuri") || key.includes("magahi");
  if (isMagahi && process.env.BHASHINI_MAGAHI_SUPPORTED === "true") return "mag";
  return process.env.BHASHINI_LANGUAGE_CODE || "hi";
}

export function getBhashiniPipeline(task: BhashiniTask, language?: string): Promise<BhashiniPipelineHandle> {
  const sourceLanguage = language || process.env.BHASHINI_LANGUAGE_CODE || "hi";
  const cacheKey = `${task}:${sourceLanguage}`;
  let cached = pipelineCache.get(cacheKey);
  if (!cached) {
    cached = fetchPipeline(task, sourceLanguage).catch((err) => {
      // Don't cache a failed lookup — the next call should retry.
      pipelineCache.delete(cacheKey);
      throw err;
    });
    pipelineCache.set(cacheKey, cached);
  }
  return cached;
}

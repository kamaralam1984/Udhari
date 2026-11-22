"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Upload, Mic, FileText, Volume2, Pause } from "lucide-react";
import clsx from "clsx";
import { api, ApiError, uploadWithProgress, formatDateClient, formatInrClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { UploadProgressBar, RoundProgress, AudioPlayButton, MicButton } from "@/components/ui/AudioProgress";
import { useMicLevelBars, useAudioLevelBars, EqualizerBars } from "@/components/ui/VoiceEqualizer";

interface ExtractResult {
  language: { label: string; confidence: number };
  amount: { amount: number | null };
  date: { date: string | null; ambiguous: boolean };
  intent: { intent: string };
  overallConfidence: number;
  aiInterpretation: string;
}

interface AiReply {
  text: string;
  audioUrl: string | null;
}

interface AudioUploadResponse {
  test: TestRow;
  result: ExtractResult;
  transcription: { text: string; confidence: number; language?: string };
  aiReply: AiReply;
}

interface TextTestResponse {
  test: TestRow;
  result: ExtractResult;
  aiReply: AiReply;
}

interface PdfUploadResponse {
  imported: number;
  totalLinesFound: number;
  tests: TestRow[];
}

interface TestRow {
  id: string;
  inputText: string;
  detectedLanguage: string | null;
  extractedAmount: string | null;
  extractedDate: string | null;
  extractedIntent: string | null;
  confidence: number | null;
  aiInterpretation: string | null;
  verdict: string;
  createdAt: string;
}

const SAMPLES = [
  "10 din baad pachaas हजार दे देंगे",
  "अगिला सोमर के पचास हजार देब",
  "अभी बीस हजार दे सकत हैं",
  "पइसा पहिले ही दे दिए हैं",
  "अभी पैसा नइखे, थोड़ा टाइम दीजिए",
  // Magahi (Begusarai)
  "हम त पइसा पहिलहीं दे देलियै",
  "अपने कहिया तक ई पेमेंट पूरा करियो",
  "अभी हमरा लगे पइसा नइखे, थोड़ा टाइम दीहीं",
  "बार-बार फोन जनि करियो, हम बता देतिए",
  "ई नंबर गलत छै, इहाँ केहू नइखे रहतै",
  // Maithili (Begusarai/Mithila)
  "हम पैसा पहिनहि दऽ देलहुँ अछि",
  "अहाँ कहिया धरि ई पेमेंट पूरा करब",
  "अखन हमरा लग पैसा नहि अछि, थोड़ेक समय दिअ",
  "बेर बेर फोन जनि करू, हम बता देब",
  // Partial payment — should now trigger the "baaki kab doge" follow-up question
  "पचास हजार में से सिर्फ दस हजार अभी दूंगा, बाकी बाद में दूंगा",
];

export default function LanguageLabPage() {
  const [input, setInput] = useState("");
  const [outstanding, setOutstanding] = useState("");
  const [preview, setPreview] = useState<ExtractResult | null>(null);
  const [aiReply, setAiReply] = useState<AiReply | null>(null);
  const [lastTestId, setLastTestId] = useState<string | null>(null);
  const [rows, setRows] = useState<TestRow[]>([]);
  const [running, setRunning] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcription, setTranscription] = useState<{ text: string; confidence: number } | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [understanding, setUnderstanding] = useState(false); // indeterminate round-progress while STT/NLU processes, after upload hits 100%
  const [audioError, setAudioError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [autoPlayReply, setAutoPlayReply] = useState(false);
  const [clientAudioNode, setClientAudioNode] = useState<HTMLAudioElement | null>(null);
  const [clientPlaying, setClientPlaying] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfUploadPercent, setPdfUploadPercent] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfResult, setPdfResult] = useState<{ imported: number; totalLinesFound: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Owner (Admin, live mic) and Client (AI Agent, TTS playback) — one
  // equalizer per side, each driven by real audio levels, not simulated.
  const ownerLevels = useMicLevelBars(micStream, 6);
  const clientLevels = useAudioLevelBars(clientAudioNode, clientPlaying, 6);

  // Owner spoke via mic → auto-play the Client (AI) reply the moment it's
  // ready, same-language, no manual click needed — the real round-trip
  // latency (network + STT + NLU + TTS) is whatever the configured
  // providers actually take; this doesn't artificially delay or rush it.
  useEffect(() => {
    if (autoPlayReply && aiReply?.audioUrl && clientAudioNode) {
      clientAudioNode.play().catch(() => {});
    }
  }, [autoPlayReply, aiReply, clientAudioNode]);

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await api.get<{ tests: TestRow[] }>("/api/language-tests");
      setRows(data.tests);
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : "Test history load nahi hui.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function runTest() {
    if (!input.trim()) return;
    setRunning(true);
    try {
      const data = await api.post<TextTestResponse>("/api/language-tests", {
        inputText: input,
        outstandingAmount: outstanding ? parseFloat(outstanding) : undefined,
      });
      setPreview(data.result);
      setAiReply(data.aiReply);
      setLastTestId(data.test.id);
      await loadHistory();
    } finally {
      setRunning(false);
    }
  }

  async function markVerdict(verdict: string) {
    if (!lastTestId) return;
    setVerdictError(null);
    try {
      await api.patch(`/api/language-tests/${lastTestId}`, { verdict });
      await loadHistory();
    } catch (e) {
      setVerdictError(e instanceof ApiError ? e.message : "Verdict save nahi hua.");
    }
  }

  async function uploadAudioBlob(blob: Blob, filename: string, viaMic: boolean) {
    setUploadingAudio(true);
    setUploadPercent(0);
    setUnderstanding(false);
    setAudioError(null);
    setTranscription(null);
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      if (outstanding) form.append("outstandingAmount", outstanding);
      const data = await uploadWithProgress<AudioUploadResponse>("/api/language-tests/audio", form, (pct) => {
        setUploadPercent(pct);
        // Upload hit 100% but the server is still transcribing/extracting —
        // that's real work with no granular progress to report, so the
        // round ring switches to its indeterminate "AI is understanding" spin.
        if (pct >= 100) setUnderstanding(true);
      });
      setPreview(data.result);
      setAiReply(data.aiReply);
      setLastTestId(data.test.id);
      setTranscription(data.transcription);
      setInput(data.transcription.text);
      setAutoPlayReply(viaMic); // auto-speak the reply only for a live mic turn, like a real conversation
      await loadHistory();
    } catch (e) {
      setAudioError(e instanceof ApiError ? e.message : "Audio process nahi ho paya.");
    } finally {
      setUploadingAudio(false);
      setUnderstanding(false);
    }
  }

  async function runAudioExtraction() {
    if (!audioFile) return;
    await uploadAudioBlob(audioFile, audioFile.name, false);
  }

  async function toggleRecording() {
    setMicError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream); // drives the Owner-side live equalizer
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMicStream(null);
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await uploadAudioBlob(blob, "recording.webm", true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setMicError("Microphone access nahi mila — browser permission check karein.");
    }
  }

  async function runPdfImport() {
    if (!pdfFile) return;
    setUploadingPdf(true);
    setPdfUploadPercent(0);
    setPdfError(null);
    setPdfResult(null);
    try {
      const form = new FormData();
      form.append("pdf", pdfFile);
      if (outstanding) form.append("outstandingAmount", outstanding);
      const data = await uploadWithProgress<PdfUploadResponse>("/api/language-tests/pdf", form, setPdfUploadPercent);
      setPdfResult({ imported: data.imported, totalLinesFound: data.totalLinesFound });
      await loadHistory();
    } catch (e) {
      setPdfError(e instanceof ApiError ? e.message : "PDF import nahi ho paya.");
    } finally {
      setUploadingPdf(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <FlaskConical size={20} className="text-[color:var(--gold-bright)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Language Testing Lab</h1>
          <p className="text-sm text-[var(--text-dim)]">
            Hindi/Hinglish/Magahi (Begusarai) samples test karein — yeh system kabhi bhi perfect dialect samajhne ka dawa nahi karta, isiliye yahan test-and-improve loop hai.
          </p>
        </div>
      </div>

      <Panel glow>
        <PanelBody>
          <PanelHeading title="Sample Test Karein" />
          <div className="flex flex-wrap gap-2 mb-3">
            {SAMPLES.map((s) => (
              <button key={s} className="chip hover:border-[color:var(--gold)]/50" onClick={() => setInput(s)}>
                {s}
              </button>
            ))}
          </div>
          <textarea
            className="field-input min-h-24"
            placeholder="Customer ka sentence yahan type/paste karein…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="flex gap-3 mt-3 flex-wrap items-center">
            <input
              className="field-input max-w-56"
              placeholder="Outstanding amount (optional)"
              type="number"
              value={outstanding}
              onChange={(e) => setOutstanding(e.target.value)}
            />
            <button className="btn-primary text-sm" disabled={running} onClick={runTest}>
              {running ? "Running…" : "Run Extraction"}
            </button>
          </div>

          <div className="mt-5 pt-5 border-t border-[var(--panel-border)]">
            <div className="flex items-center gap-2 mb-1">
              <Mic size={14} className="text-[color:var(--gold-bright)]" />
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Live Conversation — Owner ↔ AI Agent</span>
            </div>
            <p className="text-xs text-[var(--text-faint)] mb-4">
              Owner (Admin) dabakar bole — jis bhasha me bolenge, Client (AI Agent) usi bhasha me jawab dega jaise hi
              STT+NLU+TTS process complete hoti hai (real vendor latency — koi fixed/fake delay nahi).
            </p>

            <div className="flex items-center justify-center gap-8 sm:gap-14 py-2">
              <div className="flex flex-col items-center gap-2">
                <MicButton recording={recording} disabled={uploadingAudio} onToggle={toggleRecording} />
                <span className="text-xs font-semibold text-[color:var(--gold-bright)]">Owner (Admin)</span>
                <EqualizerBars levels={ownerLevels} color="var(--gold-bright)" />
              </div>

              <div className="text-[var(--text-faint)] text-xl select-none">↔</div>

              <div className="flex flex-col items-center gap-2">
                <span className="round-icon-wrap">
                  <button
                    type="button"
                    className={clsx("round-icon-btn", clientPlaying && "is-playing")}
                    disabled={!aiReply?.audioUrl}
                    onClick={() => {
                      if (!clientAudioNode) return;
                      if (clientPlaying) clientAudioNode.pause();
                      else clientAudioNode.play().catch(() => {});
                    }}
                    title={aiReply?.audioUrl ? "AI Agent ki awaaz sunein" : "Pehle Owner bolein"}
                    aria-label={clientPlaying ? "Pause AI reply" : "Play AI reply"}
                  >
                    {clientPlaying ? <Pause size={18} /> : <Volume2 size={18} />}
                  </button>
                </span>
                <span className="text-xs font-semibold text-[color:var(--green-bright)]">Client (AI Agent)</span>
                <EqualizerBars levels={clientLevels} color="var(--green-bright)" />
                <audio
                  ref={setClientAudioNode}
                  src={aiReply?.audioUrl ?? undefined}
                  onPlay={() => setClientPlaying(true)}
                  onPause={() => setClientPlaying(false)}
                  onEnded={() => setClientPlaying(false)}
                  className="hidden"
                />
              </div>
            </div>

            {(uploadingAudio || understanding) && (
              <div className="flex items-center justify-center gap-4 mt-2">
                <div className="w-40">
                  <UploadProgressBar percent={uploadPercent} label="Upload" />
                </div>
                <RoundProgress
                  value={transcription ? Math.round(transcription.confidence * 100) : 0}
                  indeterminate={understanding}
                  size={56}
                  label="AI samajh raha hai"
                />
              </div>
            )}

            <div className="flex gap-3 flex-wrap items-center justify-center mt-4 pt-4 border-t border-[var(--panel-border)]">
              <span className="text-xs text-[var(--text-faint)]">Ya recording file upload karein:</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="text-xs text-[var(--text-dim)]"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              />
              <button className="btn-secondary flex items-center gap-2 text-sm" disabled={!audioFile || uploadingAudio} onClick={runAudioExtraction}>
                <Upload size={14} /> {uploadingAudio ? "Processing…" : "Transcribe & Extract"}
              </button>
            </div>
            {micError && <div className="text-xs text-red-300 mt-2">{micError}</div>}
            {audioError && <div className="text-xs text-red-300 mt-2">{audioError}</div>}
            {transcription && (
              <div className="mt-3 flex items-start gap-3 text-xs border border-[var(--panel-border)] rounded-lg p-2.5 bg-white/[0.02]">
                <RoundProgress value={Math.round(transcription.confidence * 100)} size={44} />
                <div>
                  <span className="text-[var(--text-dim)]">STT Transcript — AI ne itna sunaai diya: </span>
                  <span>{transcription.text}</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-5 border-t border-[var(--panel-border)]">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={14} className="text-[color:var(--gold-bright)]" />
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Ya PDF Upload Karein (Bulk Import)</span>
            </div>
            <p className="text-xs text-[var(--text-faint)] mb-3">
              Ek PDF document jisme real customer sentences hon (ek line = ek sentence) — har line alag test ban jayegi,
              staff PASS/FAIL review ke liye Test History me aa jayegi.
            </p>
            <div className="flex gap-3 flex-wrap items-center">
              <input
                type="file"
                accept="application/pdf"
                className="text-xs text-[var(--text-dim)]"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
              <button className="btn-secondary flex items-center gap-2 text-sm" disabled={!pdfFile || uploadingPdf} onClick={runPdfImport}>
                <Upload size={14} /> {uploadingPdf ? "Importing…" : "Import from PDF"}
              </button>
              {uploadingPdf && (
                <div className="w-40">
                  <UploadProgressBar percent={pdfUploadPercent} label="Upload" />
                </div>
              )}
            </div>
            {pdfError && <div className="text-xs text-red-300 mt-2">{pdfError}</div>}
            {pdfResult && (
              <div className="mt-3 text-xs border border-[var(--green)]/30 bg-[color:var(--green)]/10 rounded-lg p-2.5">
                {pdfResult.imported} sentences import hui ({pdfResult.totalLinesFound} lines mile PDF me) — Test History me neeche dekhein.
              </div>
            )}
          </div>

          {preview && (
            <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
              <Info label="Detected Language" value={`${preview.language.label} (${Math.round(preview.language.confidence * 100)}%)`} />
              <Info label="Extracted Amount" value={preview.amount.amount !== null ? formatInrClient(preview.amount.amount) : "-"} />
              <Info label="Extracted Date" value={preview.date.date ? formatDateClient(preview.date.date) : "-"} extra={preview.date.ambiguous ? "ambiguous" : undefined} />
              <Info label="Intent" value={<Badge value={preview.intent.intent} />} />
              <Info label="Overall Confidence" value={`${Math.round(preview.overallConfidence * 100)}%`} />
              <div className="sm:col-span-2 border border-[var(--panel-border)] rounded-lg p-3 bg-white/[0.02]">
                <div className="text-xs text-[var(--text-dim)] mb-1">AI Interpretation</div>
                <div className="text-sm">{preview.aiInterpretation}</div>
              </div>
              {aiReply && (
                <div className="sm:col-span-2 border border-[color:var(--gold)]/30 bg-[color:var(--gold)]/5 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-[color:var(--gold-bright)] mb-1">
                    <Volume2 size={13} /> AI ka jawab (isi bhasha me)
                  </div>
                  <div className="text-sm mb-2">{aiReply.text}</div>
                  {/* autoPlay intentionally omitted here — the Owner ↔ AI Agent equalizer above already
                      auto-plays this same reply; this is just a manual replay control. */}
                  <AudioPlayButton audioUrl={aiReply.audioUrl} />
                  {!aiReply.audioUrl && (
                    <div className="text-[10px] text-[var(--text-faint)] mt-1">
                      Real awaaz sunne ke liye TTS_PROVIDER ko ek real vendor (Bhashini/OpenAI) par set karna hoga — abhi text-only hai.
                    </div>
                  )}
                </div>
              )}
              <div className="sm:col-span-2 flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => markVerdict("PASS")}>
                  Mark PASS
                </button>
                <button className="btn-danger text-xs" onClick={() => markVerdict("FAIL")}>
                  Mark FAIL
                </button>
                <button className="btn-secondary text-xs" onClick={() => markVerdict("NEEDS_REVIEW")}>
                  Needs Review
                </button>
              </div>
              {verdictError && <div className="sm:col-span-2 text-xs text-red-300">{verdictError}</div>}
            </div>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading title="Test History" subtitle="Yahan se lexicon/rules ko real samples se sudhaara jaata hai." />
          {historyError && <ErrorBanner message={historyError} onRetry={loadHistory} />}
          <div className="table-wrap mt-3">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Language</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Intent</th>
                  <th>Confidence</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading && rows.length === 0 && <SkeletonRows rows={5} cols={7} />}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-xs truncate" title={r.inputText}>
                      {r.inputText}
                    </td>
                    <td className="text-[var(--text-dim)]">{r.detectedLanguage || "-"}</td>
                    <td>{r.extractedAmount ? formatInrClient(r.extractedAmount) : "-"}</td>
                    <td>{r.extractedDate ? formatDateClient(r.extractedDate) : "-"}</td>
                    <td>{r.extractedIntent ? <Badge value={r.extractedIntent} /> : "-"}</td>
                    <td>{r.confidence !== null ? `${Math.round((r.confidence ?? 0) * 100)}%` : "-"}</td>
                    <td>
                      <Badge value={r.verdict} />
                    </td>
                  </tr>
                ))}
                {!historyLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-[var(--text-faint)] py-8">
                      Abhi tak koi test nahi hua.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Info({ label, value, extra }: { label: string; value: React.ReactNode; extra?: string }) {
  return (
    <div className="border border-[var(--panel-border)] rounded-lg p-3 bg-white/[0.02]">
      <div className="text-xs text-[var(--text-dim)]">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
      {extra && <div className="text-[10px] text-[color:var(--gold-bright)] mt-0.5">{extra}</div>}
    </div>
  );
}

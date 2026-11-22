"use client";

import { useEffect, useRef, useState, use as usePromise, type FormEvent } from "react";
import { Send, Bot, User, Terminal, Volume2, Pause } from "lucide-react";
import clsx from "clsx";
import { api, ApiError, formatInrClient, formatDateClient, formatDateTimeClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { MicButton } from "@/components/ui/AudioProgress";
import { useMicLevelBars, useAudioLevelBars, EqualizerBars } from "@/components/ui/VoiceEqualizer";

interface Transcript {
  id: string;
  sequence: number;
  speaker: "AI" | "CUSTOMER" | "SYSTEM";
  text: string;
  timestamp: string;
}

interface CallDetail {
  id: string;
  status: string;
  mode: string;
  language: string | null;
  createdAt: string;
  duration: number | null;
  summary: string | null;
  customerResponse: string | null;
  promisedAmount: string | null;
  promisedDate: string | null;
  paymentIntent: string | null;
  confidence: number | null;
  nextFollowUpDate: string | null;
  verificationRequired: boolean;
  customer: { id: string; name: string; phoneNumber: string; outstandingAmount: string };
  transcripts: Transcript[];
  callSummary: { summaryText: string; ownerNotificationText: string } | null;
  promise: {
    id: string;
    promisedAmount: string;
    promisedDate: string;
    remainingAmount: string | null;
    remainingDueDate: string | null;
    status: string;
  } | null;
  usageLogs: { id: string; provider: string; providerName: string; estimatedCost: string }[];
  staffTasks: { id: string; type: string; status: string; title: string; description: string }[];
}

const TERMINAL = ["COMPLETED", "AI_UNCERTAIN", "CALLBACK_REQUESTED", "WRONG_NUMBER", "FAILED", "NO_ANSWER", "BUSY"];

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [replyAudioUrl, setReplyAudioUrl] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [aiAudioNode, setAiAudioNode] = useState<HTMLAudioElement | null>(null);
  const [aiPlaying, setAiPlaying] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const greetingFetchedRef = useRef(false);

  const customerLevels = useMicLevelBars(micStream, 6);
  const aiLevels = useAudioLevelBars(aiAudioNode, aiPlaying, 6);

  async function load() {
    const data = await api.get<{ call: CallDetail }>(`/api/calls/${id}`);
    setCall(data.call);
    return data.call;
  }

  function loadInitial() {
    setLoading(true);
    load()
      .then(async (c) => {
        setLoadError(null);
        // Fresh call, nobody's spoken yet — fetch+auto-play the AI's
        // greeting so the "call" opens with the AI actually talking first,
        // same as a real phone call would.
        if (!greetingFetchedRef.current && c.transcripts.length === 1 && c.transcripts[0].speaker === "AI") {
          greetingFetchedRef.current = true;
          try {
            const g = await api.get<{ audioUrl: string | null }>(`/api/calls/${id}/greeting-audio`);
            setReplyAudioUrl(g.audioUrl);
          } catch {
            // best-effort — greeting text is already visible in the transcript either way
          }
        }
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Call detail load nahi hua."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [call?.transcripts.length]);

  useEffect(() => {
    if (replyAudioUrl && aiAudioNode) {
      aiAudioNode.play().catch(() => {});
    }
  }, [replyAudioUrl, aiAudioNode]);

  const isLive = call ? !TERMINAL.includes(call.status) : false;

  async function sendTurn(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/calls/${id}/turn`, { text });
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Turn process nahi ho payi.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Push-to-talk: click to start recording, click again (or it never
   * overlaps the AI's own line, since the AI only replies after this
   * upload resolves) to stop and send. The engine only ever advances once
   * your full turn is transcribed — there's no risk of it talking over you,
   * same invariant a real call has via the turn-based engine.
   */
  async function toggleVoiceTurn() {
    setError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMicStream(null);
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setVoiceBusy(true);
        setReplyAudioUrl(null);
        try {
          const form = new FormData();
          form.append("audio", blob, "turn.webm");
          const res = await fetch(`/api/calls/${id}/turn/audio`, { method: "POST", body: form, credentials: "include" });
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new ApiError(body?.error || `Voice turn failed (${res.status})`, res.status);
          setReplyAudioUrl(body.replyAudioUrl ?? null);
          await load();
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Voice turn process nahi ho payi.");
        } finally {
          setVoiceBusy(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access nahi mila — browser permission check karein.");
    }
  }

  if (loading && !call) {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <Panel>
              <PanelBody className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </PanelBody>
            </Panel>
          </div>
          <div>
            <Panel>
              <PanelBody className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </PanelBody>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  if (loadError && !call) {
    return <ErrorBanner message={loadError} onRetry={loadInitial} />;
  }

  if (!call) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Call with {call.customer.name}</h1>
          <p className="text-sm text-[var(--text-dim)]">{call.customer.phoneNumber} · {formatDateTimeClient(call.createdAt)}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge value={call.mode} />
          <Badge value={call.status} />
          {isLive && (
            <span className="chip border-[color:var(--green)]/50 text-[color:var(--green-bright)] bg-[color:var(--green)]/10">
              <span className="live-dot" /> live
            </span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Panel glow={isLive}>
            <PanelBody>
              <PanelHeading
                title="Conversation"
                subtitle={isLive ? "Customer ne jo kaha wo type karein — jaise real STT transcript aata" : "Transcript"}
              />
              <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
                {call.transcripts.map((t) => (
                  <div key={t.id} className={`flex gap-2 ${t.speaker === "CUSTOMER" ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        t.speaker === "AI"
                          ? "bg-[color:var(--gold)]/15 text-[color:var(--gold-bright)]"
                          : t.speaker === "CUSTOMER"
                            ? "bg-[color:var(--green)]/15 text-[color:var(--green-bright)]"
                            : "bg-white/5 text-[var(--text-faint)]"
                      }`}
                    >
                      {t.speaker === "AI" ? <Bot size={14} /> : t.speaker === "CUSTOMER" ? <User size={14} /> : <Terminal size={12} />}
                    </div>
                    <div
                      className={`rounded-xl px-3 py-2 text-sm max-w-[80%] ${
                        t.speaker === "CUSTOMER" ? "bg-[color:var(--green)]/10 border border-[color:var(--green)]/20" : "bg-white/[0.04] border border-[var(--panel-border)]"
                      }`}
                    >
                      {t.text}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {isLive ? (
                <>
                  <div className="mt-4 pt-4 border-t border-[var(--panel-border)] flex items-center justify-center gap-8 sm:gap-14">
                    <div className="flex flex-col items-center gap-2">
                      <span className="round-icon-wrap">
                        <button
                          type="button"
                          className={clsx("round-icon-btn", aiPlaying && "is-playing")}
                          disabled={!replyAudioUrl}
                          onClick={() => {
                            if (!aiAudioNode) return;
                            if (aiPlaying) aiAudioNode.pause();
                            else aiAudioNode.play().catch(() => {});
                          }}
                          title="AI Agent ki awaaz"
                          aria-label={aiPlaying ? "Pause AI voice" : "Play AI voice"}
                        >
                          {aiPlaying ? <Pause size={18} /> : <Volume2 size={18} />}
                        </button>
                      </span>
                      <span className="text-xs font-semibold text-[color:var(--gold-bright)]">AI Agent</span>
                      <EqualizerBars levels={aiLevels} color="var(--gold-bright)" />
                      <audio
                        ref={setAiAudioNode}
                        src={replyAudioUrl ?? undefined}
                        onPlay={() => setAiPlaying(true)}
                        onPause={() => setAiPlaying(false)}
                        onEnded={() => setAiPlaying(false)}
                        className="hidden"
                      />
                    </div>

                    <div className="text-[var(--text-faint)] text-xl select-none">↔</div>

                    <div className="flex flex-col items-center gap-2">
                      <MicButton recording={recording} disabled={voiceBusy} onToggle={toggleVoiceTurn} />
                      <span className="text-xs font-semibold text-[color:var(--green-bright)]">Client ({call.customer.name})</span>
                      <EqualizerBars levels={customerLevels} color="var(--green-bright)" />
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-faint)] text-center mt-3">
                    Client (mic) dabakar boliye — AI Agent turant usi bhasha me jawab bolega. Turn-based hai, koi
                    overlap nahi hota.
                  </p>

                  <form onSubmit={sendTurn} className="mt-4 flex items-center gap-2">
                    <input
                      className="field-input"
                      placeholder="Ya yahan type karke bhejein… (e.g. agla Monday ko pachaas hazaar de denge)"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      disabled={sending}
                    />
                    <button className="btn-secondary flex items-center gap-2 shrink-0 text-sm" disabled={sending}>
                      <Send size={14} /> {sending ? "…" : "Send"}
                    </button>
                  </form>
                </>
              ) : (
                <div className="mt-4 text-xs text-[var(--text-faint)]">Call complete ho chuki hai.</div>
              )}
              {error && <div className="text-xs text-red-300 mt-2">{error}</div>}
            </PanelBody>
          </Panel>

          {call.callSummary && (
            <Panel>
              <PanelBody>
                <PanelHeading title="AI Summary" />
                <p className="text-sm text-[var(--text-dim)] mb-4">{call.callSummary.summaryText}</p>
                <PanelHeading title="Owner Notification Preview" />
                <pre className="whitespace-pre-wrap text-xs bg-black/30 border border-[var(--panel-border)] rounded-lg p-3 font-sans text-[var(--text-dim)]">
                  {call.callSummary.ownerNotificationText}
                </pre>
              </PanelBody>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelBody className="space-y-3">
              <PanelHeading title="Extraction" />
              <Row label="Outstanding" value={formatInrClient(call.customer.outstandingAmount)} />
              <Row label="Payment Intent" value={call.paymentIntent ? <Badge value={call.paymentIntent} /> : "-"} />
              <Row label="Promised Amount" value={call.promisedAmount ? formatInrClient(call.promisedAmount) : "-"} />
              <Row label="Promised Date" value={formatDateClient(call.promisedDate)} />
              {call.promise?.remainingAmount && (
                <Row
                  label="Remaining Balance"
                  value={
                    <span className="text-[color:var(--yellow-bright)]">
                      {formatInrClient(call.promise.remainingAmount)}
                      {call.promise.remainingDueDate ? ` by ${formatDateClient(call.promise.remainingDueDate)}` : ""}
                    </span>
                  }
                />
              )}
              <Row label="Next Follow-up" value={formatDateClient(call.nextFollowUpDate)} />
              <Row
                label="Confidence"
                value={
                  call.confidence !== null ? (
                    <div className="w-full">
                      <div className="machine-progress w-24 mb-1" />
                      <span className="text-xs">{Math.round(call.confidence * 100)}%</span>
                    </div>
                  ) : (
                    "-"
                  )
                }
              />
              {call.verificationRequired && (
                <div className="text-xs text-[color:var(--yellow-bright)] bg-[color:var(--yellow)]/10 border border-[color:var(--yellow)]/30 rounded-lg p-2">
                  ⚠ Payment verification required — staff task ban gaya hai. AI kabhi payment ko received mark nahi karta.
                </div>
              )}
            </PanelBody>
          </Panel>

          {call.staffTasks.length > 0 && (
            <Panel warn={call.staffTasks.some((t) => t.status !== "RESOLVED")}>
              <PanelBody>
                <PanelHeading title="Staff Tasks" />
                <div className="space-y-2">
                  {call.staffTasks.map((t) => (
                    <div key={t.id} className="text-sm border-b border-[var(--panel-border)] pb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{t.title}</span>
                        <Badge value={t.status} />
                      </div>
                      <p className="text-xs text-[var(--text-faint)] mt-1">{t.description}</p>
                    </div>
                  ))}
                </div>
              </PanelBody>
            </Panel>
          )}

          {call.usageLogs.length > 0 && (
            <Panel>
              <PanelBody>
                <PanelHeading title="Usage / Cost" />
                <div className="space-y-1 text-sm">
                  {call.usageLogs.map((u) => (
                    <div key={u.id} className="flex items-center justify-between">
                      <span className="text-[var(--text-dim)]">
                        {u.provider} <span className="text-[var(--text-faint)]">({u.providerName})</span>
                      </span>
                      <span>{formatInrClient(u.estimatedCost)}</span>
                    </div>
                  ))}
                </div>
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-dim)]">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

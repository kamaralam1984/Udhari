"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { api, ApiError } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";

interface QuickCallResponse {
  call: { id: string };
}

export default function NewCallPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("hinglish");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function placeCall() {
    if (!phoneNumber.trim()) return;
    setCalling(true);
    setError(null);
    try {
      const data = await api.post<QuickCallResponse>("/api/calls/quick", {
        phoneNumber: phoneNumber.trim(),
        name: name.trim() || undefined,
        preferredLanguage,
        mode: "TEST",
      });
      router.push(`/calls/${data.call.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Call place nahi ho payi.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <PhoneCall size={20} className="text-[color:var(--gold-bright)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Make a Call</h1>
          <p className="text-sm text-[var(--text-dim)]">Mobile number daalein — AI Agent us customer se baat karega.</p>
        </div>
      </div>

      <div className="text-xs text-[color:var(--yellow-bright)] bg-[color:var(--yellow)]/10 border border-[color:var(--yellow)]/30 rounded-lg p-3">
        Yeh TEST mode call hai — koi asli phone ring nahi hota, STT/NLU/TTS real hain (jo bhi provider configure hai) lekin
        telephony simulate hoti hai. Asli phone call ke liye ek real telephony vendor (Twilio/Exotel) account chahiye,
        aur PRODUCTION mode activate karna hoga.
      </div>

      <Panel glow>
        <PanelBody>
          <PanelHeading title="Naya Call" subtitle="Number naya ho toh customer record apne aap ban jayega." />
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              className="field-input"
              placeholder="Mobile number (e.g. +919876543210)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
            <input className="field-input" placeholder="Naam (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <Select className="sm:col-span-2" value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)}>
              <option value="hinglish">Hinglish</option>
              <option value="hindi">Hindi</option>
              <option value="magahi">Magahi (Begusarai)</option>
              <option value="maithili">Maithili (Begusarai)</option>
              <option value="english">English</option>
              <option value="other">Other</option>
            </Select>
          </div>
          {error && <div className="text-xs text-red-300 mt-3">{error}</div>}
          <button className="btn-primary flex items-center gap-2 text-sm mt-4" disabled={!phoneNumber.trim() || calling} onClick={placeCall}>
            <PhoneCall size={16} /> {calling ? "Calling…" : "Call"}
          </button>
        </PanelBody>
      </Panel>
    </div>
  );
}

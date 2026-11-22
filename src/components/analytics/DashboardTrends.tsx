"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { BarChart, LineAreaChart, NEON } from "./charts";

interface Mini {
  volume: { labels: string[]; connected: number[]; missed: number[] };
  trends: { efficiency: { labels: string[]; collected: number[] } };
  viewer: { scope: "all" | "self" };
}

/** Compact 7-day trend strip for the main dashboard; the full thing lives on /analytics. */
export function DashboardTrends() {
  const [d, setD] = useState<Mini | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<Mini>("/api/analytics?range=7d")
      .then((r) => alive && setD(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!d) return null;
  const money = d.viewer.scope === "all";
  return (
    <Panel>
      <PanelBody>
        <PanelHeading
          title="Pichhle 7 din ka trend"
          subtitle="Calls connect hui ya miss — aur weekly cash collection."
          right={
            <Link href="/analytics" className="inline-flex items-center gap-1 text-xs text-[var(--gold-bright)] hover:underline">
              Poora Analytics <ArrowRight size={12} />
            </Link>
          }
        />
        <div className={`grid gap-6 ${money ? "lg:grid-cols-2" : ""}`}>
          <LineAreaChart
            labels={d.volume.labels}
            series={[
              { name: "Connected", color: NEON.violet, values: d.volume.connected },
              { name: "Missed / failed", color: NEON.cyan, values: d.volume.missed },
            ]}
          />
          {money && (
            <div>
              <div className="mb-1 text-[11px] text-[var(--text-dim)]">Weekly collection (₹)</div>
              <BarChart
                labels={d.trends.efficiency.labels}
                series={[{ name: "Collected", color: NEON.green, values: d.trends.efficiency.collected }]}
                yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
                height={130}
              />
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

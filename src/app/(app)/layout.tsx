import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/antiSpam";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const settings = await getAppSettings();

  return (
    <AppShell
      user={{ id: session.sub, name: session.name, email: session.email, role: session.role }}
      businessName={settings.businessName}
    >
      {children}
    </AppShell>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getAppSettings } from "@/lib/antiSpam";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Per-deployment branding — each client sets AppSettings.businessName via Settings. */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  return {
    title: `${settings.businessName} — AI Calling Console`,
    description: `AI voice calling & credit/collection automation for ${settings.businessName}`,
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before first paint (see ThemeSwitcher) so there is no flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

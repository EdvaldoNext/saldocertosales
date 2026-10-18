import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SaldoCerto",
  description: "SaldoCerto — controle seus gastos com clareza, no celular ou no computador.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32 48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/logo.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "SaldoCerto",
    statusBarStyle: "black-translucent",
  },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#07110c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Define window.APP_VERSION antes do app subir (usado para recarregar quando sai versao nova). */}
        <script src="/version.js" />
      </head>
      {/* suppressHydrationWarning: extensoes do navegador (ex.: ColorZilla) injetam atributos no <body>. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionBootstrap } from "../components/Session";
import { ThemeProvider } from "../contexts/ThemeContext";
import { AuthProvider } from "../contexts/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chat",
  description: "Simple streaming chat UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>
            <SessionBootstrap />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "Anonymous Voting | Soroban",
  description: "Secure, decentralized anonymous voting on the Stellar network using Soroban smart contracts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.variable} font-sans antialiased bg-slate-950 text-white min-h-screen overflow-x-hidden`}>
        {children}
      </body>
    </html>
  );
}

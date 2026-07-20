import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ATFE Sizing Calculator — EcoProcess",
  description: "Agitated Thin Film Evaporator sizing tool for preliminary and detailed engineering estimates.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <header className="bg-[#1B5E20] text-white shadow-md">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
            <div className="font-bold text-lg tracking-tight">EcoProcess</div>
            <div className="h-5 w-px bg-green-700" />
            <div className="text-sm text-green-200">ATFE Sizing Calculator</div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
        <footer className="text-center text-xs text-gray-400 py-6 border-t border-gray-200 mt-8">
          EcoProcess Engineering Pvt. Ltd. — Internal Tool — Not for external distribution
        </footer>
      </body>
    </html>
  );
}

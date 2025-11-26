/**
 * Root layout:
 * - Loads Tailwind globals
 * - Wraps the app in Providers (SessionProvider)
 * - Adds Navbar on all pages
 */

import "./globals.css";
import Navbar from "../components/Navbar";
import Providers from "./providers";
import Footer from "../components/Footer";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>
          <Navbar />
          <main className="max-w-6xl mx-auto p-6">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

/**
 * Main top navigation.
 * Clean, app-like header with active DATA tab styling.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { PROJECT_NAME } from "../lib/systemInfo";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const tabClass = (href: string) =>
    `text-sm px-2 py-1 rounded-md ${pathname.startsWith(href)
      ? "bg-black text-white"
      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
    }`;

  const canAdmin = session?.role === "owner" || session?.role === "admin";
  const canAccessEval = canAdmin || session?.canAccessEval;

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex gap-3 items-center">
          <Link href="/" className="font-semibold text-lg tracking-tight">
            {PROJECT_NAME} <small>&alpha;</small>
          </Link>
          <nav className="flex gap-1 ml-2">
            <Link href="/datasets" className={tabClass("/datasets")}>DATA</Link>
            {canAccessEval && (
              <Link href="/eval" className={tabClass("/eval")}>
                EVAL
              </Link>
            )}
          </nav>
        </div>

        <div className="text-sm flex items-center gap-3">
          {session ? (
            <>
              {canAdmin ? (
                <div className="relative">
                  <details className="group">
                    <summary className="text-sm flex items-center gap-1 text-gray-600 hover:text-gray-900 cursor-pointer rounded-md px-2 py-1">
                      Account
                      <span className="text-xs text-gray-400 group-open:rotate-180 transition-transform duration-150">▾</span>
                    </summary>
                    <div className="absolute right-0 mt-2 w-40 rounded-md border bg-white shadow-lg ring-1 ring-black ring-opacity-5">
                      <Link
                        href="/account/password"
                        className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        Account settings
                      </Link>
                      <Link
                        href="/admin"
                        className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        Admin
                      </Link>
                    </div>
                  </details>
                </div>
              ) : (
                <Link
                  href="/account/password"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Account
                </Link>
              )}
              <span className="text-gray-600">{session.user?.email}</span>
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-md bg-black text-white hover:bg-gray-800"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

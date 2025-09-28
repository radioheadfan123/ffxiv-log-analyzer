import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="font-sans grid grid-rows-[1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <main className="flex flex-col gap-10 row-start-1 items-center sm:items-center">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={180}
          height={38}
          priority
        />
        <div className="flex flex-col gap-6 items-center">
          <h1 className="text-2xl font-bold text-center mb-4">FFXIV Log Analyzer</h1>
          <div className="flex flex-col sm:flex-row gap-6">
            <Link
              href="/upload"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg px-8 py-4 shadow transition-colors text-center"
            >
              Upload Log
            </Link>
            <Link
              href="/my-logs"
              className="rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold text-lg px-8 py-4 shadow transition-colors text-center"
            >
              My Logs
            </Link>
          </div>
        </div>
      </main>
      <footer className="row-start-2 flex gap-4 flex-wrap items-center justify-center text-xs text-zinc-500">
        <span>
          © {new Date().getFullYear()} FFXIV Log Analyzer
        </span>
        <a
          className="hover:underline"
          href="https://github.com/radioheadfan123/ffxiv-log-analyzer"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
import { DATA_MODIFIED, PROJECT_NAME, PROJECT_VERSION } from "../lib/systemInfo";

export default function Footer() {
  return (
    <footer className="border-t mt-8">
      <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-gray-500 flex flex-col md:flex-row md:items-center md:justify-between gap-1">
        <div>
          {PROJECT_NAME} · v{PROJECT_VERSION}
        </div>
        <div>Build date: {DATA_MODIFIED}</div>
      </div>
    </footer>
  );
}

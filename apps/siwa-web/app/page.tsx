import Link from "next/link";
import { DATA_MODIFIED, PROJECT_NAME, PROJECT_VERSION } from "../lib/systemInfo";

const purposeHighlights = [
  `${PROJECT_NAME} keeps everything local so you can explore and evaluate data without sharing it externally.`,
  "Every dataset, model, and evaluation lives with contextual notes, making decisions easy to explain.",
  "Tune experiments in one place—data, models, and results stay together so the next steps are obvious.",
];

const quickLinks = [
  {
    label: "Datasets",
    description: "Connect folders, preview files, and launch annotations.",
    href: "/datasets",
  },
  {
    label: "Evaluations",
    description: "Compare model outputs, review notes, and track metrics.",
    href: "/eval",
  },
  // {
  //   label: "Accounts",
  //   description: "Manage access, tokens, and workspace settings.",
  //   href: "/account",
  // },
];

export default function Home() {
  return (
    <div className="space-y-10 mt-6">
      <section className="grid gap-8 lg:grid-cols-[1.4fr,0.6fr]">
        <div className="space-y-6">
          <p className="text-sm uppercase tracking-[0.3em] text-gray-500">Local-first platform</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-gray-900">
            {PROJECT_NAME} is the private workspace where you curate data, run evaluations, and explain every model decision.
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            Pull in your files, launch evaluations, and take notes alongside the models that you trust. {PROJECT_NAME} keeps the tooling simple
            and the context close so you always know why a result changed.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/datasets/new"
              className="bg-black text-white px-5 py-3 rounded-xl text-sm font-semibold transition hover:bg-gray-800"
            >
              Start a dataset
            </Link>
            <Link
              href="/eval"
              className="px-5 py-3 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50 transition"
            >
              View evaluations
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            {purposeHighlights.map((item) => (
              <div key={item} className="bg-white border rounded-2xl p-4 shadow-sm">
                <p className="text-sm text-gray-600">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
          <div>
            <p className="text-sm text-gray-500">Project build</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">
              {PROJECT_NAME} α v{PROJECT_VERSION}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Last data sync</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">{DATA_MODIFIED}</p>
          </div>
          <p className="text-sm text-gray-600">
            Everything you do is tied to metadata so you can always retrace the steps that led to a result.
          </p>
        </div>
      </section>

      {/* <section>
        <h2 className="text-2xl font-semibold text-gray-900">Quick navigation</h2>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Jump directly to the workflow you need—datasets, evaluations, or account settings.
        </p>
        <div className="mt-5 grid md:grid-cols-3 gap-5">
          {quickLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="block bg-white border rounded-2xl p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Section</p>
              <h3 className="text-xl font-semibold text-gray-900 mt-2">{link.label}</h3>
              <p className="text-sm text-gray-600 mt-1">{link.description}</p>
            </Link>
          ))}
        </div>
      </section> */}
    </div>
  );
}

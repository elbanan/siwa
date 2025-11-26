/**
 * Explore view for text datasets (separate from image workflows).
 */
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import api from "../../../../lib/api";

type TextRow = {
  id: string;
  text: string;
  label: string;
  original_label: string;
  status: string;
  extra_columns?: Record<string, any>;
  original_row?: Record<string, any>;
  [key: string]: any;
};

type TextData = {
  dataset_id: string;
  total: number;
  offset: number;
  limit: number;
  rows: TextRow[];
};

export default function TextExplorePage() {
  const { status } = useSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [dataset, setDataset] = useState<any | null>(null);
  const [textData, setTextData] = useState<TextData | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const limit = 100;
  const totalPages = textData ? Math.max(1, Math.ceil(textData.total / limit)) : 1;
  const currentPage = Math.floor(offset / limit) + 1;
  const extraColumns =
    (dataset?.ds_metadata?.extra_text_columns as string[] | undefined) ?? [];
  const idColumn =
    (dataset?.data_source?.config?.id_column as string | undefined)?.trim() || "";
  const datasetTask = dataset?.task_type;
  const isSummarization = datasetTask === "text_summarization";
  const annotationColumnTitle = isSummarization ? "Reference summary" : "Label";
  const searchPlaceholder = isSummarization
    ? "Search text or summary…"
    : "Search text or label…";

  const valueForColumn = (row: TextRow, column: string) =>
    row[column] ??
    row?.extra_columns?.[column] ??
    row?.original_row?.[column] ??
    "—";

  const displayId = (row: TextRow) => {
    if (idColumn) {
      const val = valueForColumn(row, idColumn);
      if (val !== "—") return String(val);
    }
    return row.id;
  };

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    api
      .get(`/datasets/${datasetId}`)
      .then((res) => {
        const ds = res.data;
        if ((ds.modality ?? "").toLowerCase() !== "text") {
          router.replace(`/datasets/${datasetId}/explore/`);
          return;
        }
        setDataset(ds);
      })
      .catch((e) =>
        setError(e?.response?.data?.detail ?? "Failed to load dataset.")
      );
  }, [status, datasetId, router]);

  useEffect(() => {
    if (status !== "authenticated" || !dataset || !datasetId) return;
    setError("");
    api
      .get(`/datasets/${datasetId}/text-rows`, {
        params: {
          offset,
          limit,
          search: search.trim() || undefined,
        },
      })
      .then((res) => setTextData(res.data))
      .catch((e) =>
        setError(e?.response?.data?.detail ?? "Failed to load text rows")
      );
  }, [status, datasetId, dataset, offset, search]);

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <Link href="/login" className="underline text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  const canAnnotate = dataset?.access_level === "editor";

  if (!textData || !dataset) {
    return <p className="text-sm text-gray-600">Loading text rows…</p>;
  }

  const renderTruncatedValue = (value: string | undefined | null) => {
    const display = (value ?? "").trim();
    if (!display) {
      return <span className="text-gray-400">—</span>;
    }
    return (
      <div className="relative group">
        <span className="line-clamp-3 whitespace-pre-wrap">{display}</span>
        <div className="absolute left-0 bottom-full mb-2 hidden w-80 max-h-80 overflow-auto rounded-2xl border bg-white p-4 text-sm text-gray-800 shadow-lg group-hover:block z-10">
          {display}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          <p className="text-sm text-gray-600 mt-1">
            Showing{" "}
            <span className="font-medium text-gray-900">{textData.total}</span>{" "}
            rows
          </p>
        </div>
        <div className="flex gap-2">
          {canAnnotate && (
            <Link
              href={`/text-datasets/${datasetId}/annotate/text-classification`}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            >
              Annotate
            </Link>
          )}
          <Link
            href={`/text-datasets/${datasetId}/annotations/text-classification/summary`}
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
          >
            Summary
          </Link>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-3 flex items-center gap-3">
        <input
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <div className="text-xs text-gray-500">
          CSV: <span className="font-mono">{dataset?.data_source?.config?.path}</span>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left w-32">Record ID</th>
              <th className="px-3 py-2 text-left">Text</th>
              {isSummarization && (
                <th className="px-3 py-2 text-left w-72">Reference summary</th>
              )}
              {extraColumns.map((col) => (
                <th key={col} className="px-3 py-2 text-left w-40">
                  {col}
                </th>
              ))}
              {!isSummarization && (
                <th className="px-3 py-2 text-left w-40">{annotationColumnTitle}</th>
              )}
              <th className="px-3 py-2 text-left w-28">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {textData.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">
                  {displayId(row)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-800">
                  {renderTruncatedValue(row.text)}
                </td>
                {isSummarization && (
                  <td className="px-3 py-2 text-sm text-gray-800">
                    {renderTruncatedValue(row.original_label)}
                  </td>
                )}
                {extraColumns.map((col) => {
                  const val = valueForColumn(row, col);
                  return (
                    <td key={`${row.id}-${col}`} className="px-3 py-2 text-sm">
                      {val === "—" ? <span className="text-gray-400">—</span> : String(val)}
                    </td>
                  );
                })}
                {!isSummarization && (
                  <td className="px-3 py-2 text-sm text-gray-800">
                    {renderTruncatedValue(row.label)}
                  </td>
                )}
                <td className="px-3 py-2 text-xs uppercase text-gray-500">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            Prev
          </button>
          <div className="text-sm text-gray-600">
            Page {currentPage} / {totalPages}
          </div>
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= textData.total}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

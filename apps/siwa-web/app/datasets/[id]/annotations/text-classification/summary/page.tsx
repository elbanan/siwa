/**
 * Redirect legacy text summary path to the new text dataset workflow.
 */
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function RedirectTextSummary({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id) {
      router.replace(
        `/text-datasets/${id}/annotations/text-classification/summary`
      );
    }
  }, [id, router]);

  return (
    <div className="text-sm text-gray-600">
      Redirecting to the text dataset summary…
    </div>
  );
}

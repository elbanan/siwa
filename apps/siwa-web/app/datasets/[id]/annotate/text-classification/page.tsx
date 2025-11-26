/**
 * Redirect legacy text annotation path to the dedicated text dataset workflow.
 */
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function RedirectTextAnnotate({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id) {
      router.replace(`/text-datasets/${id}/annotate/text-classification`);
    }
  }, [id, router]);

  return (
    <div className="text-sm text-gray-600">
      Redirecting to the text annotation workflow…
    </div>
  );
}

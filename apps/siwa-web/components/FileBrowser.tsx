/**
 * FileBrowser component
 * 
 * A modal dialog that allows users to browse and select folders/files
 * from the mounted external data directory.
 */

"use client";

import { useEffect, useState } from "react";
import api from "../lib/api";

interface BrowseItem {
    name: string;
    type: "directory" | "file";
    path: string;
    size?: number;
}

interface BrowseResponse {
    current_path: string;
    parent_path: string | null;
    items: BrowseItem[];
}

interface FileBrowserProps {
    onSelect: (path: string) => void;
    onCancel: () => void;
    initialPath?: string;
    selectFiles?: boolean; // If true, allow selecting files; if false, only directories
}

export default function FileBrowser({
    onSelect,
    onCancel,
    initialPath = "",
    selectFiles = false,
}: FileBrowserProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [items, setItems] = useState<BrowseItem[]>([]);
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Load directory contents
    const loadDirectory = async (path: string) => {
        setLoading(true);
        setError("");
        try {
            const res = await api.get<BrowseResponse>("/browse", {
                params: { path },
            });
            setCurrentPath(res.data.current_path);
            setParentPath(res.data.parent_path);
            setItems(res.data.items);
        } catch (e: any) {
            setError(
                e?.response?.data?.detail ?? e?.message ?? "Failed to load directory"
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadDirectory(currentPath);
    }, []);

    const handleItemClick = (item: BrowseItem) => {
        if (item.type === "directory") {
            loadDirectory(item.path);
        }
    };

    const handleSelectCurrent = () => {
        onSelect(`/external/data/${currentPath}`);
    };

    const handleGoToParent = () => {
        if (parentPath !== null) {
            loadDirectory(parentPath);
        }
    };

    // Build breadcrumb parts
    const breadcrumbParts = currentPath
        ? currentPath.split("/").filter(Boolean)
        : [];

    const handleBreadcrumbClick = (index: number) => {
        if (index === -1) {
            // Root
            loadDirectory("");
        } else {
            const path = breadcrumbParts.slice(0, index + 1).join("/");
            loadDirectory(path);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="border-b p-4">
                    <h2 className="text-lg font-semibold">Browse External Data</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Select a {selectFiles ? "file or folder" : "folder"} from the mounted external directory
                    </p>
                </div>

                {/* Breadcrumb */}
                <div className="border-b px-4 py-3 bg-gray-50">
                    <div className="flex items-center gap-2 text-sm overflow-x-auto">
                        <button
                            className="text-blue-600 hover:underline whitespace-nowrap"
                            onClick={() => handleBreadcrumbClick(-1)}
                        >
                            /external/data
                        </button>
                        {breadcrumbParts.map((part, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <span className="text-gray-400">/</span>
                                <button
                                    className="text-blue-600 hover:underline whitespace-nowrap"
                                    onClick={() => handleBreadcrumbClick(index)}
                                >
                                    {part}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">
                            Loading directory...
                        </div>
                    ) : error ? (
                        <div className="text-center py-8">
                            <p className="text-red-600 text-sm">{error}</p>
                            <button
                                className="mt-3 text-sm text-blue-600 hover:underline"
                                onClick={() => loadDirectory(currentPath)}
                            >
                                Retry
                            </button>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            This directory is empty
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {/* Parent directory link */}
                            {parentPath !== null && (
                                <button
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-left"
                                    onClick={handleGoToParent}
                                >
                                    <span className="text-xl">↩️</span>
                                    <span className="text-sm font-medium">..</span>
                                </button>
                            )}

                            {/* Directory and file items */}
                            {items.map((item) => (
                                <div
                                    key={item.path}
                                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100"
                                >
                                    <button
                                        className="flex-1 flex items-center gap-3 text-left"
                                        onClick={() => handleItemClick(item)}
                                    >
                                        <span className="text-xl">
                                            {item.type === "directory" ? "📁" : "📄"}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {item.name}
                                            </p>
                                            {item.type === "file" && item.size !== undefined && (
                                                <p className="text-xs text-gray-500">
                                                    {formatSize(item.size)}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                    {(selectFiles || item.type === "directory") && (
                                        <button
                                            className="text-sm px-3 py-1 rounded-md border hover:bg-gray-50 whitespace-nowrap"
                                            onClick={() => onSelect(`/external/data/${item.path}`)}
                                        >
                                            Select
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t p-4 flex justify-between items-center gap-3">
                    <div className="text-sm text-gray-600 flex-1 truncate">
                        Current: <span className="font-mono">/external/data/{currentPath || "/"}</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="px-4 py-2 rounded-lg border hover:bg-gray-50 text-sm"
                            onClick={onCancel}
                        >
                            Cancel
                        </button>
                        {!selectFiles && (
                            <button
                                className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800 text-sm"
                                onClick={handleSelectCurrent}
                            >
                                Select Current Folder
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

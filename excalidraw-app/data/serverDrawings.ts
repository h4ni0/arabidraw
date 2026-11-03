import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";

import type { AppState } from "@excalidraw/excalidraw/types";

export interface DrawingMetadata {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly revision: string;
}

export interface ServerDrawing extends DrawingMetadata {
  readonly scene: object;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (init?.signal?.aborted) {
    abort.abort();
  }
  init?.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => abort.abort(), 30_000);
  try {
    let response: Response;
    try {
      response = await fetch(`/api/drawings${path}`, {
        ...init,
        signal: abort.signal,
      });
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      throw new Error(
        abort.signal.aborted
          ? "The drawing server took too long to respond. Check your connection and try again."
          : "Cannot reach the drawing server. Check your connection and try again.",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      throw new Error(
        abort.signal.aborted
          ? "The drawing server took too long to respond. Check your connection and try again."
          : "The drawing server returned an invalid response. Check that the server is running and try again.",
      );
    }
    if (!response.ok) {
      throw new Error(
        data?.error ||
          `Drawing server request failed (${response.status}). Try again.`,
      );
    }
    return data as T;
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", onAbort);
  }
};

export const listDrawings = () => request<DrawingMetadata[]>("");

export interface DrawingFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

export interface FolderCatalog {
  readonly folders: readonly DrawingFolder[];
  readonly drawingFolders: Readonly<Record<string, string>>;
}

export const listDrawingFolders = () => request<FolderCatalog>("/folders");

export const saveDrawingFolder = (
  id: string | null,
  name: string,
  parentId?: string | null,
) =>
  request<FolderCatalog>(
    id ? `/folders/${encodeURIComponent(id)}` : "/folders",
    {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    },
  );

export const deleteDrawingFolder = (id: string) =>
  request<FolderCatalog>(`/folders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const moveDrawingToFolder = (id: string, folderId: string | null) =>
  request<FolderCatalog>(`/${encodeURIComponent(id)}/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });

export const getDrawing = (id: string, signal?: AbortSignal) =>
  request<ServerDrawing>(`/${encodeURIComponent(id)}`, { signal });

export const saveDrawing = (
  drawing: DrawingMetadata | null,
  name: string,
  scene: object,
  requestId?: string,
) =>
  request<DrawingMetadata>(
    drawing ? `/${encodeURIComponent(drawing.id)}` : "",
    {
      method: drawing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(drawing
          ? { "If-Match": `"${drawing.revision}"` }
          : requestId
          ? { "Idempotency-Key": requestId }
          : {}),
      },
      body: JSON.stringify({ name, scene }),
    },
  );

export const deleteDrawing = (drawing: DrawingMetadata) =>
  request<{ readonly id: string }>(`/${encodeURIComponent(drawing.id)}`, {
    method: "DELETE",
    headers: { "If-Match": `"${drawing.revision}"` },
  });

// Use the same restoration and image validation for a URL and a gallery load.
export const restoreServerDrawing = async (
  id: string,
  localAppState: AppState | null,
) => {
  const result = await getDrawing(id);
  const restored = await loadFromBlob(
    new Blob([JSON.stringify(result.scene)], { type: "application/json" }),
    localAppState,
    null,
  );
  for (const element of restored.elements) {
    if (!element.isDeleted && element.type === "image") {
      const file = element.fileId ? restored.files[element.fileId] : null;
      if (
        !file ||
        typeof file.dataURL !== "string" ||
        typeof file.mimeType !== "string"
      ) {
        throw new Error(
          "This drawing contains a missing or invalid embedded image. Your canvas has not been replaced.",
        );
      }
    }
  }
  return {
    ...restored,
    appState: {
      ...restored.appState,
      name: result.name,
      serverDrawing: {
        id: result.id,
        name: result.name,
        updatedAt: result.updatedAt,
        revision: result.revision,
      },
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null,
      openDialog: null,
      fileHandle: null,
    },
  };
};

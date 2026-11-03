import { useCallback, useEffect, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  deleteDrawing,
  getDrawing,
  listDrawings,
  saveDrawing,
} from "./data/serverDrawings";

import type { DrawingMetadata } from "./data/serverDrawings";

export interface ServerDrawingsController {
  readonly isOpen: boolean;
  readonly isCreatingNew: boolean;
  readonly activeDrawing: DrawingMetadata | null;
  readonly isDirty: boolean;
  readonly drawings: readonly DrawingMetadata[];
  readonly isListing: boolean;
  readonly operation: "save" | "load" | "delete" | null;
  readonly error: string;
  readonly listError: string;
  readonly name: string;
  readonly disabled: boolean;
  open(): void;
  close(): void;
  setName(name: string): void;
  refresh(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  createNew(): Promise<void>;
  discardAndCreateNew(): void;
  load(drawing: DrawingMetadata): Promise<void>;
  remove(drawing: DrawingMetadata): Promise<void>;
}

// Ignore editor chrome, image-cache status and element revision bookkeeping.
// Cache the expensive content snapshot so panning/selection never re-encodes images.
// Stable property order matters when comparing restored and live editor state.
const stableJSON = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      );
    }
    return item;
  });

// getRandomValues also works on HTTP LAN deployments where randomUUID is absent.
const createSaveRequestId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createContentTracker = () => {
  let previousElements: { id: string; version: number; deleted: boolean }[] =
    [];
  let previousFiles: { id: string; dataURL: string; mimeType: string }[] = [];
  let previousAppState = "";
  let content = "";

  return (
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    const exportedAppState = cleanAppStateForExport(appState);
    const state = stableJSON(exportedAppState);
    let changed =
      state !== previousAppState || elements.length !== previousElements.length;
    let fileIndex = 0;
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      const previous = previousElements[index];
      if (
        previous?.id !== element.id ||
        previous.version !== element.version ||
        previous.deleted !== element.isDeleted
      ) {
        changed = true;
      }
      if (!element.isDeleted && element.type === "image" && element.fileId) {
        const file = files[element.fileId];
        if (file) {
          const previousFile = previousFiles[fileIndex++];
          if (
            previousFile?.id !== file.id ||
            previousFile.dataURL !== file.dataURL ||
            previousFile.mimeType !== file.mimeType
          ) {
            changed = true;
          }
        }
      }
    }
    if (!changed && fileIndex === previousFiles.length) {
      return content;
    }
    previousAppState = state;
    previousElements = elements.map((element) => ({
      id: element.id,
      version: element.version,
      deleted: element.isDeleted,
    }));
    previousFiles = [];
    const visibleElements = [];
    for (const element of elements) {
      if (element.isDeleted) {
        continue;
      }
      visibleElements.push({
        ...element,
        version: undefined,
        versionNonce: undefined,
        updated: undefined,
        ...(element.type === "image" ? { status: undefined } : {}),
      });
      if (element.type === "image" && element.fileId && files[element.fileId]) {
        const file = files[element.fileId];
        previousFiles.push({
          id: file.id,
          dataURL: file.dataURL,
          mimeType: file.mimeType,
        });
      }
    }
    content = stableJSON({
      elements: visibleElements,
      appState: exportedAppState,
      files: previousFiles,
    });
    return content;
  };
};

export const useServerDrawings = (
  api: ExcalidrawImperativeAPI | null,
  isCollaborating: boolean,
): ServerDrawingsController => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [activeDrawing, setActiveDrawing] = useState<DrawingMetadata | null>(
    null,
  );
  const [isDirty, setIsDirty] = useState(true);
  const [drawings, setDrawings] = useState<readonly DrawingMetadata[]>([]);
  const [isListing, setIsListing] = useState(false);
  const [operation, setOperation] =
    useState<ServerDrawingsController["operation"]>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [name, setName] = useState("");
  const savedContent = useRef<string | null>(null);
  const savedRevision = useRef<string | null>(null);
  const [trackContent] = useState(createContentTracker);
  const busy = useRef(false);
  const pendingCreate = useRef<{
    id: string;
    content: string;
    name: string;
    scene: object;
  } | null>(null);
  const collaboration = useRef(isCollaborating);
  const listRequest = useRef(0);
  collaboration.current = isCollaborating;

  const currentContent = useCallback(() => {
    if (!api) {
      return "";
    }
    return trackContent(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
    );
  }, [api, trackContent]);

  useEffect(() => {
    if (!api) {
      return;
    }
    const update = () => {
      if (api.getAppState().isLoading) {
        return;
      }
      const drawing = api.getAppState().serverDrawing;
      setActiveDrawing(drawing);
      setIsDirty(
        !drawing ||
          savedRevision.current !== `${drawing.id}:${drawing.revision}` ||
          savedContent.current === null ||
          currentContent() !== savedContent.current,
      );
    };
    update();
    return api.onChange(update);
  }, [api, currentContent]);

  // Re-establish the saved baseline after a reload without replacing local edits.
  useEffect(() => {
    if (!api || !activeDrawing) {
      savedContent.current = null;
      savedRevision.current = null;
      return;
    }
    const key = `${activeDrawing.id}:${activeDrawing.revision}`;
    if (savedRevision.current === key) {
      return;
    }
    savedContent.current = null;
    savedRevision.current = null;
    let cancelled = false;
    void (async () => {
      try {
        const drawing = await getDrawing(activeDrawing.id);
        if (drawing.revision !== activeDrawing.revision) {
          return;
        }
        const restored = await loadFromBlob(
          new Blob([JSON.stringify(drawing.scene)], {
            type: "application/json",
          }),
          null,
          null,
        );
        if (!cancelled) {
          savedContent.current = createContentTracker()(
            restored.elements,
            restored.appState,
            restored.files,
          );
          savedRevision.current = key;
          setIsDirty(currentContent() !== savedContent.current);
        }
      } catch (error) {
        // The canvas stays editable offline; saving reports actionable errors.
        console.error("Checking saved drawing failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDrawing, api, currentContent]);

  useEffect(() => {
    if (!activeDrawing) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!collaboration.current && currentContent() !== savedContent.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [activeDrawing, currentContent]);

  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setIsListing(true);
    setListError("");
    try {
      const result = await listDrawings();
      if (request === listRequest.current) {
        setDrawings(result);
      }
    } catch (error) {
      console.error("Listing server drawings failed", error);
      if (request === listRequest.current) {
        setListError(
          error instanceof Error
            ? error.message
            : "Could not list drawings. Try refreshing.",
        );
      }
    } finally {
      if (request === listRequest.current) {
        setIsListing(false);
      }
    }
  }, []);

  const open = () => {
    setIsCreatingNew(false);
    setIsOpen(true);
    setName(activeDrawing?.name ?? api?.getName() ?? "");
    setError("");
    void refresh();
  };

  const resetDrawing = () => {
    if (!api || collaboration.current) {
      return;
    }
    savedContent.current = null;
    savedRevision.current = null;
    pendingCreate.current = null;
    api.resetScene({ resetLoadingState: true });
    setActiveDrawing(null);
    setName("");
    setIsDirty(true);
    setIsCreatingNew(false);
    setIsOpen(false);
    setError("");
  };

  const save = async (saveAs: boolean, startNew = isCreatingNew) => {
    if (!api || busy.current || collaboration.current) {
      return;
    }
    if (!isOpen && (!activeDrawing || saveAs)) {
      open();
      return;
    }
    const drawingName = (isOpen ? name : activeDrawing?.name ?? "").trim();
    if (!drawingName || drawingName.length > 200) {
      setError("Enter a drawing name between 1 and 200 characters.");
      return;
    }
    busy.current = true;
    ++listRequest.current;
    setIsListing(false);
    setOperation("save");
    setError("");
    try {
      for (const element of api.getSceneElements()) {
        if (
          element.type === "image" &&
          (!element.fileId || !api.getFiles()[element.fileId])
        ) {
          throw new Error(
            "An image is still loading or unavailable. Wait for it to load, or remove the missing image before saving.",
          );
        }
      }
      const snapshot = currentContent();
      const identity = api.getAppState().serverDrawing;
      const canvasName = api.getAppState().name;
      const scene = JSON.parse(
        serializeAsJSON(
          api.getSceneElements(),
          api.getAppState(),
          api.getFiles(),
          "local",
        ),
      );
      scene.appState.name = drawingName;
      const target = saveAs ? null : activeDrawing;
      if (
        !target &&
        (pendingCreate.current?.content !== snapshot ||
          pendingCreate.current?.name !== drawingName)
      ) {
        pendingCreate.current = {
          id: createSaveRequestId(),
          content: snapshot,
          name: drawingName,
          scene,
        };
      }
      const result = await saveDrawing(
        target,
        drawingName,
        target ? scene : pendingCreate.current!.scene,
        target ? undefined : pendingCreate.current!.id,
      );
      pendingCreate.current = null;
      void refresh();
      if (
        collaboration.current ||
        api.getAppState().serverDrawing !== identity ||
        api.getAppState().name !== canvasName
      ) {
        setError(
          `Saved “${result.name}”, but the active canvas changed. Open it from the gallery to continue working on that saved copy.`,
        );
        if (startNew) {
          setIsCreatingNew(false);
          setIsOpen(true);
        }
        return;
      }
      savedContent.current = snapshot;
      savedRevision.current = `${result.id}:${result.revision}`;
      setActiveDrawing(result);
      setName(result.name);
      const changedWhileSaving = currentContent() !== snapshot;
      setIsDirty(changedWhileSaving);
      api.updateScene({
        appState: {
          name: result.name,
          serverDrawing: result,
          toast: { message: `Saved “${result.name}”` },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      if (startNew) {
        if (changedWhileSaving) {
          setError(
            "The canvas changed while saving. Save again before creating a new drawing, or cancel to keep editing.",
          );
          setIsOpen(true);
        } else {
          resetDrawing();
        }
      }
    } catch (error) {
      console.error("Saving server drawing failed", error);
      setError(
        error instanceof Error
          ? error.message
          : "Could not save the drawing. Try again.",
      );
      setIsOpen(true);
    } finally {
      busy.current = false;
      setOperation(null);
    }
  };

  const createNew = async () => {
    if (!api || busy.current || collaboration.current) {
      return;
    }
    setIsCreatingNew(true);
    setName(activeDrawing?.name ?? api.getName());
    setError("");
    if (activeDrawing) {
      await save(false, true);
    } else {
      setIsOpen(true);
    }
  };

  const discardAndCreateNew = () => {
    if (!busy.current && !api?.getAppState().serverDrawing) {
      resetDrawing();
    }
  };

  const load = async (drawing: DrawingMetadata) => {
    if (!api || busy.current || collaboration.current) {
      return;
    }
    const before = currentContent();
    if (
      (savedContent.current === null || before !== savedContent.current) &&
      !window.confirm(
        "This canvas has unsaved changes. Load another drawing and discard them?",
      )
    ) {
      return;
    }
    busy.current = true;
    setOperation("load");
    setError("");
    try {
      const result = await getDrawing(drawing.id);
      const restored = await loadFromBlob(
        new Blob([JSON.stringify(result.scene)], { type: "application/json" }),
        api.getAppState(),
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
      if (collaboration.current) {
        setError(
          "Loading was cancelled because collaboration started. Leave collaboration and try again.",
        );
        return;
      }
      if (
        currentContent() !== before &&
        !window.confirm(
          "The canvas changed while this drawing was loading. Discard those new changes and continue?",
        )
      ) {
        return;
      }
      const appState = {
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
      };
      savedRevision.current = `${result.id}:${result.revision}`;
      savedContent.current = createContentTracker()(
        restored.elements,
        appState,
        restored.files,
      );
      api.updateScene({
        elements: restored.elements,
        appState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.addFiles(Object.values(restored.files));
      api.history.clear();
      setActiveDrawing(appState.serverDrawing);
      setName(result.name);
      setIsDirty(false);
      setIsOpen(false);
    } catch (error) {
      console.error("Loading server drawing failed", error);
      setError(
        error instanceof Error
          ? error.message
          : "Could not load the drawing. Your canvas has not been replaced.",
      );
      setIsOpen(true);
    } finally {
      busy.current = false;
      setOperation(null);
    }
  };

  const remove = async (drawing: DrawingMetadata) => {
    if (!api || busy.current || collaboration.current) {
      return;
    }
    if (
      !window.confirm(
        `Delete “${drawing.name}” from the server? This cannot be undone. Your current canvas will stay unchanged.`,
      )
    ) {
      return;
    }
    busy.current = true;
    ++listRequest.current;
    setIsListing(false);
    setOperation("delete");
    setError("");
    try {
      await deleteDrawing(drawing);
      setDrawings((current) =>
        current.filter((item) => item.id !== drawing.id),
      );
      if (activeDrawing?.id === drawing.id) {
        savedContent.current = null;
        savedRevision.current = null;
        api.updateScene({
          appState: { serverDrawing: null },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        setActiveDrawing(null);
        setIsDirty(true);
      }
      void refresh();
    } catch (error) {
      console.error("Deleting server drawing failed", error);
      setError(
        `Could not delete “${drawing.name}”. ${
          error instanceof Error ? error.message : ""
        } Refresh the list and try again.`,
      );
      setIsOpen(true);
    } finally {
      busy.current = false;
      setOperation(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) {
          open();
        } else {
          void save(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return {
    isOpen,
    isCreatingNew,
    open,
    close: () => {
      if (!busy.current) {
        setIsOpen(false);
        setIsCreatingNew(false);
      }
    },
    activeDrawing,
    isDirty,
    drawings,
    isListing,
    operation,
    error,
    listError,
    name,
    setName,
    refresh,
    save,
    createNew,
    discardAndCreateNew,
    load,
    remove,
    disabled: !api || isCollaborating,
  };
};

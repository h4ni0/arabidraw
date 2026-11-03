import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

import { getDrawingIdFromUrl } from "./drawingUrl";

export const saveUsernameToLocalStorage = (username: string) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
      JSON.stringify({ username }),
    );
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
  }
};

export const importUsernameFromLocalStorage = (): string | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    if (data) {
      return JSON.parse(data).username;
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  return null;
};

export const importFromLocalStorage = () => {
  const drawingId = getDrawingIdFromUrl();
  let savedElements = null;
  let savedState = null;
  let baseDrawing: AppState["serverDrawing"] = null;

  try {
    savedElements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    // Ignore the old persisted active drawing. The URL is the only selector.
    if (drawingId !== null) {
      savedElements = null;
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  try {
    const draft = JSON.parse(
      sessionStorage.getItem(STORAGE_KEYS.SESSION_STORAGE_DRAFT) ?? "null",
    );
    if (
      draft &&
      Array.isArray(draft.elements) &&
      draft.appState &&
      typeof draft.appState === "object" &&
      // Recover pre-URL drafts as unnamed canvases on upgrade. Never use
      // their old identity to select a server drawing.
      (draft.drawingId === drawingId ||
        (draft.drawingId === undefined && drawingId === null)) &&
      (drawingId === null || draft.baseDrawing?.id === drawingId)
    ) {
      savedElements = JSON.stringify(draft.elements);
      savedState = JSON.stringify(draft.appState);
      baseDrawing = drawingId === null ? null : draft.baseDrawing;
    }
  } catch (error) {
    console.error("Reading this tab's draft failed", error);
  }

  let elements: ExcalidrawElement[] = [];
  if (savedElements) {
    try {
      elements = JSON.parse(savedElements);
    } catch (error: any) {
      console.error(error);
      // Do nothing because elements array is already empty
    }
  }

  let appState = null;
  if (savedState) {
    try {
      appState = {
        ...getDefaultAppState(),
        ...clearAppStateForLocalStorage(
          JSON.parse(savedState) as Partial<AppState>,
        ),
        serverDrawing: baseDrawing,
      };
    } catch (error: any) {
      console.error(error);
      // Do nothing because appState is already null
    }
  }
  return { elements, appState };
};

export const getElementsStorageSize = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    const elementsSize = elements?.length || 0;
    return elementsSize;
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getTotalStorageSize = () => {
  try {
    const appState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    const collab = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);

    const appStateSize = appState?.length || 0;
    const collabSize = collab?.length || 0;

    return appStateSize + collabSize + getElementsStorageSize();
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

// Saved drawings are addressed independently of Excalidraw's share/collab links.
const DRAWING_PATH = "/drawing/";
const HISTORY_INDEX = "arabidrawDrawingIndex";

export const getDrawingIdFromUrl = () =>
  window.location.pathname.match(/^\/drawing\/([^/]*)\/?$/)?.[1] ?? null;

export const getDrawingLocation = () => ({
  href: window.location.href,
  index: (window.history.state?.[HISTORY_INDEX] ?? 0) as number,
});

export const initializeDrawingHistory = () => {
  window.history.replaceState(
    { ...window.history.state, [HISTORY_INDEX]: getDrawingLocation().index },
    "",
  );
  return getDrawingLocation();
};

export const setDrawingUrl = (
  id: string | null,
  mode: "push" | "replace" = "push",
) => {
  const url = new URL(window.location.href);
  url.pathname = id === null ? "/" : `${DRAWING_PATH}${encodeURIComponent(id)}`;
  url.searchParams.delete("drawing");
  if (url.href !== window.location.href) {
    window.history[mode === "push" ? "pushState" : "replaceState"](
      {
        ...window.history.state,
        [HISTORY_INDEX]: getDrawingLocation().index + (mode === "push" ? 1 : 0),
      },
      "",
      url,
    );
  }
  return getDrawingLocation();
};

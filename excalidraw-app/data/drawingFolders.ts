import type { DrawingFolder } from "./serverDrawings";

export const HOME_FOLDER_ID = "home";

export const getFolderPath = (
  folders: readonly DrawingFolder[],
  id: string | null,
): { id: string; name: string }[] => {
  const path: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  while (id && !seen.has(id)) {
    seen.add(id);
    if (id === HOME_FOLDER_ID) {
      path.unshift({ id, name: "Home" });
      break;
    }
    const folder = byId.get(id);
    if (!folder) {
      break;
    }
    path.unshift({ id: folder.id, name: folder.name });
    id = folder.parentId;
  }
  return path;
};

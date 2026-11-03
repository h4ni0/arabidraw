import { useRef, useState } from "react";

import { LoadIcon } from "@excalidraw/excalidraw/components/icons";

import { getFolderPath, HOME_FOLDER_ID } from "../data/drawingFolders";

import { ServerDrawingPreview } from "./ServerDrawingPreview";

import styles from "./ServerDrawingsDialog.module.scss";

import type { DragEvent, ReactNode } from "react";

import type { DrawingFolder, DrawingMetadata } from "../data/serverDrawings";
import type { ServerDrawingsController } from "../useServerDrawings";

export const ServerDrawingGallery = ({
  controller,
}: {
  controller: ServerDrawingsController;
}) => {
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const draggedDrawing = useRef<DrawingMetadata | null>(null);
  const homeButton = useRef<HTMLButtonElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [movingDrawing, setMovingDrawing] = useState<DrawingMetadata | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [folderEditor, setFolderEditor] = useState<{
    id: string | null;
    name: string;
    parentId: string | null;
  } | null>(null);
  const { folders, drawingFolders } = controller.folderCatalog;
  const sortedFolders = [...folders].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const folder = folders.find((item) => item.id === selectedFolder);
  // A folder may have been deleted in another tab since it was selected.
  const selection =
    folder || selectedFolder === HOME_FOLDER_ID ? selectedFolder : "all";
  const title =
    folder?.name ?? (selection === HOME_FOLDER_ID ? "Home" : "All drawings");
  const disabled =
    controller.disabled ||
    controller.operation !== null ||
    controller.isListing ||
    !!controller.listError;
  const query = search.trim().toLocaleLowerCase();
  const visibleDrawings = controller.drawings.filter(
    (drawing) =>
      (!!query ||
        selection === "all" ||
        (selection === HOME_FOLDER_ID
          ? !drawingFolders[drawing.id]
          : drawingFolders[drawing.id] === selection)) &&
      drawing.name.toLocaleLowerCase().includes(query),
  );
  const counts = new Map<string, number>();
  for (const drawing of controller.drawings) {
    const key = drawingFolders[drawing.id] ?? HOME_FOLDER_ID;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const clearDrag = () => {
    draggedDrawing.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };
  const move = async (drawing: DrawingMetadata, folderId: string | null) => {
    if (disabled) {
      return;
    }
    setMovingDrawing(null);
    if ((drawingFolders[drawing.id] ?? null) === folderId) {
      return;
    }
    setAnnouncement("");
    if (await controller.moveToFolder(drawing, folderId)) {
      const destination =
        folders.find((item) => item.id === folderId)?.name ?? "Home";
      setAnnouncement(`Moved “${drawing.name}” to ${destination}.`);
    }
  };
  const chooseFolder = (folderId: string | null) => {
    if (movingDrawing) {
      void move(movingDrawing, folderId);
    } else {
      setSelectedFolder(folderId ?? HOME_FOLDER_ID);
    }
  };
  const dropProps = (folderId: string | null) => {
    const key = folderId ?? HOME_FOLDER_ID;
    const canDrop = () =>
      !disabled &&
      !!draggedDrawing.current &&
      (drawingFolders[draggedDrawing.current.id] ?? null) !== folderId;
    const hover = (event: DragEvent<HTMLButtonElement>) => {
      if (!draggedDrawing.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = canDrop() ? "move" : "none";
      setDropTarget(canDrop() ? key : null);
    };
    return {
      "data-drop-ready":
        !disabled &&
        !!(draggingId || movingDrawing) &&
        (drawingFolders[draggingId ?? movingDrawing!.id] ?? null) !== folderId,
      "data-drop-active": dropTarget === key,
      onDragEnter: hover,
      onDragOver: hover,
      onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTarget(null);
        }
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        if (!draggedDrawing.current) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const drawing = draggedDrawing.current;
        const accepted = canDrop();
        clearDrag();
        if (accepted) {
          void move(drawing, folderId);
        }
      },
    };
  };

  const selectedDrawing =
    visibleDrawings.find((item) => item.id === selectedDrawingId) ??
    visibleDrawings.find((item) => item.id === controller.activeDrawing?.id) ??
    visibleDrawings[0];
  const folderPath = (id: string | null) =>
    getFolderPath(folders, id)
      .map((item) => item.name)
      .join(" / ");
  const dragProps = (drawing: DrawingMetadata) => ({
    draggable: !disabled,
    "data-dragging": draggingId === drawing.id,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      draggedDrawing.current = drawing;
      setDraggingId(drawing.id);
      setMovingDrawing(null);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.clearData();
      event.dataTransfer.setData("application/x-arabidraw-drawing", drawing.id);
    },
    onDragEnd: clearDrag,
  });
  const renderFolderNode = (item: DrawingFolder): ReactNode => {
    const children = sortedFolders.filter(
      (child) => child.parentId === item.id,
    );
    const isCollapsed = collapsed.has(item.id);
    return (
      <li
        key={item.id}
        data-folder-id={item.id}
        data-parent-id={item.parentId ?? "top-level"}
      >
        <div className={styles.folderRow}>
          {children.length > 0 ? (
            <button
              type="button"
              className={styles.folderToggle}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${
                folderPath(item.id) || item.name
              }`}
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                  return next;
                })
              }
            >
              {isCollapsed ? "›" : "⌄"}
            </button>
          ) : (
            <span className={styles.folderSpacer} />
          )}
          <button
            type="button"
            className={styles.folderName}
            ref={item.id === HOME_FOLDER_ID ? homeButton : undefined}
            disabled={!!movingDrawing && disabled}
            {...dropProps(item.id === HOME_FOLDER_ID ? null : item.id)}
            aria-pressed={selection === item.id}
            onClick={() => {
              chooseFolder(item.id === HOME_FOLDER_ID ? null : item.id);
              if (!movingDrawing) {
                setSearch("");
              }
            }}
          >
            <span className={styles.folderIcon} aria-hidden="true">
              {LoadIcon}
            </span>
            <span>{item.name}</span>
            <span className={styles.folderCount}>
              {counts.get(item.id) ?? 0}
            </span>
          </button>
        </div>
        {children.length > 0 && !isCollapsed && (
          <ul>{children.map(renderFolderNode)}</ul>
        )}
      </li>
    );
  };
  const parentOptions = sortedFolders.filter(
    (item) =>
      !folderEditor?.id ||
      !getFolderPath(folders, item.id).some(
        (parent) => parent.id === folderEditor.id,
      ),
  );

  return (
    <section
      aria-label="Drawing browser"
      className={styles.browser}
      onKeyDownCapture={(event) => {
        if (
          (event.key === "Enter" || event.key === " ") &&
          (event.target as HTMLElement).closest("button")
        ) {
          event.stopPropagation();
        }
        if (
          event.key === "Escape" &&
          (movingDrawing || draggedDrawing.current)
        ) {
          event.preventDefault();
          event.stopPropagation();
          setMovingDrawing(null);
          clearDrag();
        }
      }}
      onDragOver={(event) => {
        if (draggedDrawing.current) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "none";
          setDropTarget(null);
        }
      }}
      onDrop={(event) => {
        if (draggedDrawing.current) {
          event.preventDefault();
          event.stopPropagation();
          clearDrag();
        }
      }}
    >
      <div className={styles.browserToolbar}>
        <input
          type="search"
          aria-label="Search drawings"
          placeholder="Search all drawings…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            setFolderEditor({
              id: null,
              name: "",
              parentId: folder?.id ?? null,
            })
          }
        >
          + New folder
        </button>
        <button
          type="button"
          disabled={
            controller.disabled ||
            controller.isListing ||
            controller.operation !== null
          }
          onClick={() => void controller.refresh()}
        >
          Refresh
        </button>
      </div>
      {folderEditor && (
        <form
          className={styles.folderEditor}
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await controller.saveFolder(
                folderEditor.id,
                folderEditor.name,
                folderEditor.parentId,
              )
            ) {
              setCollapsed((current) => {
                const next = new Set(current);
                if (folderEditor.parentId) {
                  next.delete(folderEditor.parentId);
                }
                return next;
              });
              setFolderEditor(null);
            }
          }}
        >
          <div className={styles.folderFields}>
            <div>
              <label htmlFor="drawing-folder-name">
                {folderEditor.id ? "Folder name" : "New folder name"}
              </label>
              <input
                id="drawing-folder-name"
                autoFocus
                maxLength={200}
                value={folderEditor.name}
                disabled={disabled}
                onChange={(event) =>
                  setFolderEditor({ ...folderEditor, name: event.target.value })
                }
              />
            </div>
            <div>
              <label htmlFor="drawing-folder-parent">Parent folder</label>
              <select
                id="drawing-folder-parent"
                value={folderEditor.parentId ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setFolderEditor({
                    ...folderEditor,
                    parentId: event.target.value || null,
                  })
                }
              >
                <option value="">Top level (alongside Home)</option>
                <option value={HOME_FOLDER_ID}>Home</option>
                {parentOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {folderPath(item.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.actions}>
            <button
              type="submit"
              disabled={disabled || !folderEditor.name.trim()}
            >
              {folderEditor.id ? "Save folder" : "Create folder"}
            </button>
            <button
              type="button"
              disabled={controller.operation !== null}
              onClick={() => setFolderEditor(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {controller.isListing && <p role="status">Loading drawing list…</p>}
      {controller.listError && (
        <p role="alert" className={styles.error}>
          {controller.listError}
        </p>
      )}
      <div className={styles.galleryLayout}>
        <nav className={styles.folders} aria-label="Drawing folders">
          <button
            type="button"
            className={styles.allDrawings}
            disabled={!!movingDrawing}
            aria-pressed={selection === "all"}
            onClick={() => {
              setSelectedFolder("all");
              setSearch("");
            }}
          >
            <span>All drawings</span>
            <span>{controller.drawings.length}</span>
          </button>
          <ul className={styles.folderTree} aria-label="Folders">
            {renderFolderNode({
              id: HOME_FOLDER_ID,
              name: "Home",
              parentId: null,
            })}
            {sortedFolders
              .filter((item) => item.parentId === null)
              .map(renderFolderNode)}
          </ul>
          {folder && (
            <div className={styles.folderActions}>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setFolderEditor({
                    id: folder.id,
                    name: folder.name,
                    parentId: folder.parentId,
                  })
                }
              >
                Edit folder
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={async () => {
                  if (await controller.removeFolder(folder)) {
                    setSelectedFolder(folder.parentId ?? "all");
                    setFolderEditor(null);
                  }
                }}
              >
                Delete folder
              </button>
            </div>
          )}
        </nav>
        <div className={styles.drawingListPane}>
          <div className={styles.listHeading}>
            <h3>
              {query
                ? "Search results"
                : folder
                ? folderPath(folder.id)
                : title}
            </h3>
            <span role="status">
              {visibleDrawings.length}{" "}
              {visibleDrawings.length === 1 ? "drawing" : "drawings"}
            </span>
          </div>
          {!controller.isListing &&
            !controller.listError &&
            visibleDrawings.length === 0 && (
              <p className={styles.empty}>
                {query
                  ? "No drawings match your search."
                  : "No drawings in this folder. Drag a drawing here from another folder."}
              </p>
            )}
          <ul
            className={styles.drawingList}
            aria-label="Saved drawings"
            aria-busy={controller.isListing}
          >
            {visibleDrawings.map((drawing) => (
              <li key={drawing.id}>
                <button
                  type="button"
                  className={styles.drawingRow}
                  data-drawing-id={drawing.id}
                  {...dragProps(drawing)}
                  aria-label={`Preview ${drawing.name}`}
                  aria-pressed={selectedDrawing?.id === drawing.id}
                  onClick={() => setSelectedDrawingId(drawing.id)}
                  onDoubleClick={() => {
                    if (!disabled) {
                      void controller.load(drawing);
                    }
                  }}
                >
                  <ServerDrawingPreview drawing={drawing} thumbnail />
                  <span className={styles.drawingRowText}>
                    <span className={styles.cardTitle}>
                      <strong>{drawing.name}</strong>
                      {drawing.id === controller.activeDrawing?.id && (
                        <span className={styles.activeBadge}>Active</span>
                      )}
                    </span>
                    <time dateTime={drawing.updatedAt}>
                      {new Date(drawing.updatedAt).toLocaleString()}
                    </time>
                    {query && (
                      <span>
                        {folderPath(
                          drawingFolders[drawing.id] ?? HOME_FOLDER_ID,
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <section className={styles.previewPane} aria-label="Drawing preview">
          {selectedDrawing ? (
            <>
              <div
                className={styles.previewImage}
                {...dragProps(selectedDrawing)}
                data-preview-drawing-id={selectedDrawing.id}
              >
                <ServerDrawingPreview drawing={selectedDrawing} />
              </div>
              <h3>{selectedDrawing.name}</h3>
              <p className={styles.previewLocation}>
                Folder:{" "}
                {folderPath(
                  drawingFolders[selectedDrawing.id] ?? HOME_FOLDER_ID,
                )}
              </p>
              <time dateTime={selectedDrawing.updatedAt}>
                Modified {new Date(selectedDrawing.updatedAt).toLocaleString()}
              </time>
              <button
                type="button"
                className={styles.openDrawing}
                disabled={controller.disabled || controller.operation !== null}
                aria-label={`Load ${selectedDrawing.name}`}
                onClick={() => void controller.load(selectedDrawing)}
              >
                Open drawing →
              </button>
              <div className={styles.previewActions}>
                <button
                  type="button"
                  aria-label={`Move ${selectedDrawing.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setMovingDrawing(selectedDrawing);
                    setAnnouncement("");
                    homeButton.current?.focus();
                  }}
                >
                  Move
                </button>
                <button
                  type="button"
                  className={styles.delete}
                  aria-label={`Delete ${selectedDrawing.name}`}
                  disabled={disabled}
                  onClick={() => void controller.remove(selectedDrawing)}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <p className={styles.empty}>Select a drawing to preview it.</p>
          )}
        </section>
      </div>
      <div className={styles.galleryFooter}>
        <p className={styles.moveHint} role="status">
          {movingDrawing
            ? `Move “${movingDrawing.name}”: choose a destination folder.`
            : announcement || "Drag drawings onto a folder to move them."}
        </p>
        {movingDrawing && (
          <button type="button" onClick={() => setMovingDrawing(null)}>
            Cancel move
          </button>
        )}
      </div>
    </section>
  );
};

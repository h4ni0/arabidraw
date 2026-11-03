import { Dialog } from "@excalidraw/excalidraw/components/Dialog";

import { ServerDrawingGallery } from "./ServerDrawingGallery";

import styles from "./ServerDrawingsDialog.module.scss";

import type { ServerDrawingsController } from "../useServerDrawings";

export const ServerDrawingsDialog = ({
  drawings: controller,
}: {
  drawings: ServerDrawingsController;
}) => {
  if (!controller.isOpen) {
    return null;
  }

  const disabled = controller.disabled || controller.operation !== null;

  return (
    <Dialog
      title={controller.isCreatingNew ? "New drawing" : "Drawings"}
      size={controller.isCreatingNew ? "regular" : "wide"}
      className={controller.isCreatingNew ? undefined : styles.galleryDialog}
      onCloseRequest={controller.close}
    >
      <div className={styles.content}>
        <p aria-live="polite" className={styles.status}>
          <strong>{controller.activeDrawing?.name ?? "Unsaved drawing"}</strong>
          <span>
            {!controller.activeDrawing
              ? "Not saved to server"
              : controller.isDirty
              ? "Unsaved changes"
              : "Saved to server"}
          </span>
        </p>
        {controller.disabled && (
          <p role="status">
            Server drawing actions are unavailable during collaboration. Leave
            the collaboration session to use them.
          </p>
        )}
        {controller.isCreatingNew && (
          <p>
            {controller.activeDrawing
              ? "Save the current drawing before opening a new canvas."
              : "Save this drawing as a new draft, or discard it and open a new canvas. Discarding cannot be undone."}
          </p>
        )}
        {controller.isCreatingNew && !controller.activeDrawing && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.delete}
              disabled={disabled}
              onClick={controller.discardAndCreateNew}
            >
              Discard and create new
            </button>
          </div>
        )}
        {controller.operation && (
          <p role="status">
            {controller.operation === "save"
              ? "Saving drawing…"
              : controller.operation === "delete"
              ? "Deleting drawing…"
              : controller.operation === "organize"
              ? "Updating folders…"
              : "Loading drawing…"}
          </p>
        )}
        {controller.error && (
          <p role="alert" className={styles.error}>
            {controller.error}
          </p>
        )}
        {!controller.isCreatingNew && (
          <ServerDrawingGallery controller={controller} />
        )}
        <form
          className={styles.saveAs}
          onSubmit={(event) => {
            event.preventDefault();
            void controller.save(false);
          }}
        >
          <label htmlFor="server-drawing-name">Current canvas</label>
          <div className={styles.actions}>
            <input
              id="server-drawing-name"
              aria-label="Drawing name"
              type="text"
              value={controller.name}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => controller.setName(event.target.value)}
            />
            <button
              type="submit"
              disabled={disabled || !controller.name.trim()}
            >
              {controller.isCreatingNew ? "Save and create new" : "Save"}
            </button>
            {controller.activeDrawing && !controller.isCreatingNew && (
              <button
                type="button"
                disabled={disabled || !controller.name.trim()}
                onClick={() => void controller.save(true)}
              >
                Save as copy
              </button>
            )}
          </div>
          {!controller.activeDrawing && (
            <span>Enter a name to save this drawing on the server.</span>
          )}
        </form>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={controller.operation !== null}
            onClick={controller.close}
          >
            {controller.isCreatingNew ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

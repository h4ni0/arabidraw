import { useEffect, useRef, useState } from "react";

import { getNonDeletedElements } from "@excalidraw/element";
import { exportToCanvas } from "@excalidraw/excalidraw";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";

import { getDrawing } from "../data/serverDrawings";

import styles from "./ServerDrawingPreview.module.scss";

import type { DrawingMetadata } from "../data/serverDrawings";

const MAX_PREVIEWS = 24;
const MAX_CONCURRENT_PREVIEWS = 2;
const PREVIEW_SIZE = 640;

type PreviewListener = (preview: string | null) => void;

type PreviewJob = {
  readonly key: string;
  readonly id: string;
  readonly abort: AbortController;
  readonly listeners: Set<PreviewListener>;
};

// Cache only small rasters, never scenes or their embedded full-size images.
const previews = new Map<string, string | null>();
const jobs = new Map<string, PreviewJob>();
const queue: PreviewJob[] = [];
let running = 0;

const renderPreview = async (job: PreviewJob) => {
  let preview: string | null = null;
  try {
    const drawing = await getDrawing(job.id, job.abort.signal);
    if (job.abort.signal.aborted) {
      return;
    }
    const restored = await loadFromBlob(
      new Blob([JSON.stringify(drawing.scene)], { type: "application/json" }),
      null,
      null,
    );
    if (job.abort.signal.aborted) {
      return;
    }
    const elements = getNonDeletedElements(restored.elements);
    for (const element of elements) {
      if (element.type === "image") {
        const file = element.fileId ? restored.files[element.fileId] : null;
        if (!file?.dataURL || !file.mimeType) {
          throw new Error("The saved drawing has a missing embedded image.");
        }
      }
    }
    const canvas = await exportToCanvas({
      elements,
      appState: {
        ...restored.appState,
        exportBackground: true,
        exportScale: 1,
      },
      files: restored.files,
      maxWidthOrHeight: PREVIEW_SIZE,
    });
    try {
      if (!job.abort.signal.aborted) {
        preview = canvas.toDataURL("image/png");
      }
    } finally {
      // Release the backing buffer without retaining a canvas in the cache.
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch (error) {
    if (!job.abort.signal.aborted) {
      console.error(
        `Rendering saved drawing preview failed (${job.id})`,
        error,
      );
    }
  } finally {
    if (!job.abort.signal.aborted) {
      if (preview !== null) {
        previews.set(job.key, preview);
      }
      if (previews.size > MAX_PREVIEWS) {
        const oldest = previews.keys().next().value;
        if (oldest !== undefined) {
          previews.delete(oldest);
        }
      }
      for (const listener of job.listeners) {
        listener(preview);
      }
    }
    if (jobs.get(job.key) === job) {
      jobs.delete(job.key);
    }
    running--;
    runQueue();
  }
};

const runQueue = () => {
  while (running < MAX_CONCURRENT_PREVIEWS && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void renderPreview(job);
  }
};

const requestPreview = (
  key: string,
  id: string,
  listener: PreviewListener,
  priority: boolean,
) => {
  const cached = previews.get(key);
  if (cached !== undefined) {
    previews.delete(key);
    previews.set(key, cached);
    listener(cached);
    return () => {};
  }
  let job = jobs.get(key);
  if (!job) {
    job = { key, id, abort: new AbortController(), listeners: new Set() };
    jobs.set(key, job);
    priority ? queue.unshift(job) : queue.push(job);
  } else if (priority) {
    // Selecting a drawing takes precedence over queued row thumbnails.
    const index = queue.indexOf(job);
    if (index !== -1) {
      queue.splice(index, 1);
      queue.unshift(job);
    }
  }
  job.listeners.add(listener);
  runQueue();
  const subscribedJob = job;
  return () => {
    subscribedJob.listeners.delete(listener);
    if (subscribedJob.listeners.size === 0) {
      subscribedJob.abort.abort();
      const index = queue.indexOf(subscribedJob);
      if (index !== -1) {
        queue.splice(index, 1);
      }
      if (jobs.get(key) === subscribedJob) {
        jobs.delete(key);
      }
    }
  };
};

export const ServerDrawingPreview = ({
  drawing,
  thumbnail = false,
}: {
  drawing: DrawingMetadata;
  thumbnail?: boolean;
}) => {
  const container = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<{
    readonly key: string;
    readonly source: string | null;
  } | null>(null);
  const key = `${drawing.id}:${drawing.revision}`;

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    let mounted = true;
    let cancel: (() => void) | undefined;
    let timer: number | undefined;
    const load = () => {
      timer = undefined;
      cancel ??= requestPreview(
        key,
        drawing.id,
        (source) => {
          if (mounted) {
            setPreview({ key, source });
          }
        },
        !thumbnail,
      );
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!cancel && timer === undefined) {
          // Let the selected preview start first, and skip rows scrolled past.
          if (thumbnail) {
            timer = window.setTimeout(load, 120);
          } else {
            load();
          }
        }
      } else {
        window.clearTimeout(timer);
        timer = undefined;
        cancel?.();
        cancel = undefined;
        setPreview(null);
      }
    });
    observer.observe(node);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      observer.disconnect();
      cancel?.();
    };
  }, [drawing.id, key, thumbnail]);

  const source = preview?.key === key ? preview.source : undefined;
  return (
    <span
      ref={container}
      className={`${styles.preview} ${thumbnail ? styles.thumbnail : ""}`}
      aria-hidden={thumbnail || undefined}
    >
      {source ? (
        <img
          src={source}
          alt={thumbnail ? "" : `Preview of ${drawing.name}`}
          draggable={false}
          decoding="async"
        />
      ) : (
        <span>
          {thumbnail
            ? source === null
              ? "—"
              : "…"
            : source === null
            ? "Preview unavailable"
            : "Loading preview…"}
        </span>
      )}
    </span>
  );
};

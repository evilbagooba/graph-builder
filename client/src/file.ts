// Opening and saving a project as a plain file, for when no hub is running.
// Validation (zod, via `tako`) is loaded only when a file is actually
// opened or saved, so it stays out of the first-load bundle.

import type { Project } from "tako/model";

type WritableHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
};
type PickerWindow = Window & {
  showOpenFilePicker?: (opts: {
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<WritableHandle[]>;
};

export type FileHandle = WritableHandle;
export type OpenedFile = { text: string; name: string; handle: FileHandle | null };

/** Open via the system picker where it can hand back a writable handle
 * (Chromium). Null if cancelled; "unsupported" to fall back to an
 * `<input type="file">`. */
export async function pickFile(): Promise<OpenedFile | null | "unsupported"> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (!picker) return "unsupported";
  try {
    const [handle] = await picker({
      types: [{ description: "Project file", accept: { "application/json": [".json"] } }],
    });
    if (!handle) return null;
    const file = await handle.getFile();
    return { text: await file.text(), name: file.name, handle };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    return "unsupported";
  }
}

/** Parse, migrate and validate a document from outside. Throws if it isn't
 * a project this version can read. */
export async function readProject(text: string, fallbackTitle: string): Promise<Project> {
  const { migrateProject } = await import("tako");
  return migrateProject(JSON.parse(text), fallbackTitle);
}

/** The document as written to disk: validated, dangling references dropped. */
export async function serializeProject(project: Project): Promise<string> {
  const { normalizeProject, projectSchema } = await import("tako");
  return JSON.stringify(projectSchema.parse(normalizeProject(project)), null, 2) + "\n";
}

/** Write back to the opened file where the browser allows it; otherwise
 * download. Returns how it was saved, or null if the user cancelled. */
export async function saveFile(
  name: string,
  handle: FileHandle | null,
  text: string,
): Promise<"written" | "downloaded" | null> {
  if (handle) {
    try {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return "written";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

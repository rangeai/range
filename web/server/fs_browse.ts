/**
 * Tiny FS browser used by the "attach repo" picker.
 *
 * Only directories are listed (you can't attach a file). Each entry
 * gets a flag for whether it looks like a git repo so the UI can
 * show a marker. Hidden directories (dot-prefixed) are filtered out.
 */

import { readdir, stat, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, normalize, sep, isAbsolute } from "node:path";

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isGitRepo: boolean;
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

async function quickIsGitRepo(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function listDirectory(rawPath: string | undefined): Promise<FsListResult> {
  const target = !rawPath || rawPath.length === 0 ? homedir() : rawPath;
  if (!isAbsolute(target)) {
    throw new Error("path must be absolute");
  }
  const normalized = normalize(target);

  // Ensure it's actually a dir
  const st = await stat(normalized);
  if (!st.isDirectory()) {
    throw new Error("path is not a directory");
  }

  const names = await readdir(normalized);

  // Filter to non-hidden dirs only
  const filtered = names.filter((n) => !n.startsWith("."));
  filtered.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const entries: FsEntry[] = [];
  for (const name of filtered) {
    const full = join(normalized, name);
    let isDir = false;
    try {
      const s = await stat(full);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const isGit = await quickIsGitRepo(full);
    entries.push({ name, path: full, isDir: true, isGitRepo: isGit });
  }

  const parent =
    normalized === sep || normalized === "/" ? null : normalize(join(normalized, ".."));

  return {
    path: normalized,
    parent: parent === normalized ? null : parent,
    entries,
  };
}

export function homeDir(): string {
  return homedir();
}

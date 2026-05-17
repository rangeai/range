/**
 * NPZ (NumPy compressed-archive) reader. NumPy's binary format is
 * stable and well-documented, but a pure-JS reimplementation is
 * 200+ lines and easy to get wrong on dtype edge cases. Python +
 * NumPy already know how to read these files perfectly, and Range
 * already requires Python on PATH for every sim it integrates with,
 * so we shell out.
 *
 * Output: per-array {shape, dtype, data}. 1D arrays come back as
 * flat number lists; 2D arrays as row-major flat lists with shape
 * preserved. Booleans land as 0/1 numbers (NumPy's bool_ dtype).
 *
 * Downsampling: if a 1D array is longer than `maxPoints`, the
 * server uniformly samples it down. The viewer rarely renders more
 * pixels than that anyway.
 */

import { spawn } from "node:child_process";

export interface NpzField {
  shape: number[];
  dtype: string;
  data: number[];
}

export interface NpzPayload {
  fields: Record<string, NpzField>;
  /** True if any 1D array was downsampled before returning. */
  downsampled: boolean;
  /** Original length of the longest 1D array (pre-downsample). */
  ticks: number;
}

const READER_SCRIPT = `
import json, sys
import numpy as np

path = sys.argv[1]
max_points = int(sys.argv[2])

data = np.load(path, allow_pickle=False)
out = {"fields": {}}
ticks = 0
downsampled = False

for k in data.files:
    arr = data[k]
    shape = list(arr.shape)
    if len(shape) == 0:
        # 0-D scalar — wrap as 1-element list
        out["fields"][k] = {"shape": [1], "dtype": str(arr.dtype), "data": [float(arr)]}
        continue

    # Track the longest 1D series so the client knows the original
    # length even after downsampling.
    if len(shape) == 1:
        ticks = max(ticks, int(shape[0]))

    flat = arr.ravel()
    n = int(flat.shape[0])

    # Downsample only 1D arrays — preserving 2D structure during
    # downsample is not worth the complexity for the viewer use-case.
    if len(shape) == 1 and n > max_points:
        idx = np.linspace(0, n - 1, max_points).astype(np.int64)
        flat = flat[idx]
        shape = [max_points]
        downsampled = True

    if arr.dtype == np.bool_ or arr.dtype.kind == "b":
        as_list = [int(x) for x in flat.tolist()]
    elif arr.dtype.kind in "iu":
        as_list = [int(x) for x in flat.tolist()]
    elif arr.dtype.kind == "f":
        # Replace non-finite values with null so JSON parses cleanly.
        # The viewer will skip None points.
        as_list = []
        for x in flat.tolist():
            if x == x and x != float("inf") and x != float("-inf"):
                as_list.append(float(x))
            else:
                as_list.append(None)
    else:
        # Unsupported dtype — skip with a placeholder.
        as_list = []

    out["fields"][k] = {
        "shape": shape,
        "dtype": str(arr.dtype),
        "data": as_list,
    }

out["ticks"] = ticks
out["downsampled"] = downsampled
print(json.dumps(out))
`;

export function readNpz(
  path: string,
  maxPoints = 2000,
): Promise<NpzPayload> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python3",
      ["-c", READER_SCRIPT, path, String(maxPoints)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `python NPZ reader exited ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as NpzPayload);
      } catch (err) {
        reject(new Error(`failed to parse NPZ reader output: ${err}`));
      }
    });
  });
}

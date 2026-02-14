import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

const DEFAULT_OUTPUT_PATH = "data/users.json";

/**
 * Load existing users from JSON file. Returns { users, path }.
 */
export async function loadUsers(outputPath = DEFAULT_OUTPUT_PATH) {
  try {
    const raw = await readFile(outputPath, "utf-8");
    const data = JSON.parse(raw);
    const users = Array.isArray(data) ? data : data.users ?? [];
    return { users, path: outputPath };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { users: [], path: outputPath };
    }
    throw err;
  }
}

/**
 * Ensure directory for output path exists.
 */
export async function ensureOutputDir(outputPath) {
  const dir = dirname(outputPath);
  await mkdir(dir, { recursive: true });
}

/**
 * Check if a username already exists in the stored users.
 */
export function hasUser(users, username) {
  return users.some((u) => u.username === username);
}

/**
 * Append a user to the list and persist to JSON.
 */
export async function saveUser(user, outputPath, users) {
  const updated = [...users, user];
  await ensureOutputDir(outputPath);
  await writeFile(outputPath, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

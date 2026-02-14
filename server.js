import "dotenv/config";
import express from "express";
import { spawn } from "child_process";
import { loadUsers } from "./lib/storage.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createReadStream } from "fs";
import { access } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_PATH = process.env.OUTPUT_PATH || "data/users.json";

let runInProgress = false;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get("/api/users", async (req, res) => {
  try {
    const { users } = await loadUsers(OUTPUT_PATH);
    const q = (req.query.q || "").toLowerCase().trim();
    const filtered = q
      ? users.filter(
          (u) =>
            (u.username && u.username.toLowerCase().includes(q)) ||
            (u.email && u.email.toLowerCase().includes(q)) ||
            (u.fullName && u.fullName.toLowerCase().includes(q)) ||
            (u.location && String(u.location).toLowerCase().includes(q))
        )
      : users;
    res.json({ users: filtered, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/run", (req, res) => {
  if (runInProgress) {
    res.status(409).json({ error: "A scrape is already running." });
    return;
  }

  const startPage = parseInt(req.body.startPage, 10);
  const endPage = parseInt(req.body.endPage, 10);
  const query = String(req.body.query || "").trim();

  if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(endPage) || endPage < 1) {
    res.status(400).json({ error: "Start page and end page must be positive integers." });
    return;
  }
  if (endPage < startPage) {
    res.status(400).json({ error: "End page must be >= start page." });
    return;
  }
  if (!query) {
    res.status(400).json({ error: "Query is required." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send immediately so the connection is established and not closed as idle
  sendSSE(res, "log", { message: "Scraper started…", source: "stdout" });

  runInProgress = true;
  const args = ["index.js", String(startPage), String(endPage), query];
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Prevent server from closing the connection due to timeout
  req.socket.setTimeout(0);
  res.setTimeout(0);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const onData = (chunk, source) => {
    const lines = chunk.split("\n").filter((s) => s.trim());
    for (const line of lines) sendSSE(res, "log", { message: line, source });
  };

  child.stdout.on("data", (chunk) => onData(chunk, "stdout"));
  child.stderr.on("data", (chunk) => onData(chunk, "stderr"));

  child.on("close", (code, signal) => {
    runInProgress = false;
    sendSSE(res, "done", { code: code ?? 0, signal: signal ?? null });
    res.end();
  });

  child.on("error", (err) => {
    runInProgress = false;
    sendSSE(res, "error", { message: err.message });
    res.end();
  });

  // If client disconnects, don't kill the child – let the scrape finish.
  // User can refresh and download when done.
  req.on("close", () => {
    if (runInProgress && child.exitCode === null) {
      try {
        res.write(`: client disconnected, scrape continues in background\n\n`);
      } catch (_) {}
    }
  });
});

app.get("/api/download", async (req, res) => {
  try {
    await access(OUTPUT_PATH);
    const filename = `github-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    createReadStream(OUTPUT_PATH).pipe(res);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "No data file yet. Run a scrape first." });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`UI: http://localhost:${PORT}`);
});

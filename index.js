import dotenv from "dotenv";
import { createGitHubClient } from "./lib/github.js";
import { loadUsers, saveUser, hasUser } from "./lib/storage.js";

dotenv.config();

const PAGE_SIZE = 20;
const OUTPUT_PATH = process.env.OUTPUT_PATH || "data/users.json";

// Parse CLI: node index.js [startPage] [endPage] [query...]
// - With args: node index.js 1 3 language:python repos:>1  → uses CLI query
// - No args: node index.js  → uses QUERY, START_PAGE, END_PAGE from .env (default 1 1)
const [, , startArg, endArg, ...queryParts] = process.argv;
const queryFromCli = queryParts.join(" ").trim();
const query = queryFromCli || process.env.QUERY || "";

const startPageParsed = parseInt(startArg, 10);
const endPageParsed = parseInt(endArg, 10);
const startPage = !isNaN(startPageParsed) ? startPageParsed : (parseInt(process.env.START_PAGE, 10) || 1);
const endPage = !isNaN(endPageParsed) ? endPageParsed : (parseInt(process.env.END_PAGE, 10) || 1);

if (!query) {
  const msg = "Usage: node index.js <startPage> <endPage> [query]\nExample: node index.js 1 5 language:javascript repos:>1\nOr set QUERY (and optionally START_PAGE, END_PAGE) in .env";
  process.stderr.write(msg + "\n");
  process.exit(1);
}

const rawTokens = process.env.GITHUB_TOKENS || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
const tokens = rawTokens.split(",").map((t) => t.trim()).filter(Boolean);

if (!tokens.length) {
  process.stderr.write("Error: Set GITHUB_TOKENS or GITHUB_PERSONAL_ACCESS_TOKEN in .env\n");
  process.exit(1);
}

const github = createGitHubClient(tokens);

function normalizeEmail(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value[0];
  return null;
}

function buildUserRecord(userDetails, mostStarredRepo, mostForkedRepo, isEmailFromCommit, pageNum) {
  return {
    username: userDetails.username,
    fullName: userDetails.fullName ?? null,
    email: userDetails.email ?? null,
    location: userDetails.location ?? null,
    mostStarredRepo: mostStarredRepo
      ? { name: mostStarredRepo.name, stars: mostStarredRepo.stargazers_count }
      : null,
    mostForkedRepo: mostForkedRepo
      ? { name: mostForkedRepo.name, forks: mostForkedRepo.forks_count }
      : null,
    isEmailFromCommit: isEmailFromCommit,
    query,
    pageNum,
    pageSize: PAGE_SIZE,
    scrapedAt: new Date().toISOString(),
  };
}

async function findEmailFromCommits(username, repos) {
  for (const repo of repos) {
    const email = await github.getCommitAuthorEmail(username, repo.name);
    if (email) return email;
  }
  return null;
}

async function main() {
  const { users, path: outputPath } = await loadUsers(OUTPUT_PATH);
  let currentUsers = users;

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    console.log(`====> Processing page ${pageNum}`);

    const items = await github.searchUsers(query, pageNum, PAGE_SIZE);

    for (const user of items) {
      if (user.type === "Organization") {
        console.log(`Skip organization: ${user.login}`);
        continue;
      }

      if (hasUser(currentUsers, user.login)) {
        console.log(`Already saved: ${user.login}`);
        continue;
      }

      const userDetails = await github.getUserDetails(user.login);
      if (!userDetails) continue;

      const repos = await github.getNonForkRepos(userDetails.username);
      const mostStarredRepo = repos.reduce(
        (max, r) => (r.stargazers_count > (max?.stargazers_count ?? 0) ? r : max),
        null
      );
      const mostForkedRepo = repos.reduce(
        (max, r) => (r.forks_count > (max?.forks_count ?? 0) ? r : max),
        null
      );

      let isEmailFromCommit = false;
      let email = normalizeEmail(userDetails.email);

      if (!email || email.includes("noreply")) {
        console.log(`No public email for ${userDetails.username}, checking commits...`);
        const commitEmail = await findEmailFromCommits(userDetails.username, repos);
        if (commitEmail) {
          email = commitEmail;
          isEmailFromCommit = true;
        }
      }

      if (email && !email.includes("noreply")) {
        const record = buildUserRecord(
          { ...userDetails, email },
          mostStarredRepo,
          mostForkedRepo,
          isEmailFromCommit,
          pageNum
        );
        currentUsers = await saveUser(record, outputPath, currentUsers);
        console.log(`Saved: ${userDetails.username}`);
      } else {
        console.log(`Skipped (no email): ${userDetails.username}`);
      }
    }
  }

  console.log(`Done. Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  if (process.env.DEBUG) process.stderr.write(err.stack + "\n");
  process.exit(1);
});

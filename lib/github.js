import { Octokit } from "@octokit/rest";

const RATE_LIMIT_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const NETWORK_RETRY_DELAY_MS = 5 * 60 * 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a GitHub API client with token rotation and retry logic.
 */
export function createGitHubClient(tokens) {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens].filter(Boolean);
  if (!tokenList.length) {
    throw new Error("At least one GitHub token is required.");
  }

  let currentIndex = 0;

  function getOctokit() {
    return new Octokit({ auth: tokenList[currentIndex] });
  }

  function cycleToken() {
    currentIndex = (currentIndex + 1) % tokenList.length;
  }

  async function withRetry(fn) {
    for (;;) {
      try {
        const result = await fn();
        cycleToken();
        return result;
      } catch (err) {
        const status = err.status ?? err.response?.status;
        const message = err.message ?? String(err);

        if (status === 403 || message.includes("rate limit")) {
          console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
          await delay(RATE_LIMIT_DELAY_MS);
          continue;
        }
        if (message.includes("NetworkError") || message.includes("ECONNRESET") || message.includes("fetch")) {
          console.error("Network error. Waiting 5 minutes before retrying...");
          await delay(NETWORK_RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }
  }

  return {
    async searchUsers(query, pageNum, perPage = 20) {
      try {
        return await withRetry(async () => {
          const octokit = getOctokit();
          const { data } = await octokit.request("GET /search/users", {
            q: query,
            per_page: perPage,
            page: pageNum,
          });
          return data.items;
        });
      } catch (error) {
        console.error("Error searching users:", error.message);
        return [];
      }
    },

    async getUserDetails(username) {
      try {
        return await withRetry(async () => {
          const octokit = getOctokit();
          const { data } = await octokit.users.getByUsername({ username });
          return {
            email: data.email,
            fullName: data.name,
            username: data.login,
            location: data.location,
          };
        });
      } catch (error) {
        console.error(`Error fetching user ${username}:`, error.message);
        return null;
      }
    },

    async getNonForkRepos(username) {
      try {
        return await withRetry(async () => {
          const octokit = getOctokit();
          const { data } = await octokit.repos.listForUser({
            username,
            type: "owner",
            per_page: 100,
          });
          return data.filter((repo) => !repo.fork);
        });
      } catch (error) {
        console.error(`Error fetching repos for ${username}:`, error.message);
        return [];
      }
    },

    async getCommitAuthorEmail(username, repoName, token) {
      try {
        return await withRetry(async () => {
          const octokit = getOctokit();
          const { data } = await octokit.repos.listCommits({
            owner: username,
            repo: repoName,
            author: username,
            per_page: 1,
          });
          if (!data?.length) return null;
          const email = data[0].commit?.author?.email;
          return email && !email.includes("noreply") ? email : null;
        });
      } catch (error) {
        return null;
      }
    },

  };
}

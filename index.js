import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

// Load environment variables from .env file
dotenv.config();

const pageSize = 20;

const [,, start, end, ...queryParts] = process.argv;
const query = queryParts.join(' ');

const startPage = parseInt(start, 10);
const endPage = parseInt(end, 10);

if (isNaN(startPage) || isNaN(endPage) || !query) {
  console.error("Please provide valid start page number, end page number, and query.");
  process.exit(1);
}
// Get the GitHub tokens from the environment variables
const githubTokens = process.env.GITHUB_TOKENS.split(',');

if (!githubTokens.length) {
  console.error("GitHub tokens are not defined. Please set the GITHUB_TOKENS environment variable.");
  process.exit(1);
}

let currentTokenIndex = 0;

function getOctokit() {
  return new Octokit({
    auth: githubTokens[currentTokenIndex]
  });
}

function cycleToken() {
  currentTokenIndex = (currentTokenIndex + 1) % githubTokens.length;
}

async function searchUsers(query, pageNum, perPage = 20) {
  try {
    const octokit = getOctokit();
    const response = await octokit.request('GET /search/users', {
      q: query,
      per_page: perPage,
      page: pageNum
    });
    cycleToken();
    return response.data.items;
  } catch (error) {
    if (error.message.includes('Cannot read properties of undefined') || error.message.includes('NetworkError')) {
      console.error("Network error, waiting for 5 minutes...");
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
      return searchUsers(query, pageNum, perPage); // Retry the request
    }
    if (error.status === 403) {
      console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
      await delay(5 * 60 * 1000); // Wait 5 minutes
    } else {
      // console.error("Error searching users:", error);
      return [];
    }
  }
}

async function getUserDetails(username) {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.users.getByUsername({
      username
    });
    cycleToken();
    return {
      email: data.email,
      fullName: data.name,
      username: data.login,
      location: data.location
    };
  } catch (error) {
    if (error.status === 403) {
      console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
      await delay(5 * 60 * 1000); // Wait 5 minutes
    } else {
      // console.error("Error searching users:", error);
      return [];
    }
  }
}

async function getNonForkRepos(username) {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.listForUser({
      username,
      type: "owner",
      per_page: 100
    });
    cycleToken();
    return data.filter(repo => !repo.fork);
  } catch (error) {
    if (error.status === 403) {
      console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
      await delay(5 * 60 * 1000); // Wait 5 minutes
    } else {
      // console.error("Error searching users:", error);
      return [];
    }
  }
}

async function getUserCommits(username, repo) {
  try {
    const octokit = getOctokit();
    const response = await octokit.repos.listCommits({
      owner: username,
      repo,
      author: username,
      per_page: 1
    });
    cycleToken();
    if (response.status !== 200) {
      throw new Error(`Failed to fetch commits: ${response.statusText}`);
    }
    return response.data;
  } catch (error) {
    if (error.status === 403) {
      console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
      await delay(5 * 60 * 1000); // Wait 5 minutes
    } else {
      // console.error("Error searching users:", error);
      return [];
    }
  }
}

async function getEmailFromCommit(commitUrl) {
  try {
    const response = await fetch(commitUrl);
    const commitData = await response.json();
    const email = commitData.commit.author.email;
    return email;
  } catch (error) {
    if (error.status === 403) {
      console.error("Rate limit exceeded. Waiting 5 minutes before retrying...");
      await delay(5 * 60 * 1000); // Wait 5 minutes
    } else {
      // console.error("Error searching users:", error);
      return [];
    }
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    console.log(`====> Processing Page: ${pageNum}`);

    const users = await searchUsers(query, pageNum, pageSize);

    for (const user of users) {
      if (user.type == "Organization") {
        console.log(`User ${user.login} is Organization. Skipping...`);
        continue;
      }
      const existingUser = await User.findOne({ username: user.login });
      if (existingUser) {
        console.log(`User ${user.login} already exists in the database. Skipping...`);
        continue;
      }
      const userDetails = await getUserDetails(user.login);
      if (!userDetails) continue;

      let mostStarredRepo = null;
      let mostForkedRepo = null;
      const repos = await getNonForkRepos(userDetails.username);
      // Find the repo with the most stars and forks
      mostStarredRepo = repos.reduce((max, repo) => repo.stargazers_count > (max?.stargazers_count || 0) ? repo : max, null);
      mostForkedRepo = repos.reduce((max, repo) => repo.forks_count > (max?.forks_count || 0) ? repo : max, null);

      let isEmailFromCommit = false;
      if (!userDetails.email || typeof userDetails.email != "string") {
        console.log(`No public email for ${userDetails.username}. Fetching repositories...`);

        for (const repo of repos) {
          const commits = await getUserCommits(userDetails.username, repo.name);
          if (commits.length > 0) {
            const commitEmail = await getEmailFromCommit(commits[0].url);
            if (commitEmail) {
              userDetails.email = commitEmail;
              isEmailFromCommit = true;
              break;  // Stop after finding the first email
            }
          }
        }
      }
      if (userDetails.email && typeof userDetails.email == "object" && userDetails.email.length > 0) {
        userDetails.email = userDetails.email[0];
      }
      if (userDetails.email && typeof userDetails.email == "string" && userDetails.email.indexOf("noreply") == -1) {
        const locationMap = {
          location: userDetails.location
        };
  
        const userDoc = new User({
          fullName: userDetails.fullName,
          username: userDetails.username,
          location: locationMap,
          mostStarredRepo: {
            name: mostStarredRepo?.name || null,
            stars: mostStarredRepo?.stargazers_count || 0
          },
          mostForkedRepo: {
            name: mostForkedRepo?.name || null,
            forks: mostForkedRepo?.forks_count || 0
          },
          email: typeof userDetails.email == "string" ? userDetails.email : null,
          isEmailFromCommit: isEmailFromCommit,
          query: query,
          pageSize: pageSize,
          pageNum: pageNum
        });
  
        await userDoc.save();
  
        console.log(`Saved user: ${userDetails.username}`);
      } else {
        console.log(`Unsaved user: ${userDetails.username}, can't find email`);
      }
    }
  }

  mongoose.connection.close();
}

main();

import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';


dotenv.config(); // Load environment variables from .env file

// Replace 'your_personal_access_token' with your actual GitHub personal access token
// const octokit = new Octokit();
const octokit = new Octokit({
  auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
});

const [,, start, end] = process.argv.map(Number);

if (isNaN(start) || isNaN(end)) {
  console.error("Please provide valid start page number and end page numbers.");
  process.exit(1);
}


async function searchUsers(query, pageNum, perPage = 20) {
  try {
    const response = await octokit.request('GET /search/users', {
      q: query,
      per_page: perPage,
      page: pageNum
    });
    return response.data.items;
  } catch (error) {
    console.error("Error searching users:", error);
    return [];
  }
}

async function getUserDetails(username) {
  try {
    const { data } = await octokit.users.getByUsername({
      username
    });
    return {
      email: data.email,
      fullName: data.name,
      username: data.login,
      location: data.location
    };
  } catch (error) {
    console.error("Error fetching user details:", error);
    return null;
  }
}

async function getNonForkRepos(username) {
  try {
    const { data } = await octokit.repos.listForUser({
      username,
      type: "owner",
      per_page: 100
    });
    return data.filter(repo => !repo.fork);
  } catch (error) {
    console.error("Error fetching repositories:", error);
    return [];
  }
}

async function getUserCommits(username, repo) {
  try {
    const response = await octokit.repos.listCommits({
      owner: username,
      repo,
      author: username,
      per_page: 1
    });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch commits: ${response.statusText}`);
    }
    return response.data;
  } catch (error) {
    console.error("Error fetching commits:", error);
    return [];
  }
}

async function getEmailFromCommit(commitUrl) {
  try {
    const response = await fetch(commitUrl);
    const commitData = await response.json();
    const email = commitData.commit.author.email;
    return email;
  } catch (error) {
    console.error("Error fetching commit email:", error);
    return null;
  }
}

async function main() {
  await mongoose.connect('mongodb://localhost:27017/github-contacts', { useNewUrlParser: true, useUnifiedTopology: true });

  const query = 'language:javascript repos:>1 followers:50..100';
    
  for (let pageNum = start; pageNum <= end; pageNum++) {
    console.log(`====> Processing Page: ${pageNum}`);

    const users = await searchUsers(query, pageNum);
    for (const user of users) {
      console.log(`Processing user: ${user.login}`);

      const userDetails = await getUserDetails(user.login);
      if (!userDetails) continue;

      let mostStarredRepo = null;
      let mostForkedRepo = null;
      const repos = await getNonForkRepos(userDetails.username);
      // Find the repo with the most stars and forks
      mostStarredRepo = repos.reduce((max, repo) => repo.stargazers_count > (max?.stargazers_count || 0) ? repo : max, null);
      mostForkedRepo = repos.reduce((max, repo) => repo.forks_count > (max?.forks_count || 0) ? repo : max, null);
      
      let isEmailFromCommit = false;
      if (!userDetails.email) {
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
        email: userDetails.email,
        isEmailFromCommit: isEmailFromCommit,
        query: query
      });

      await userDoc.save();

      console.log(`Saved user: ${userDetails.username}`);
      if (mostStarredRepo) {
        console.log(`Repository with most stars: ${mostStarredRepo.name} (${mostStarredRepo.stargazers_count} stars)`);
      }
      if (mostForkedRepo) {
        console.log(`Repository with most forks: ${mostForkedRepo.name} (${mostForkedRepo.forks_count} forks)`);
      }
    }
  }

  mongoose.connection.close();
}

main();

const fetch = require('node-fetch');

async function checkRateLimit(token) {
  const response = await fetch('https://api.github.com/rate_limit', {
    headers: {
      'Authorization': `token ${token}`
    }
  });

  const data = await response.json();
  console.log(data);
}

const token = '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';
checkRateLimit(token);

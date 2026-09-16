const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Look for API endpoints in the page
const patterns = ['/api', 'api.bossjob', 'bossjob.com/api', 'graphql', '_next/data', 'server', 'search/v', 'job/search', 'gateway', 'v1/', 'v2/'];
for (const p of patterns) {
  const re = new RegExp(p, 'gi');
  const matches = html.match(re);
  if (matches) console.log(p + ' => ' + matches.length + ' matches');
}

// Look specifically for bossjob API base URLs
const apiMatches = html.match(/(https?:\/\/[^\s"']*bossjob[^\s"']*\/api[^\s"']*)/gi);
if (apiMatches) console.log('API URLs:', apiMatches.slice(0, 10).join('\n'));

// Find gtag / next data script with API info
const nextData = html.match(/_next\/data\/[^\s"']+/g);
if (nextData) console.log('Next data:', nextData.slice(0, 5).join('\n'));
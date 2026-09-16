const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Look at the escaped JSON more carefully - find the actual jobs array that contains multiple jobs
const pos = html.indexOf('\\"jobs\\":[');
if (pos !== -1) {
  // Let's look at a larger context around it
  const contextStart = Math.max(0, pos - 200);
  const contextEnd = Math.min(html.length, pos + 5000);
  const context = html.slice(contextStart, contextEnd);
  console.log('Context around jobs:');
  console.log(context);
} else {
  console.log('jobs array not found');
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Look at the escaped JSON more carefully
const pos = html.indexOf('\\"jobs\\":[');
if (pos !== -1) {
  const contentStart = pos + 10;
  let depth = 0, endIdx = -1;
  for (let i = contentStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  const escaped = html.slice(contentStart, endIdx + 1);
  console.log('Escaped length:', escaped.length);
  console.log('Full escaped:', escaped);
} else {
  console.log('jobs array not found');
}
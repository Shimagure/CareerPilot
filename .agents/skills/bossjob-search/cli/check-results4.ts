const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Find ALL occurrences of \"jobs\":[
let positions = [];
let idx = html.indexOf('\\"jobs\\":[');
while (idx !== -1) {
  positions.push(idx);
  idx = html.indexOf('\\"jobs\\":[', idx + 1);
}
console.log('All positions:', positions);

for (const pos of positions) {
  const contentStart = pos + 10;
  let depth = 0, endIdx = -1;
  for (let i = contentStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx !== -1) {
    const escaped = html.slice(contentStart, endIdx + 1);
    const jobCount = (escaped.match(/"job_id"/g) || []).length;
    console.log(`Position ${pos}: length=${escaped.length}, job_id count=${jobCount}`);
    if (jobCount > 1) {
      const titles = escaped.match(/"job_title":"[^"]*"/g);
      if (titles) console.log('  titles:', titles.slice(0, 15).join(', '));
    }
  }
}
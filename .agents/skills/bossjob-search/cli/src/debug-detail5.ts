const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/job/536344';
const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow'
});
const html = await res.text();

// Correct: HTML uses \"job_detail\": (single escaped quote)
const prefix = '\\"job_detail\\":{';
const startIdx = html.indexOf(prefix);
console.log('prefix at:', startIdx);

if (startIdx === -1) process.exit(1);

const contentStart = startIdx + prefix.length - 1;
let depth = 0;
let endIdx = -1;
for (let i = contentStart; i < html.length; i++) {
  const ch = html[i];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
}
if (endIdx === -1) { console.log('no end'); process.exit(1); }

const escaped = html.slice(contentStart, endIdx + 1);
const unescaped = escaped
  .replace(/\\"/g, '"')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\r')
  .replace(/\\t/g, '\t')
  .replace(/\\u0026/g, '&')
  .replace(/\\u003[CD]/g, '');

try {
  const jd = JSON.parse(unescaped);
  console.log('Keys:', Object.keys(jd));
  console.log('job_header:', JSON.stringify(jd.job_header, null, 2));
  console.log('job_description:', JSON.stringify(jd.job_description, null, 2));
} catch (e) {
  console.log('Parse error:', e);
  console.log('Last 500:', unescaped.slice(-500));
}
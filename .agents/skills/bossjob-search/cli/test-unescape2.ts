const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Find ALL occurrences of \"jobs\":[
const pos = html.indexOf('\\"jobs\\":[');
console.log('Found at:', pos);

// Get raw escaped content
const contentStart = pos + 10;  // length of \"jobs\":[
let depth = 0;
let endIdx = -1;
for (let i = contentStart; i < html.length; i++) {
  const ch = html[i];
  if (ch === '[') depth++;
  else if (ch === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
}
const escaped = html.slice(contentStart, endIdx + 1);
console.log('Escaped length:', escaped.length);
console.log('First 500 chars:', JSON.stringify(escaped.slice(0, 500)));
console.log('---');

// Try manual unescape step by step
let unescaped = escaped;
unescaped = unescaped.replace(/\\\\\\"/g, '"');  // Replace \" with "
console.log('After quote unescape:', JSON.stringify(unescaped.slice(0, 500)));
console.log('---');

unescaped = unescaped.replace(/\\\\/g, '\\');  // Replace \\ with \
unescaped = unescaped.replace(/\\n/g, '\n');
unescaped = unescaped.replace(/\\r/g, '\r');
unescaped = unescaped.replace(/\\t/g, '\t');
unescaped = unescaped.replace(/\\u0026/g, '&');
console.log('After all unescapes:', JSON.stringify(unescaped.slice(0, 500)));
console.log('---');

try {
  const jobs = JSON.parse(unescaped);
  console.log('PARSED! Jobs:', jobs.length);
  console.log('First:', jobs[0]?.job_title, '|', jobs[0]?.company?.company_name);
  console.log('All titles:', jobs.slice(0,10).map(j => j.job_title).join(', '));
} catch (e) {
  console.log('Parse error:', e.message);
  // Show context around error
  const errIdx = e.message.match(/position (\d+)/);
  if (errIdx) {
    const pos = parseInt(errIdx[1]);
    console.log('Error context:', JSON.stringify(unescaped.slice(Math.max(0, pos-50), pos+50)));
  }
}
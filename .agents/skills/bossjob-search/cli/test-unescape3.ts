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

// Write raw to file for inspection
import { writeFileSync } from 'fs';
writeFileSync('C:\\temp\\escaped.json', escaped);
console.log('Written to C:\\temp\\escaped.json');

// Let's manually parse it char by char
console.log('First 40 chars raw:', [...escaped.slice(0, 40)].map(c => c + ':' + c.charCodeAt(0)).join(' | '));
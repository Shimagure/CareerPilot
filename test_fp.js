const crypto = require("crypto");

function normalizeUrl(url) {
  try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, "").toLowerCase(); }
  catch { return url.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, ""); }
}
function normalizeCompany(company) { return company.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim(); }
function normalizeTitle(title) { return title.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim(); }
function normalizeLocation(location) { return location.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim(); }
function normalizeArrangement(arrangement) {
  if (!arrangement || !String(arrangement).trim()) return "unknown";
  const arr = String(arrangement).toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  if (arr.includes("remote") || arr.includes("work from home") || arr.includes("wfh")) return "remote";
  if (arr.includes("hybrid")) return "hybrid";
  if (arr.includes("onsite") || arr.includes("on site") || arr.includes("office")) return "onsite";
  return "unknown";
}
function normalizeSalary(salary) {
  if (!salary || salary.trim() === "") return "undisclosed";
  const normalized = salary.toLowerCase().replace(/[^\w\s\.\-]/g, "").replace(/\s+/g, " ").trim();
  const numbers = normalized.match(/\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 2) {
    const min = parseInt(numbers[0], 10); const max = parseInt(numbers[1], 10);
    const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/); const currency = currencyMatch ? currencyMatch[1] : "php";
    return currency + ":" + min + ":" + max;
  } else if (numbers && numbers.length === 1) {
    const min = parseInt(numbers[0], 10); const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/); const currency = currencyMatch ? currencyMatch[1] : "php";
    return currency + ":" + min + ":" + min;
  }
  return "undisclosed";
}
function extractKeyRequirements(description) { if (!description) return ""; return description.substring(0, 2000); }
function buildFingerprintMaterial(job) {
  return {
    title: normalizeTitle(job.title || ""),
    company: normalizeCompany(job.company || ""),
    location: normalizeLocation(job.location || ""),
    arrangement: normalizeArrangement(job.work_mode || job.arrangement || job.workType || ""),
    salary: normalizeSalary(job.salary || job.salary_text || ""),
    description: extractKeyRequirements(job.description || "")
  };
}
function computeFingerprint(material) { return crypto.createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex"); }

// Service Desk Analyst - from consolidated_jobs.json (enriched)
const consolidated = {
  title: "Service Desk Analyst",
  company: "Starshot Software",
  location: "Remote",
  salary: "Up to PHP 57,000 a month",
  salary_text: null,
  work_mode: null,
  description: "Job Description: Summary of the position We are seeking a motivated and customer-focused Service Desk Analyst L1 to join our IT support team. The successful candidate will be responsible for providing first-level technical support to end-users via phone, email, or chat. This role is essential in ensuring timely resolution of IT issues, efficient incident logging, and escalation where necessary to maintain operational efficiency across the organization. Essential Functions: Provide 1st Level Support: Troubleshoot and resolve basic technical issues related to hardware, software, networks, and applications. Incident Management: Log, track, and manage incidents through the service desk system, ensuring accurate documentation of issues and timely follow-up. Escalation: Escalate unresolved incidents to Level 2 or specialized teams in accordance with established guidelines. User Support: Assist users with account access, password resets, and general inquiries in a timely and professional manner. Monitor Systems: Keep track of system performance and escalate potential issues that could impact user experience. Communication: Keep users informed about the status of their incidents and service requests, maintaining a high level of customer service. Knowledge Base: Contribute to the service desk knowledge base by documenting solutions to common issues. Compliance: Ensure adherence to company policies and procedures related to IT security and data privacy. Requirements: Education: High school diploma or equivalent required. IT-related certifications (e.g., CompTIA A+, ITIL Foundation) preferred. Experience: A minimum of 3 year of experience in a service desk or IT support role is required. The candidate should have solid knowledge of Windows OS, the Microsoft Office Suite, and complex networking concepts. Technical Skills: Familiarity with ticketing systems and remote desktop tools is essential. The candidate should have a strong understanding of basic troubleshooting for software, hardware, and network issues, along with exposure to more advanced networking environments (e.g., VPNs, DNS, DHCP, firewalls). Experience with Active Directory, user account management, and incident categorization/prioritization is also preferred. Soft Skills: Excellent verbal and written communication skills. Strong problem-solving abilities and attention to detail. Ability to work in a fast-paced environment and manage multiple tasks simultaneously. Customer-service oriented with a positive, professional attitude. Qualifications: Education: High school diploma or equivalent required. IT-related certifications (e.g., CompTIA A+, ITIL Foundation) preferred. Experience: At least 1 year experience in a service desk or IT support role is required. Knowledge of Windows OS, Microsoft Office Suite, and complex networking concepts. Nice-to-Haves: Certifications: ITIL Foundation certification (to demonstrate understanding of IT Service Management best practices). Cisco Certified Network Associate (CCNA) for basic networking skills. Pay: Up to Php57,000.00 per month Experience: Service Desk Analyst: 3 years (Required) Microsoft 365: 3 years (Required) Active Directory: 3 years (Required) Networking: 3 years (Required) Work Location: Remote"
};

// Fresh detail fetch from Indeed CLI
const freshDetail = {
  id: "0934ca2326b03e16",
  title: "Service Desk Analyst",
  company: "Starshot Software",
  location: null,
  salary: null,
  date: null,
  dateLabel: null,
  teaser: null,
  url: "http://ph.indeed.com/job/service-desk-analyst-0934ca2326b03e16?xpse=SoAX67I2fNtDhlQIrx0LbzkdCdPP&xfps=fd2b5d4a-38ce-4077-9eb3-c955f1e37c20",
  description: "Job Description: Summary of the position We are seeking a motivated and customer-focused Service Desk Analyst L1 to join our IT support team. The successful candidate will be responsible for providing first-level technical support to end-users via phone, email, or chat. This role is essential in ensuring timely resolution of IT issues, efficient incident logging, and escalation where necessary to maintain operational efficiency across the organization. Essential Functions: Provide 1st Level Support: Troubleshoot and resolve basic technical issues related to hardware, software, networks, and applications. Incident Management: Log, track, and manage incidents through the service desk system, ensuring accurate documentation of issues and timely follow-up. Escalation: Escalate unresolved incidents to Level 2 or specialized teams in accordance with established guidelines. User Support: Assist users with account access, password resets, and general inquiries in a timely and professional manner. Monitor Systems: Keep track of system performance and escalate potential issues that could impact user experience. Communication: Keep users informed about the status of their incidents and service requests, maintaining a high level of customer service. Knowledge Base: Contribute to the service desk knowledge base by documenting solutions to common issues. Compliance: Ensure adherence to company policies and procedures related to IT security and data privacy. Requirements: Education: High school diploma or equivalent required. IT-related certifications (e.g., CompTIA A+, ITIL Foundation) preferred. Experience: A minimum of 3 year of experience in a service desk or IT support role is required. The candidate should have solid knowledge of Windows OS, the Microsoft Office Suite, and complex networking concepts. Technical Skills: Familiarity with ticketing systems and remote desktop tools is essential. The candidate should have a strong understanding of basic troubleshooting for software, hardware, and network issues, along with exposure to more advanced networking environments (e.g., VPNs, DNS, DHCP, firewalls). Experience with Active Directory, user account management, and incident categorization/prioritization is also preferred. Soft Skills: Excellent verbal and written communication skills. Strong problem-solving abilities and attention to detail. Ability to work in a fast-paced environment and manage multiple tasks simultaneously. Customer-service oriented with a positive, professional attitude. Qualifications: Education: High school diploma or equivalent required. IT-related certifications (e.g., CompTIA A+, ITIL Foundation) preferred. Experience: At least 1 year experience in a service desk or IT support role is required. Knowledge of Windows OS, Microsoft Office Suite, and complex networking concepts. Nice-to-Haves: Certifications: ITIL Foundation certification (to demonstrate understanding of IT Service Management best practices). Cisco Certified Network Associate (CCNA) for basic networking skills. Pay: Up to Php57,000.00 per month Experience: Service Desk Analyst: 3 years (Required) Microsoft 365: 3 years (Required) Active Directory: 3 years (Required) Networking: 3 years (Required) Work Location: Remote",
  classifications: null,
  workType: null,
  applyUrl: null
};

const fp1 = computeFingerprint(buildFingerprintMaterial(consolidated));
const fp2 = computeFingerprint(buildFingerprintMaterial(freshDetail));

console.log("Consolidated fingerprint:", fp1);
console.log("Fresh detail fingerprint:", fp2);
console.log("Match:", fp1 === fp2);
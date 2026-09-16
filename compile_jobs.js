const d = JSON.parse(await Bun.file('job_scraper/seen_jobs.json').text());
const seen = d.seen || {};
const tracker = await Bun.file('job_search_tracker.csv').text();

const candidates = [
  // JobStreet IT Support (new)
  {portal:'jobstreet',id:'93997696',title:'IT Support - Landers Arca South',company:'Landers',location:'Taguig City, Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93997696'},
  {portal:'jobstreet',id:'93986600',title:'IT Technical Support',company:'Harbest Agribusiness Corporation',location:'Pasig City, Metro Manila',salary:'₱20,000 – ₱22,000 per month',date:'2026-08-14',url:'https://ph.jobstreet.com/job/93986600'},
  {portal:'jobstreet',id:'93990256',title:'IT Support Analyst I',company:'Satellite Office',location:'Ortigas, Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93990256'},
  {portal:'jobstreet',id:'93832336',title:'IT Support Associate (L1)',company:'TRANSCOSMOS ASIA PHILIPPINES, INC.',location:'Taguig City, Metro Manila',salary:'₱30,000 – ₱35,000 per month',date:'2026-08-12',url:'https://ph.jobstreet.com/job/93832336'},
  {portal:'jobstreet',id:'93956197',title:'IT Technical Support (Rotating Schedule | Onsite)',company:'KMC Solutions',location:'Makati City, Metro Manila',salary:null,date:'2026-08-13',url:'https://ph.jobstreet.com/job/93956197'},
  {portal:'jobstreet',id:'93959933',title:'IT Helpdesk (Perm WFH/Morning Shift)',company:'HGS Offshore Staffing Solutions',location:'Metro Manila',salary:'₱40,000 – ₱60,000 per month',date:'2026-08-13',url:'https://ph.jobstreet.com/job/93959933'},
  {portal:'jobstreet',id:'93970935',title:'IT TECHNICAL SUPPORT',company:'New Golden City Builders and Development Corp.',location:'Ibayo-Tipas, Metro Manila',salary:'₱23,000 – ₱28,000 per month',date:'2026-08-14',url:'https://ph.jobstreet.com/job/93970935'},
  {portal:'jobstreet',id:'93994171',title:'IT Service Desk Analyst L1 (AU Offshoring, Hybrid)',company:'ConnectOS',location:'Mandaluyong City, Metro Manila',salary:null,date:null,url:'https://ph.jobstreet.com/job/93994171'},
  {portal:'jobstreet',id:'93960527',title:'IT Specialist',company:'Private Advertiser',location:'Makati City, Metro Manila',salary:'₱25,000 – ₱30,000 per month',date:'2026-08-13',url:'https://ph.jobstreet.com/job/93960527'},
  {portal:'jobstreet',id:'93966411',title:'End User Support',company:'De Castro Consulting',location:'Makati City, Metro Manila',salary:'₱50,000 – ₱60,000 per month',date:'2026-08-14',url:'https://ph.jobstreet.com/job/93966411'},
  {portal:'jobstreet',id:'93997824',title:'IT Helpdesk Specialist',company:'Remote Raven',location:'Philippines',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93997824'},
  {portal:'jobstreet',id:'93942430',title:'IT Specialist I',company:'The Orchard Golf and Country Club',location:'Dasmarinas City, Cavite',salary:null,date:'2026-08-13',url:'https://ph.jobstreet.com/job/93942430'},

  // JobStreet Service Desk (new)
  {portal:'jobstreet',id:'93991621',title:'L2 Service Desk Analyst',company:'HCL Technologies Philippines Inc',location:'Taguig City, Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93991621'},
  {portal:'jobstreet',id:'93966582',title:'Remote | Service Desk Technician (MS365, Active Directory)',company:'KMC Solutions',location:'Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93966582'},
  {portal:'jobstreet',id:'93926449',title:'IT Service Desk / Technical Support Specialist (Tues - Sat | Day Shift | Remote)',company:'Sysgen RPO, Inc.',location:'Makati City, Metro Manila',salary:null,date:'2026-08-12',url:'https://ph.jobstreet.com/job/93926449'},
  {portal:'jobstreet',id:'93991655',title:'Service Desk Engineer (Database and Infrastructure)',company:'Hexagon Shared Services Inc',location:'Quezon City, Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93991655'},
  {portal:'jobstreet',id:'93981776',title:'HYBRID Set Up: Service Desk / Technical Support / IT Support',company:'HCL Technologies Philippines Inc',location:'Greenhills, Metro Manila',salary:null,date:'2026-08-14',url:'https://ph.jobstreet.com/job/93981776'},
  {portal:'jobstreet',id:'93987041',title:'IT Service Desk | Pioneer Account | September 1 Start',company:'Nezda Technologies, Inc.',location:'Taguig City, Metro Manila',salary:'₱28,000 – ₱32,000 per month',date:'2026-08-14',url:'https://ph.jobstreet.com/job/93987041'},
  {portal:'jobstreet',id:'93962083',title:'Service Desk Analyst',company:'Nezda Technologies, Inc.',location:'Metro Manila',salary:null,date:'2026-08-13',url:'https://ph.jobstreet.com/job/93962083'},
  {portal:'jobstreet',id:'93994174',title:'Service Desk Analyst | 3-month Contract (AU Offshoring, Hybrid)',company:'ConnectOS',location:'Mandaluyong City, Metro Manila',salary:null,date:null,url:'https://ph.jobstreet.com/job/93994174'},
  {portal:'jobstreet',id:'93926991',title:'L2 Helpdesk Technician | Alabang | Morning Shift',company:'Platserv PH',location:'Alabang, Metro Manila',salary:'₱50,000 – ₱55,000 per month',date:'2026-08-12',url:'https://ph.jobstreet.com/job/93926991'},
  {portal:'jobstreet',id:'93907908',title:'Level 2 Helpdesk Support | HYBRID (A-OH)',company:'Sourcefit Philippines, Inc.',location:'Eastwood, Metro Manila',salary:null,date:'2026-08-11',url:'https://ph.jobstreet.com/job/93907908'},
  {portal:'jobstreet',id:'93905896',title:'Service Desk Engineer (Start ASAP)',company:'IT by Design Philippines Inc.',location:'Taguig City, Metro Manila',salary:'₱38,000 – ₱45,000 per month',date:'2026-08-11',url:'https://ph.jobstreet.com/job/93905896'},

  // Indeed IT Support
  {portal:'indeed',id:'c4d31c338f6cfbde',title:'Technical Support Associate',company:'SolarWinds',location:'Hybrid work in Taguig',salary:'From PHP 45,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=c4d31c338f6cfbde'},
  {portal:'indeed',id:'a23edaf2ad6117ac',title:'IT Technical Support Assistant - Project Based',company:'Vogue Concepts Inc.',location:'Makati',salary:'PHP 20,000 - PHP 21,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=a23edaf2ad6117ac'},
  {portal:'indeed',id:'4285e1bd0b787475',title:'Technical Support Specialist - Alabang Satellite Office',company:'Barcotech Philippines, Inc.',location:'Alabang',salary:null,date:null,url:'https://ph.indeed.com/viewjob?jk=4285e1bd0b787475'},
  {portal:'indeed',id:'0a155a39cd0d7480',title:'Technical Support (Hybrid)',company:'Kingsoft Dynamics Technologies OPC',location:'Hybrid work in Taguig',salary:'PHP 20,000 - PHP 22,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=0a155a39cd0d7480'},
  {portal:'indeed',id:'0961e55cfbc45f12',title:'Technical Support Representative',company:'Ancar Motors',location:'Quezon City',salary:'PHP 23,000 - PHP 25,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=0961e55cfbc45f12'},
  {portal:'indeed',id:'862dd082f8fd3635',title:'Technical Support Representative',company:'Outworks Pty Ltd',location:'Remote in Pasig',salary:'PHP 30,000 - PHP 35,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=862dd082f8fd3635'},
  {portal:'indeed',id:'123b5547f299cea8',title:'L1 Technical Support Representative - Work from Home / Dayshift',company:'Twoconnect',location:'Remote in National Capital Region',salary:null,date:null,url:'https://ph.indeed.com/viewjob?jk=123b5547f299cea8'},
  {portal:'indeed',id:'bebc71c436c7ed8a',title:'Service Desk Support',company:'Support Services Group Philippines',location:'Remote in Pasig',salary:'PHP 22,000 - PHP 32,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=bebc71c436c7ed8a'},
  {portal:'indeed',id:'f0b48e0316adf887',title:'IT Technical Support',company:'Advanced Security and Detection Systems, Inc.',location:'Parañaque',salary:'PHP 20,000 - PHP 25,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=f0b48e0316adf887'},
  {portal:'indeed',id:'0e328b90e2c54ae1',title:'Desktop Support Technician - PH (VC)',company:'Bill Gosling Outsourcing',location:'Taguig',salary:null,date:null,url:'https://ph.indeed.com/viewjob?jk=0e328b90e2c54ae1'},
  {portal:'indeed',id:'a1bbc00b47bcd326',title:'IT Technical Support Specialist',company:'Citadel Pacific Ltd.- ROHQ',location:'Taguig',salary:'PHP 36,000 - PHP 42,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=a1bbc00b47bcd326'},
  {portal:'indeed',id:'048e2a1d7784998b',title:'Technical Support Engineer',company:'NIU PROFFESIONALS INC.',location:'Pasig',salary:'PHP 30,000 - PHP 40,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=048e2a1d7784998b'},
  {portal:'indeed',id:'689ec3ce53935330',title:'Technical Support',company:'ACCPRO INTERNATIONAL',location:'Pasay',salary:'PHP 25,000 - PHP 30,000 a month',date:null,url:'https://ph.indeed.com/viewjob?jk=689ec3ce53935330'},

  // Kalibrr IT Support
  {portal:'kalibrr',id:'271054',title:'IT Support & Operations',company:'BetaBrands Corp',location:'Pasig, Metro Manila, Philippines',salary:null,date:'2026-08-11',url:'https://www.kalibrr.com/c/betabrands-corp/jobs/271054/it-support-operations'},
  {portal:'kalibrr',id:'270700',title:'Customer Support Representative',company:'Unicapital Group',location:'Makati, Metro Manila, Philippines',salary:null,date:'2026-08-03',url:'https://www.kalibrr.com/c/unicapital-incorporated/jobs/270700/customer-support-representative'},
  {portal:'kalibrr',id:'271228',title:'Junior IT Operations Engineer',company:'ITVT Philippines Inc.',location:'Pasig, Metro Manila, Philippines',salary:null,date:'2026-08-14',url:'https://www.kalibrr.com/c/it-vision-technology-gmbh/jobs/271228/junior-it-operations-engineer'},

  // Kalibrr Service Desk
  {portal:'kalibrr',id:'271164',title:'Service Team Manager [Remote WFH]',company:'Thumbtack Philippines',location:'Makati, Metro Manila, Philippines',salary:null,date:'2026-08-13',url:'https://www.kalibrr.com/c/thumbtack-ph/jobs/271164/service-team-manager-remote-wfh'},
  {portal:'kalibrr',id:'270491',title:'Customer Service Representative | Onsite Ortigas',company:'Satellite Office',location:'Pasig, Metro Manila, Philippines',salary:'PHP30000 - PHP35000 / month',date:'2026-08-10',url:'https://www.kalibrr.com/c/satellite-office-solutions-pty-ltd/jobs/270491/customer-service-representative-onsite-ortigas'},

  // Kalibrr SysAdmin
  {portal:'kalibrr',id:'271106',title:'System Analyst',company:'Multisys Technologies Corporation',location:'Parañaque, Metro Manila, Philippines',salary:null,date:'2026-08-12',url:'https://www.kalibrr.com/c/multisys-technologies-corporation/jobs/271106/system-analyst-4'},

  // LinkedIn IT Support
  {portal:'linkedin',id:'4453277722',title:'IT specialist for Wellspring',company:'Betabrands Corporation',location:'Mandaluyong, National Capital Region, Philippines',date:'2026-08-14',url:'https://www.linkedin.com/jobs/view/4453277722'},
  {portal:'linkedin',id:'4453532827',title:'IT Services Specialist',company:'Genesys',location:'Manila, National Capital Region, Philippines',date:'2026-08-14',url:'https://ph.linkedin.com/jobs/view/it-services-specialist-at-genesys-4453532827'},
  {portal:'linkedin',id:'4452366299',title:'IT Support',company:'Zachry Philippines, Inc.',location:'Pasig, National Capital Region, Philippines',date:'2026-08-12',url:'https://www.linkedin.com/jobs/view/4452366299'},
  {portal:'linkedin',id:'4453125450',title:'IT Support Specialist',company:'Michael Page',location:'Makati, National Capital Region, Philippines',date:'2026-08-15',url:'https://ph.linkedin.com/jobs/view/it-support-specialist-at-michael-page-4453125450'},
  {portal:'linkedin',id:'4452483732',title:'Specialist IT Administration',company:'Jet Aviation',location:'Makati, National Capital Region, Philippines',date:'2026-08-11',url:'https://ph.linkedin.com/jobs/view/specialist-it-administration-at-jet-aviation-4452483732'},

  // LinkedIn Service Desk
  {portal:'linkedin',id:'4454314357',title:'Service Desk Analyst (AU Retail, Office-based)',company:'ConnectOS',location:'Mandaluyong, National Capital Region, Philippines',date:'2026-08-13',url:'https://ph.linkedin.com/jobs/view/service-desk-analyst-au-retail-office-based-at-connectos-4454314357'},

  // LinkedIn EUC
  {portal:'linkedin',id:'4404785641',title:'M365 Admin',company:'Xerox Philippines',location:'Cebu, Central Visayas, Philippines',date:'2026-08-08',url:'https://ph.linkedin.com/jobs/view/m365-admin-at-xerox-philippines-4404785641'},
];

const isSeen = (job) => {
  for(const [k,v] of Object.entries(seen)){
    if(k.includes(job.id) || (v.url||'').includes(job.id)) return true;
    if(v.url === job.url) return true;
    if(v.company === job.company && v.title === job.title) return true;
  }
  return false;
};

const inTracker = (job) => {
  const cl = job.company.toLowerCase();
  const tl = job.title.toLowerCase();
  for(const line of tracker.split('\n')){
    if(line.toLowerCase().includes(cl) && line.toLowerCase().includes(tl)) return true;
  }
  return false;
};

console.log('=== NEW CANDIDATES (not in seen_jobs or tracker) ===\n');
const newJobs = [];
for(const job of candidates){
  if(!isSeen(job) && !inTracker(job)){
    newJobs.push(job);
    console.log(`[${job.portal}] ${job.title} | ${job.company} | ${job.location} | ${job.salary||'N/A'} | ${job.url}`);
  }
}
console.log(`\nTotal new: ${newJobs.length}`);
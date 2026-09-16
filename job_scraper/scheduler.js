#!/usr/bin/env node
// CareerPilot Schedule Registry & CLI
// Manages schedule definitions for Claude Code CronCreate integration.
//
// IMPORTANT: CronCreate is a Claude Code session tool, NOT a Node.js API.
// This script is the persistent schedule registry and management CLI.
// Claude Code reads the output of this script to set up actual CronCreate jobs.
//
// CronCreate jobs are session-scoped (7-day auto-expiry).
// This registry persists across sessions; CronCreate jobs do not.

const fs = require('fs');
const path = require('path');

const SCHEDULES_FILE = process.env.SCHEDULER_FILE || path.join(__dirname, 'schedules.json');

// ============================================================
// CONFIGURATION LOADING
// ============================================================

function loadConfig() {
  try {
    const data = fs.readFileSync(SCHEDULES_FILE, 'utf8');
    const config = JSON.parse(data);
    if (!config.schedules || typeof config.schedules !== 'object') {
      throw new Error('Invalid schedules.json: missing or malformed "schedules" field');
    }
    return config;
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`Schedule file not found: ${SCHEDULES_FILE}`);
    }
    throw e;
  }
}

function saveConfig(config) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(config, null, 2) + '\n');
}

function getScheduleNames(config) {
  return Object.keys(config.schedules);
}

function getSchedule(config, name) {
  if (!config.schedules[name]) {
    return null;
  }
  return config.schedules[name];
}

function validateSchedule(schedule, name) {
  const required = ['name', 'cron', 'recurring', 'enabled', 'description', 'prompt'];
  for (const field of required) {
    if (typeof schedule[field] === 'undefined' || schedule[field] === null) {
      throw new Error(`Invalid schedule "${name}": missing required field "${field}"`);
    }
  }
}

// ============================================================
// CLI COMMANDS
// ============================================================

function cmdList(config) {
  const names = getScheduleNames(config);
  console.log('SCHEDULES');
  console.log('  Name              Cron              Enabled  Description');
  console.log('  ─────────────────  ────────────────  ───────  ──────────────────────────────');
  for (const name of names) {
    const s = config.schedules[name];
    const enabled = s.enabled ? 'yes' : 'no';
    console.log(`  ${name.padEnd(18)} ${s.cron.padEnd(16)} ${enabled.padEnd(8)} ${s.description}`);
  }
  const enabledCount = names.filter(n => config.schedules[n].enabled).length;
  console.log('');
  console.log(`Active: ${enabledCount} | Disabled: ${names.length - enabledCount}`);
  console.log('NOTE: CronCreate jobs are session-scoped (7-day expiry).');
  console.log('      Use "scheduler.js prompts" to set up CronCreate at session start.');
}

function cmdGet(config, name) {
  const schedule = getSchedule(config, name);
  if (!schedule) {
    console.error(`Error: schedule "${name}" not found. Available: ${getScheduleNames(config).join(', ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify(schedule, null, 2));
}

function cmdEnable(config, name) {
  if (!config.schedules[name]) {
    console.error(`Error: schedule "${name}" not found. Available: ${getScheduleNames(config).join(', ')}`);
    process.exit(1);
  }
  config.schedules[name].enabled = true;
  saveConfig(config);
  console.log(`Enabled: ${name}`);
}

function cmdDisable(config, name) {
  if (!config.schedules[name]) {
    console.error(`Error: schedule "${name}" not found. Available: ${getScheduleNames(config).join(', ')}`);
    process.exit(1);
  }
  config.schedules[name].enabled = false;
  saveConfig(config);
  console.log(`Disabled: ${name}`);
}

function cmdPrompts(config) {
  const enabled = Object.values(config.schedules).filter(s => s.enabled);
  if (enabled.length === 0) {
    console.log('[]');
    return;
  }
  const output = enabled.map(s => ({
    name: s.name,
    cron: s.cron,
    recurring: s.recurring,
    prompt: s.prompt
  }));
  console.log(JSON.stringify(output, null, 2));
}

function cmdHelp() {
  console.log(`
Usage: node job_scraper/scheduler.js <command> [name]

Commands:
  list              List all defined schedules with status
  get <name>        Show details of a specific schedule
  enable <name>     Enable a schedule (persists to schedules.json)
  disable <name>    Disable a schedule (persists to schedules.json)
  prompts           Output enabled schedules as CronCreate-ready JSON
  --help, -h        Show this help

NOTE: CronCreate is a Claude Code session tool, not a Node.js API.
This script manages the schedule registry. Claude Code uses the
"prompts" output to set up actual CronCreate jobs at session start.
`);
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    cmdHelp();
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Error loading schedules: ${e.message}`);
    process.exit(1);
  }

  switch (command) {
    case 'list':
      cmdList(config);
      break;
    case 'get':
      if (!args[1]) {
        console.error('Error: schedule name required. Usage: scheduler.js get <name>');
        process.exit(1);
      }
      cmdGet(config, args[1]);
      break;
    case 'enable':
      if (!args[1]) {
        console.error('Error: schedule name required. Usage: scheduler.js enable <name>');
        process.exit(1);
      }
      cmdEnable(config, args[1]);
      break;
    case 'disable':
      if (!args[1]) {
        console.error('Error: schedule name required. Usage: scheduler.js disable <name>');
        process.exit(1);
      }
      cmdDisable(config, args[1]);
      break;
    case 'prompts':
      cmdPrompts(config);
      break;
    default:
      console.error(`Error: unknown command "${command}". Use --help for available commands.`);
      process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  getScheduleNames,
  getSchedule,
  validateSchedule,
  SCHEDULES_FILE
};

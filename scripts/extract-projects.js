// extract-projects.js
// Pulls all items from the Monday.com "Projects" board (Dubai Projects workspace)
// and writes:
//   - projects-data.js       (window.GLC_PROJECTS = [...records])   — full current snapshot, overwritten each run
//   - pipeline-history.js    (window.GLC_PIPELINE_HISTORY = [...])  — one row appended/updated per week, kept across runs
//
// Mirrors extract.js's approach: run via `node scripts/extract-projects.js` from
// the weekly-sync.yml workflow, with MONDAY_API_KEY available as an env var.
// pipeline-history.js must be committed each run (like data.js) for the week-by-week
// trend to actually accumulate — it reads its own prior output back in as a starting
// point, so history survives across weekly syncs as long as the file stays in the repo.

import fs from 'fs';

const BOARD_ID = 2062082517; // "Projects" board, Dubai Projects workspace
const API_URL = 'https://api.monday.com/v2';

// "Pipeline" excludes closed-out items (Won or Lost) — it's the open/active book of work.
const CLOSED_STATUSES = ['100%', 'Lost'];

// Groups that represent paused or not-yet-briefed leads — excluded from the
// "lead received -> proposal sent" timing metric on the dashboard, since a lead
// sitting untouched in one of these groups isn't a fair measure of response speed.
// (Not used in this script directly — the dashboard applies this filter client-side
// against the `group` field on each record — listed here for reference/consistency.)
// const LEAD_TIME_EXCLUDE_GROUPS = ['New Leads - Awaiting Brief', 'On Hold'];

const COLUMN_IDS = [
  'text_mkv1rm12',   // Client Name
  'text_mkv2wa0k',   // Location
  'text_mm63tt11',   // Building
  'color_mkv2wbac',  // Project Type
  'color_mkvdfp5',   // Type (Villa / Apartment / Commercial / ...)
  'status',          // Status: 0% / 25% / 50% / 75% / 100% / Lost
  'peopleimy12iev',  // Sales Lead
  'numeric_mkv28gp7',   // No. of Units
  'numeric_mkv1veyr',   // Value (AED) ex. VAT
  'formula_mkv56f19',   // Weighted Pipeline Value (Value x status%)
  'date_mkw3jeyt',   // Quote Submission Date
  'date_mkwbcsc3',   // Confirmed Date
  'date_mkv88nfg',   // Install Start Date
  'date_mkvfap78',   // Completion Date
];

async function fetchAllItems() {
  const items = [];
  let cursor = null;

  do {
    const query = `
      query ($boardId: [ID!], $cursor: String) {
        boards(ids: $boardId) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              created_at
              group { title }
              column_values(ids: ${JSON.stringify(COLUMN_IDS)}) {
                id
                text
                value
              }
            }
          }
        }
      }`;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_KEY,
        'API-Version': '2024-10',
      },
      body: JSON.stringify({ query, variables: { boardId: [String(BOARD_ID)], cursor } }),
    });

    const json = await res.json();
    if (json.errors) throw new Error('Monday API error: ' + JSON.stringify(json.errors));

    const page = json.data.boards[0].items_page;
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);

  return items;
}

function colText(item, id) {
  const cv = item.column_values.find(c => c.id === id);
  return cv ? cv.text || null : null;
}
function colNum(item, id) {
  const t = colText(item, id);
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function colDate(item, id) {
  const t = colText(item, id);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

// Monday of the current week, UTC — matches the anchoring convention used by
// the sales-meetings dashboard (TRACK_TO_WEEK), so both boards' weeks line up.
function mondayOfThisWeek() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

function loadExistingHistory() {
  try {
    const raw = fs.readFileSync('pipeline-history.js', 'utf8');
    const match = raw.match(/window\.GLC_PIPELINE_HISTORY\s*=\s*(\[[\s\S]*?\]);/);
    if (match) return JSON.parse(match[1]);
  } catch (e) {
    // file doesn't exist yet on the very first run — that's fine, start fresh
  }
  return [];
}

async function main() {
  const items = await fetchAllItems();

  const records = items.map(it => ({
    id: it.id,
    name: it.name,
    client: colText(it, 'text_mkv1rm12'),
    location: colText(it, 'text_mkv2wa0k'),
    building: colText(it, 'text_mm63tt11'),
    projectType: colText(it, 'color_mkv2wbac'),
    type: colText(it, 'color_mkvdfp5'),
    status: colText(it, 'status'),
    group: it.group ? it.group.title : null,
    salesLead: colText(it, 'peopleimy12iev'),
    units: colNum(it, 'numeric_mkv28gp7'),
    valueAED: colNum(it, 'numeric_mkv1veyr'),
    weightedValueAED: colNum(it, 'formula_mkv56f19'),
    quoteDate: colDate(it, 'date_mkw3jeyt'),
    confirmedDate: colDate(it, 'date_mkwbcsc3'),
    installDate: colDate(it, 'date_mkv88nfg'),
    completionDate: colDate(it, 'date_mkvfap78'),
    createdAt: it.created_at.slice(0, 10),
  }));

  fs.writeFileSync('projects-data.js', 'window.GLC_PROJECTS = ' + JSON.stringify(records) + ';\n');
  console.log(`Wrote ${records.length} project records to projects-data.js`);

  // --- pipeline value history (accumulates one row per week) ---
  const active = records.filter(r => !CLOSED_STATUSES.includes(r.status));
  const pipelineValue = active.reduce((sum, r) => sum + (r.valueAED || 0), 0);
  const weightedValue = active.reduce((sum, r) => sum + (r.weightedValueAED || 0), 0);
  const week = mondayOfThisWeek();

  const history = loadExistingHistory();
  const existingIdx = history.findIndex(h => h.week === week);
  const entry = { week, pipelineValue: Math.round(pipelineValue), weightedValue: Math.round(weightedValue) };
  if (existingIdx >= 0) history[existingIdx] = entry; // re-running the same week overwrites, doesn't duplicate
  else history.push(entry);
  history.sort((a, b) => a.week.localeCompare(b.week));

  fs.writeFileSync('pipeline-history.js', 'window.GLC_PIPELINE_HISTORY = ' + JSON.stringify(history) + ';\n');
  console.log(`Pipeline history now has ${history.length} week(s); this week: AED ${entry.pipelineValue.toLocaleString()} pipeline / AED ${entry.weightedValue.toLocaleString()} weighted`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

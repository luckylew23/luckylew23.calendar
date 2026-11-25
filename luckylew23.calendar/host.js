/**
 * Calendar — the folder's daily notes as a month, the way Obsidian's
 * Calendar plugin draws them: a dot for every N words written, a hollow dot
 * while tasks on that day are still open, a column of week numbers that open
 * the week's note.
 *
 * Where the notes live, how they are named and which template makes them is
 * read from the folder's own conventions (`files.conventions`), which already
 * resolves an Obsidian vault's Daily notes / Periodic notes settings — this
 * plugin keeps no folder of its own. Only the drawing preferences (week
 * start, words per dot, ...) are its own settings.
 */
"use strict";

const SIDEBAR = "luckylew23.calendar.sidebar";
const VIEW = "luckylew23.calendar.view";
const COMMAND = "luckylew23.calendar";

const DEFAULT_DAILY = { folder: "", format: "YYYY-MM-DD" };
const DEFAULT_WEEKLY = { format: "gggg-[W]ww" };
const EMPTY_TEMPLATE = "# {{date}}\n\n";

/** Where a period's notes are, as this plugin works with them: paths under
 *  `root`, "/"-separated, taken from the folder's conventions. */
let ctx = null;
const panels = new Set();
const words = new Map(); // note path -> { ms, words }
let dates = null; // ["YYYY-MM-DD", ...] of the daily notes, null when stale
let cached = null; // the `where` those dates were read with
let index = null; // { root, at, days } the folder's notes by the day they changed
let busy = false;
let again = false;
let timer = null;
let pendingReveal = null;

const t = (key, ...args) => textus.l10n.t(key, ...args);

/* ---------------------------------------------------------------- paths */

const slash = (path) => String(path).replace(/\\/g, "/");
const trim = (path) => String(path).replace(/[\\/]+$/, "");
const nameOf = (rel) => String(rel).split("/").pop().replace(/\.md$/i, "");
const windows = (root) => /^[A-Za-z]:/.test(root) || (root.includes("\\") && !root.includes("/"));

/** Absolute path of a folder-relative one. */
function abs(root, rel) {
  const base = trim(root);
  if (!rel) return base;
  return windows(root) ? base + "\\" + rel.replace(/\//g, "\\") : base + "/" + rel;
}

/** Folder-relative path, "/"-separated; null when the path is outside. */
function relOf(root, path) {
  if (!root || !path) return null;
  const base = slash(trim(root));
  const whole = slash(path);
  if (whole === base) return "";
  return whole.startsWith(base + "/") ? whole.slice(base.length + 1) : null;
}

/* --------------------------------------------------------- conventions */

function pick(conventions, key) {
  if (!conventions) return null;
  const setting = conventions[key];
  if (setting && setting.value) return setting.value;
  const found = conventions.detected && conventions.detected[key];
  return found && found.value ? found.value : null;
}

/** A folder's place in the open folder: a full path is cut down to it, one
 *  already written relative is kept, and an absolute path outside is dropped. */
function folderRel(root, folder) {
  const text = trim(slash(String(folder || "")));
  if (!text) return "";
  const inside = relOf(root, text);
  if (inside != null) return inside;
  return /^[A-Za-z]:|^\//.test(text) ? "" : text.replace(/^\.\//, "");
}

function notes(root, value) {
  const template = value && value.template ? slash(String(value.template)) : "";
  return {
    root: root,
    rel: folderRel(root, value && value.folder),
    format: (value && value.format) || DEFAULT_DAILY.format,
    template: template ? folderRel(root, template) || null : null,
  };
}

/** The daily or weekly notes of the open folder, or null when it has none
 *  (no folder open, or weekly notes not set up). */
async function where(period) {
  const root = await textus.files.root();
  if (!root) return null;
  let conventions = null;
  try {
    conventions = await textus.files.conventions(root);
  } catch (error) {
    conventions = null;
  }
  const setting = pick(conventions, period);
  if (setting) return notes(root, setting);
  if (period === "daily") return notes(root, DEFAULT_DAILY);
  return null;
}

/* --------------------------------------------------------------- dates */

function dayOf(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function span(from, to) {
  const out = [];
  const last = dayOf(to);
  for (let day = dayOf(from); day <= last; day.setDate(day.getDate() + 1)) {
    out.push(textus.dates.format(day, "YYYY-MM-DD"));
  }
  return out;
}

/** The note of a day (or week, since the format names it). */
function noteFor(spot, date) {
  const name = textus.dates.format(dayOf(date), spot.format);
  const rel = spot.rel ? spot.rel + "/" + name + ".md" : name + ".md";
  return { path: abs(spot.root, rel), rel: rel };
}

/** The day a note stands for, from its name; null for any other note. */
function dateAt(spot, path) {
  const inside = relOf(spot.root, path);
  if (inside == null) return null;
  const prefix = spot.rel ? spot.rel + "/" : "";
  if (prefix && !inside.startsWith(prefix)) return null;
  const name = inside.slice(prefix.length);
  if (name.includes("/") || !/\.md$/i.test(name)) return null;
  return textus.dates.parse(name.slice(0, -3), spot.format);
}

/** The daily notes the folder has. Both globs: a vault keeping its notes at
 *  the top has no folder to walk into, one keeping them in `Daily/` may or
 *  may not have the folder between. */
async function noteDates(spot) {
  const globs = spot.rel ? [spot.rel + "/*.md", spot.rel + "/**/*.md"] : ["*.md"];
  const found = new Map();
  for (const glob of globs) {
    let files = [];
    try {
      files = await textus.files.find(glob);
    } catch (error) {
      files = [];
    }
    for (const file of files) found.set(file.path, file);
  }
  const out = [];
  for (const path of found.keys()) {
    const date = dateAt(spot, path);
    if (date) out.push(date);
  }
  return out.sort();
}

/** The week number a weekly note's name carries, "W" or "w". */
function weekToken(format) {
  const bare = String(format || "").replace(/\[[^\]]*\]/g, "");
  return /[WGw]/.test(bare) ? "W" : "w";
}

/* --------------------------------------------------------------- words */

/** Words in a note's text: a CJK character counts as one, everything else
 *  split on spaces. Frontmatter is left out. */
function countWords(text) {
  const body = String(text || "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
  const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
  const marks = body.match(cjk);
  let count = marks ? marks.length : 0;
  for (const word of body.replace(cjk, " ").split(/\s+/)) {
    if (/[0-9A-Za-z\u00c0-\u024f]/.test(word)) count++;
  }
  return count;
}

/** The words written on a day, cached until the note changes on disk. */
async function wordsAt(spot, date) {
  const note = noteFor(spot, date);
  const info = await textus.files.stat(note.path);
  if (!info) {
    words.delete(note.path);
    return null;
  }
  const known = words.get(note.path);
  if (known && known.ms === info.modifiedMs) return known.words;
  let count = 0;
  try {
    count = countWords(await textus.files.readText(note.path));
  } catch (error) {
    count = 0;
  }
  words.set(note.path, { ms: info.modifiedMs, words: count });
  return count;
}

/** The notes with tasks still open, as one Set of folder-relative paths. */
async function openTasks(root) {
  const set = new Set();
  try {
    const tasks = await textus.metadata.tasks({ done: false });
    for (const task of tasks || []) {
      if (!task || !task.path) continue;
      set.add(relOf(root, task.path) || slash(task.path));
    }
  } catch (error) {
    // No metadata to ask: the days simply show no hollow dot.
  }
  return set;
}

async function statsOf(from, to) {
  const spot = await where("daily");
  if (!spot) return [];
  const known = new Set(await dailyDates(spot));
  const open = await openTasks(spot.root);
  let byDay = new Map();
  try {
    byDay = await noteIndex(spot.root);
  } catch (error) {
    byDay = new Map();
  }
  const out = [];
  for (const date of span(from, to)) {
    const rows = byDay.get(date) || [];
    if (!known.has(date)) {
      // No daily note, but notes were written that day: the day still needs
      // its shade, and its count.
      if (rows.length) out.push({ date: date, words: 0, open: false, notes: rows.length });
      continue;
    }
    const count = await wordsAt(spot, date);
    if (count == null) continue;
    const rel = noteFor(spot, date).rel;
    // How many notes the day holds: the ones that changed that day, and the
    // day's own note even when it was touched on another day.
    const notes = rows.some((row) => row.rel === rel) ? rows.length : rows.length + 1;
    out.push({ date: date, words: count, open: open.has(rel), notes: notes });
  }
  return out;
}

/** The folder's daily notes, read again only after a file changed. */
async function dailyDates(spot) {
  if (dates && cached && cached.root === spot.root && cached.rel === spot.rel && cached.format === spot.format) {
    return dates;
  }
  const list = await noteDates(spot);
  dates = list;
  cached = spot;
  return list;
}

/* ------------------------------------------------------------- drawing */

async function setting(key) {
  try {
    return await textus.settings.get(key);
  } catch (error) {
    return undefined;
  }
}

async function snapshot() {
  const spot = await where("daily");
  const path = await textus.editor.getPath().catch(() => null);
  const weekly = await where("weekly");
  const [startWeek, wordsPerDot, showWeekNumbers, confirmNew] = await Promise.all([
    setting("startWeek"),
    setting("wordsPerDot"),
    setting("showWeekNumbers"),
    setting("confirmNew"),
  ]);
  const reveal = pendingReveal;
  pendingReveal = null;
  return {
    root: !!spot,
    dates: spot ? await dailyDates(spot) : [],
    week: !!weekly,
    weekToken: weekly ? weekToken(weekly.format) : "W",
    today: textus.dates.format(new Date(), "YYYY-MM-DD"),
    current: spot && path ? dateAt(spot, path) : null,
    startWeek: startWeek == null ? "locale" : String(startWeek),
    wordsPerDot: Number(wordsPerDot) || 0,
    showWeekNumbers: showWeekNumbers === true,
    confirmNew: confirmNew !== false,
    reveal: reveal,
  };
}

function send(message) {
  for (const panel of panels) {
    try {
      panel.postMessage(message);
    } catch (error) {
      panels.delete(panel);
    }
  }
}

/** Tells every panel the month and the days that have notes. Asked again
 *  while it runs, so a burst of saves costs one read. */
async function refresh() {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      const state = await snapshot();
      send(Object.assign({ type: "state" }, state));
    } while (again);
  } catch (error) {
    log("error", "Could not draw the calendar: " + error);
  } finally {
    busy = false;
  }
}

/** Refreshes after a short wait: saves and changes come in bursts. */
function schedule(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    refresh();
  }, delay == null ? 150 : delay);
}

function log(level, message) {
  try {
    ctx.log[level](message);
  } catch (error) {
    // Nothing to log to.
  }
}

/** Whether a path is one of the daily notes the calendar draws. */
function mine(path) {
  if (!cached || !path) return true;
  return dateAt(cached, path) != null;
}

/* --------------------------------------------------------------- notes */

async function templateText(spot, date, title) {
  let source = "";
  if (spot.template) {
    try {
      source = await textus.files.readText(abs(spot.root, spot.template));
    } catch (error) {
      source = "";
    }
  }
  if (!source) source = EMPTY_TEMPLATE;
  try {
    const filled = textus.templates.fill(source, { date: dayOf(date), title: title });
    return filled && typeof filled.text === "string" ? filled.text : source;
  } catch (error) {
    return source;
  }
}

/* ------------------------------------------------------- a day's notes */

/** Every note of the folder, grouped by the day it last changed: the folder is
 *  walked once, one listing per folder, and again after a file changes. */
async function noteIndex(root) {
  if (index && index.root === root && Date.now() - index.at < 30000) return index.days;
  const days = new Map();
  // The relative path is built while walking, as cloud-sync does: the entries
  // a folder listing returns are not trusted to carry one.
  const walk = async (relative, depth) => {
    const dir = relative ? abs(root, relative) : root;
    let entries = [];
    try {
      entries = await textus.files.list(dir);
    } catch (error) {
      entries = [];
    }
    for (const entry of entries || []) {
      if (!entry || !entry.name || entry.name.startsWith(".")) continue;
      const rel = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDir) {
        if (depth < 8) await walk(rel, depth + 1);
        continue;
      }
      if (!/\.md$/i.test(entry.name)) continue;
      const ms = Number(entry.modifiedMs);
      if (!ms) continue;
      const day = textus.dates.format(new Date(ms), "YYYY-MM-DD");
      if (!days.has(day)) days.set(day, []);
      days.get(day).push({ path: abs(root, rel), rel: rel, name: nameOf(rel), ms: ms });
    }
  };
  await walk("", 0);
  index = { root: root, at: Date.now(), days: days };
  return days;
}

/** Every note of a range of days: the daily notes of those days and the weekly
 *  note of the range first, then the notes that changed inside it, the last
 *  written first. */
async function rangeInfo(from, to) {
  const out = { type: "day", from: from, to: to, date: from, daily: null, notes: [] };
  const spot = await where("daily");
  if (!spot) return out;
  let byDay = new Map();
  try {
    byDay = await noteIndex(spot.root);
  } catch (error) {
    byDay = new Map();
  }
  const clock = (ms) => textus.dates.format(new Date(Number(ms) || 0), "HH:mm");
  const seen = new Set();
  const rows = [];
  const push = (row) => {
    if (seen.has(row.rel)) return;
    seen.add(row.rel);
    rows.push(row);
  };

  // A week's note, where the vault keeps them.
  if (from !== to) {
    const weekly = await where("weekly");
    if (weekly) {
      const note = noteFor(weekly, span(from, to)[3] || from);
      const own = await textus.files.stat(note.path);
      if (own) {
        push({
          path: note.path,
          rel: note.rel,
          name: nameOf(note.rel),
          ms: Number(own.modifiedMs) || 0,
          kind: "weekly",
          date: from,
          time: clock(own.modifiedMs),
        });
      }
    }
  }

  // The daily notes of the days in the range, made or not.
  for (const date of span(from, to)) {
    const note = noteFor(spot, date);
    const own = await textus.files.stat(note.path);
    if (!own) continue;
    const row = {
      path: note.path,
      rel: note.rel,
      name: nameOf(note.rel),
      ms: Number(own.modifiedMs) || 0,
      kind: "daily",
      date: date,
      time: clock(own.modifiedMs),
    };
    push(row);
    if (from === to) out.daily = { path: row.path, rel: row.rel, name: row.name };
  }

  // Whatever else changed inside the range.
  for (const [day, list] of byDay) {
    if (day < from || day > to) continue;
    for (const row of list) {
      push({
        path: row.path,
        rel: row.rel,
        name: row.name,
        ms: row.ms,
        kind: "note",
        date: day,
        time: clock(row.ms),
      });
    }
  }

  const rank = { weekly: 0, daily: 1, note: 2 };
  rows.sort((a, b) => rank[a.kind] - rank[b.kind] || b.ms - a.ms);
  out.notes = rows.slice(0, 200);
  return out;
}

/* ------------------------------------------------------------ opening */

async function createNote(spot, note, date) {
  const parent = note.path.replace(/[\\/][^\\/]*$/, "");
  if (parent && parent !== trim(spot.root)) {
    try {
      await textus.files.createFolder(parent);
    } catch (error) {
      // Already there.
    }
  }
  const name = note.rel.split("/").pop() || "";
  const title = name.replace(/\.md$/i, "");
  await textus.files.create(note.path, await templateText(spot, date, title));
}

async function openPath(path, split) {
  if (split) return textus.layout.open(path, { where: "beside" });
  let active = null;
  try {
    active = await textus.layout.activeTab();
  } catch (error) {
    active = null;
  }
  const kind = active && active.kind;
  const where_ = kind === "document" || kind === "file" ? "current" : "tab";
  return textus.layout.open(path, { where: where_ });
}

/** Opens the note a list row stands for. The page sends the folder-relative
 *  path it was given; the absolute one is made here, and the note is looked
 *  for before it is opened, so a stale row says so instead of doing nothing. */
async function openRow(asked) {
  const split = !!asked.split;
  let root = cached && cached.root ? cached.root : null;
  if (!root) {
    try {
      root = await textus.files.root();
    } catch (error) {
      root = null;
    }
  }
  const tries = [];
  if (typeof asked.rel === "string" && asked.rel) {
    if (root) tries.push(abs(root, slash(asked.rel)));
  }
  if (typeof asked.path === "string" && asked.path) tries.push(asked.path);
  if (typeof asked.rel === "string" && asked.rel) tries.push(asked.rel);
  for (const candidate of tries) {
    let info = null;
    try {
      info = await textus.files.stat(candidate);
    } catch (error) {
      info = null;
    }
    if (!info || info.isDir) continue;
    await openPath(candidate, split);
    return;
  }
  await textus.ui.notice(t("missingNote"));
}

/** Makes a day's note from the template, asking first when the folder's own
 *  setting says so, then opens it. */
async function createDaily(date, split) {
  const spot = await where("daily");
  if (!spot) {
    await textus.ui.message(t("noFolder"));
    return null;
  }
  const note = noteFor(spot, date);
  const there = !!(await textus.files.stat(note.path));
  if (!there) {
    if (await confirms()) {
      const go = await textus.ui.confirm(t("createQuestion", date), { okLabel: t("create") });
      if (!go) return null;
    }
    try {
      await createNote(spot, note, date);
    } catch (error) {
      await textus.ui.message(String(error && error.message ? error.message : error));
      return null;
    }
  }
  await openPath(note.path, !!split);
  schedule(0);
  return note;
}

/** Opens a day's note, making it first when the day has none. */
async function openDay(date, options) {
  await createDaily(date, !!(options && options.split));
}

/** Opens the note of the week a day belongs to. */
async function openWeek(date) {
  const spot = await where("weekly");
  if (!spot) {
    await textus.ui.notice(t("noWeekly"));
    return;
  }
  const note = noteFor(spot, date);
  const there = !!(await textus.files.stat(note.path));
  if (!there) {
    const name = textus.dates.format(dayOf(date), spot.format);
    if (await confirms()) {
      const go = await textus.ui.confirm(t("createQuestion", name), { okLabel: t("create") });
      if (!go) return;
    }
    try {
      await createNote(spot, note, date);
    } catch (error) {
      await textus.ui.message(String(error && error.message ? error.message : error));
      return;
    }
  }
  await openPath(note.path, false);
  schedule(0);
}

/** Whether a note may be made only after asking (the folder's own default
 *  is to ask: it is the one that writes a file). */
async function confirms() {
  const value = await setting("confirmNew");
  return value !== false;
}

/** Shows the day of the note in front, in every calendar panel. */
async function reveal() {
  const spot = await where("daily");
  const path = await textus.editor.getPath().catch(() => null);
  const date = spot && path ? dateAt(spot, path) : null;
  if (!date) {
    await textus.ui.notice(t("notADailyNote"));
    return;
  }
  if (panels.size) {
    send({ type: "reveal", date: date });
    return;
  }
  pendingReveal = date;
  try {
    await textus.layout.showSidebarTab(SIDEBAR);
  } catch (error) {
    // No sidebar to show: the state that follows still carries the day.
  }
  refresh();
}

/* -------------------------------------------------------------- panels */

async function month(panel, message) {
  const from = typeof message.from === "string" ? message.from : "";
  const to = typeof message.to === "string" ? message.to : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
  const days = await statsOf(from, to);
  try {
    panel.postMessage({ type: "stats", days: days });
  } catch (error) {
    panels.delete(panel);
  }
}

function onMessage(panel, message) {
  const asked = message || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(asked.date)) ? String(asked.date) : null;
  switch (asked.type) {
    case "ready":
      refresh();
      break;
    case "month":
      month(panel, asked);
      break;
    case "select":
      if (date || asked.from) {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(asked.from)) ? String(asked.from) : date;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(asked.to)) ? String(asked.to) : from;
        if (from && to) {
          rangeInfo(from, to)
            .then((info) => panel.postMessage(info))
            .catch((error) => ctx.log.warn("day: " + error));
        }
      }
      break;
    case "open":
      openRow(asked);
      break;
    case "create":
      if (date) createDaily(date, !!asked.split);
      break;
    case "week":
      if (date) openWeek(date);
      break;
    case "reveal":
      reveal();
      break;
    default:
      break;
  }
}

async function mount(webview) {
  panels.add(webview);
  try {
    await webview.setTitle(t("calendar"));
  } catch (error) {
    // The title is a nicety.
  }
  if (webview.onDidDispose) {
    webview.onDidDispose(() => panels.delete(webview));
  }
  webview.onDidReceiveMessage((message) => onMessage(webview, message));
  webview.html = await ctx.plugin.readText("panel.html");
}

/* ------------------------------------------------------------- startup */

exports.activate = function (context) {
  ctx = context;
  context.subscriptions.push(
    textus.views.registerWebview(SIDEBAR, { resolve: mount }),
    textus.views.registerWebview(VIEW, { resolve: mount }),
  );
  context.subscriptions.push(
    textus.commands.register("luckylew23.calendar.open", () =>
      textus.layout.openView(VIEW, { where: "tab" }),
    ),
    textus.commands.register("luckylew23.calendar.today", () =>
      openDay(textus.dates.format(new Date(), "YYYY-MM-DD")),
    ),
    textus.commands.register("luckylew23.calendar.reveal", reveal),
    textus.commands.register("luckylew23.calendar.week", () =>
      openWeek(textus.dates.format(new Date(), "YYYY-MM-DD")),
    ),
  );

  const changed = (event) => {
    if (event && event.path && !mine(event.path)) return;
    dates = null;
    index = null;
    schedule(200);
  };

  context.subscriptions.push(
    textus.files.onDidSave(changed),
    textus.files.onDidCreate(changed),
    textus.files.onDidDelete(changed),
    textus.files.onDidRename(() => {
      dates = null;
      index = null;
      schedule(200);
    }),
    textus.files.onDidChangeRoot(() => {
      dates = null;
      cached = null;
      index = null;
      words.clear();
      schedule(0);
    }),
    textus.settings.onDidChange(() => schedule(0)),
    textus.editor.onDidChangeActive(() => schedule(150)),
  );
};

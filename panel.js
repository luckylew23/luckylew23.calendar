/* The Calendar panel: one month of the folder's daily notes, a dot for every N
   words written, and the week numbers beside them. A day clicked is chosen, not
   opened: the notes written that day are listed under the month, newest first,
   and a note opened from that list. Everything it shows comes from the host
   (which knows where the notes are, what they are called and which days are
   written); this page only draws it and answers clicks. */
(function () {
  "use strict";

  const api = acquireTextusApi();
  const $ = (id) => document.getElementById(id);
  const dates = window.textus.dates;
  const dateOf = (day) => dates.format(day, "YYYY-MM-DD");
  const dayOf = (text) => {
    const [year, month, day] = String(text).split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const shift = (text, days) => {
    const day = dayOf(text);
    day.setDate(day.getDate() + days);
    return dateOf(day);
  };
  const between = (from, to) => Math.round((dayOf(to) - dayOf(from)) / 86400000);
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));

  const bar = $("bar");
  const grid = $("grid");
  const title = $("month");
  const empty = $("nofolder");
  const dayBox = $("day");
  const dayTitle = $("daytitle");
  const dayList = $("daylist");
  const dayEmpty = $("dayempty");
  const newDay = $("newday");

  // The buttons' names, in the UI's language.
  for (const [id, key] of [
    ["prev", "prevMonth"],
    ["next", "nextMonth"],
  ])
    for (const attr of ["aria-label", "title"]) $(id).setAttribute(attr, api.t(key));
  $("today").textContent = api.t("todayButton");
  empty.textContent = api.t("noFolder");
  newDay.textContent = api.t("createDaily");
  dayEmpty.textContent = api.t("noNotes");

  const saved = api.getState() || {};
  let shown = saved.month ? dayOf(saved.month + "-01") : new Date();
  shown = new Date(shown.getFullYear(), shown.getMonth(), 1);

  let state = {
    root: true,
    dates: [],
    weekToken: "W",
    today: null,
    current: null,
    startWeek: "locale",
    wordsPerDot: 250,
    showWeekNumbers: false,
  };
  let noted = new Set();
  let stats = new Map();
  let cells = [];
  let asked = null;
  let focusDate = null;
  let selected = isDate(saved.day) ? saved.day : null;
  let weekSel = isDate(saved.week) ? { from: saved.week, to: shift(saved.week, 6), anchor: shift(saved.week, 3) } : null;
  let dayInfo = null;
  let picked = false;

  /** The first weekday of a week: 0 Sunday to 6 Saturday, or null to follow
   *  the language. */
  const weekStart = () =>
    state.startWeek === "sunday" ? 0 : state.startWeek === "monday" ? 1 : null;

  /** A written day's dots: one filled dot per `wordsPerDot` words written, one
   *  at the least and five at the most, and one hollow dot more when the note
   *  still has tasks open. No note, no dots. */
  function dotsOf(date) {
    if (!noted.has(date)) return null;
    const per = Number(state.wordsPerDot) || 0;
    const found = stats.get(date);
    const open = !!(found && found.open);
    const words = found ? Number(found.words) || 0 : 0;
    const filled = per > 0 ? Math.min(5, Math.max(1, Math.floor(words / per))) : 0;
    if (!filled && !open) return null;
    return { filled: filled, open: open };
  }

  /** The days the list below the month stands for: one day, or a whole week. */
  function chosen() {
    if (weekSel) return weekSel;
    return selected ? { from: selected, to: selected } : null;
  }

  /** How many notes a day holds, as one of five shades: nothing written, a few,
   *  more, a busy day, a very busy one. The page only picks the shade; the
   *  colours are the app's own tokens. */
  function heatOf(date) {
    const found = stats.get(date);
    const count = found ? Number(found.notes) || 0 : 0;
    if (!count) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
  }

  /** Whether the notes the host sent answer what is chosen now. */
  function answers(info) {
    const want = chosen();
    if (!info || !want) return false;
    return (info.from || info.date) === want.from && (info.to || info.date) === want.to;
  }

  /** The month's name, short when the bar is too narrow for the long one (a
   *  sidebar, a phone), and moved above the buttons when even that won't fit:
   *  again whenever the bar's width changes. */
  function fit(long, short) {
    bar.classList.remove("stacked");
    const text = document.createRange();
    const fits = (name) => {
      title.textContent = name;
      text.selectNodeContents(title);
      return text.getBoundingClientRect().width <= title.clientWidth;
    };
    if (fits(long) || fits(short)) return;
    bar.classList.add("stacked");
    if (!fits(long)) fits(short);
  }

  function weekButton(start) {
    // The row's middle day names its week, whichever day the week starts on.
    const middle = shift(start, 3);
    const number = dates.format(dayOf(middle), state.weekToken);
    const button = document.createElement("button");
    button.className = "week";
    button.dataset.week = middle;
    button.textContent = number;
    button.setAttribute("aria-label", api.t("weekNumber", number));
    return button;
  }

  function render() {
    const active = document.activeElement;
    const keep = active && active.dataset ? active.dataset.date : null;
    const month = dateOf(shown).slice(0, 7);
    api.setState({ month: month, day: selected || "", week: weekSel ? weekSel.from : "" });
    const long = shown.toLocaleDateString(api.language, { year: "numeric", month: "long" });
    const short = shown.toLocaleDateString(api.language, { year: "numeric", month: "short" });
    fit(long, short);
    title.disabled = !state.root;
    title.title = long + (state.root ? " · " + api.t("pickMonth") : "");
    empty.hidden = !!state.root;

    grid.textContent = "";
    const start = weekStart();
    const all = window.textus.monthDays(
      shown.getFullYear(),
      shown.getMonth(),
      start == null ? undefined : { weekStart: start },
    );
    // Six whole weeks, as Obsidian's calendar shows them, so the grid keeps
    // the same height from month to month.
    const days = all;
    cells = days.map((g) => g.date);
    const weeks = !!state.showWeekNumbers;
    grid.classList.toggle("weeks", weeks);
    if (weeks) grid.append(document.createElement("div"));

    for (const g of days.slice(0, 7)) {
      const cell = document.createElement("div");
      cell.className = "tx-calendar-weekday";
      cell.textContent = dayOf(g.date).toLocaleDateString(api.language, { weekday: "narrow" });
      grid.append(cell);
    }

    const buttons = [];
    days.forEach((g, index) => {
      const day = dayOf(g.date);
      if (weeks && index % 7 === 0) grid.append(weekButton(g.date));
      const button = document.createElement("button");
      button.className = "tx-calendar-day";
      if (!g.inMonth) button.classList.add("is-other");
      if (g.today) button.classList.add("is-today");
      // With dots off, a marked day still says it has a note.
      if (noted.has(g.date) && !(Number(state.wordsPerDot) > 0)) button.classList.add("is-marked");
      if (state.current === g.date) button.classList.add("cal-current");
      const heat = heatOf(g.date);
      if (heat) button.dataset.heat = String(heat);
      // A chosen week marks all seven of its days; a chosen day marks itself.
      const on = weekSel ? g.date >= weekSel.from && g.date <= weekSel.to : selected === g.date;
      if (on) {
        button.classList.add("cal-selected");
        button.setAttribute("aria-selected", "true");
      }
      button.textContent = String(g.day);
      button.dataset.date = g.date;
      button.tabIndex = -1;
      button.setAttribute("aria-label", day.toLocaleDateString(api.language, { dateStyle: "full" }));
      const dots = dotsOf(g.date);
      if (dots) {
        const box = document.createElement("span");
        box.className = "cal-dots";
        const drawn = dots.filled + (dots.open ? 1 : 0);
        button.dataset.dots = drawn;
        for (let i = 0; i < drawn; i++) {
          const dot = document.createElement("i");
          dot.className = "cal-dot";
          if (dots.open && i === drawn - 1) dot.classList.add("is-open");
          box.append(dot);
        }
        button.append(box);
      }
      grid.append(button);
      buttons.push(button);
    });

    // One day is reachable with Tab; the arrow keys move between them.
    const wanted =
      [focusDate, keep, selected, state.current, state.today].find(
        (d) => d && cells.indexOf(d) >= 0,
      ) ||
      cells.find((d) => d.slice(0, 7) === month) ||
      cells[0];
    const first = buttons.find((b) => b.dataset.date === wanted) || buttons[0];
    if (first) first.tabIndex = 0;
    if (keep) {
      const again = buttons.find((b) => b.dataset.date === keep);
      if (again) again.focus();
    }

    paint();
    request();
  }

  /** The chosen day's own notes, under the month: its daily note first, then
   *  whatever was written that day, newest first. A whole week chosen lists the
   *  week's notes instead, each with its day. */
  function paint() {
    const want = chosen();
    const on = !!state.root && !!want;
    dayBox.hidden = !on;
    if (!on) return;
    const info = answers(dayInfo) ? dayInfo : null;
    const range = want.from !== want.to;
    const short = (date) =>
      dayOf(date).toLocaleDateString(api.language, { month: "short", day: "numeric" });
    if (range) {
      const number = dates.format(dayOf(shift(want.from, 3)), state.weekToken);
      dayTitle.textContent = api.t(
        "weekRange",
        api.t("weekNumber", number),
        short(want.from),
        short(want.to),
      );
    } else {
      dayTitle.textContent = dayOf(want.from).toLocaleDateString(api.language, {
        month: "short",
        day: "numeric",
      });
    }
    // A day whose note is made offers its list; one without offers to make it.
    // A week has no single note to make, so it offers nothing but its notes.
    newDay.hidden = range || !info || !!info.daily;
    dayList.textContent = "";
    const notes = info ? info.notes || [] : [];
    dayEmpty.hidden = !info || notes.length > 0;
    for (const note of notes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tx-list-row cal-row";
      row.dataset.path = note.path;
      if (note.rel) row.dataset.rel = note.rel;
      row.setAttribute("role", "listitem");
      row.title = note.rel || note.path;
      const mark = document.createElement("i");
      mark.className = "cal-mark";
      if (note.kind === "daily") mark.classList.add("is-daily");
      if (note.kind === "weekly") mark.classList.add("is-weekly");
      const label = document.createElement("span");
      label.className = "tx-list-label";
      label.textContent = note.name;
      const meta = document.createElement("span");
      meta.className = "tx-list-meta";
      const time = note.time || "";
      meta.textContent = range && note.date ? short(note.date) + " " + time : time;
      row.append(mark, label, meta);
      dayList.append(row);
    }
  }

  /** Chooses a day: its month comes on show when it is another one, the day is
   *  marked, and the host is asked for the notes written that day. */
  function select(date, options) {
    if (!isDate(date)) return;
    const same = selected === date && !weekSel;
    weekSel = null;
    if (selected !== date) dayInfo = null;
    else if (!same) dayInfo = null;
    selected = date;
    if (date.slice(0, 7) !== dateOf(shown).slice(0, 7)) {
      const day = dayOf(date);
      shown = new Date(day.getFullYear(), day.getMonth(), 1);
      focusDate = date;
      render();
    } else {
      for (const button of grid.querySelectorAll("button[data-date]")) {
        const on = button.dataset.date === date;
        button.classList.toggle("cal-selected", on);
        if (on) button.setAttribute("aria-selected", "true");
        else button.removeAttribute("aria-selected");
      }
      paint();
      api.setState({ month: dateOf(shown).slice(0, 7), day: date, week: "" });
    }
    api.postMessage({ type: "select", from: date, to: date });
    if (options && options.focus) {
      const button = grid.querySelector('button[data-date="' + date + '"]');
      if (button) button.focus();
    }
  }

  /** Chooses the week a day belongs to: its seven days are marked and the week's
   *  notes are listed. The day the week was picked from stays the one keyboard
   *  moves go on from. */
  function selectWeek(anchor) {
    if (!isDate(anchor)) return;
    const from = shift(anchor, -3);
    const to = shift(anchor, 3);
    weekSel = { from: from, to: to, anchor: anchor };
    dayInfo = null;
    if (anchor.slice(0, 7) !== dateOf(shown).slice(0, 7)) {
      const day = dayOf(anchor);
      shown = new Date(day.getFullYear(), day.getMonth(), 1);
    }
    render();
    api.postMessage({ type: "select", from: from, to: to });
  }

  /** Asks the host for the words written in the month on show, once per
   *  range: the host counts them from disk, and caches them by their stamp. */
  function request() {
    if (!state.root || !cells.length) return;
    const key = cells[0] + "/" + cells[cells.length - 1];
    if (key === asked) return;
    asked = key;
    api.postMessage({ type: "month", from: cells[0], to: cells[cells.length - 1] });
  }

  function focusOn(date) {
    focusDate = date;
    const button = grid.querySelector('button[data-date="' + date + '"]');
    if (!button) return;
    for (const other of grid.querySelectorAll("button[data-date]")) {
      other.tabIndex = other === button ? 0 : -1;
    }
    button.focus();
  }

  /** Brings a day into view, turning the page when it is another month. */
  function go(date) {
    if (cells.indexOf(date) >= 0) {
      focusOn(date);
      return;
    }
    const day = dayOf(date);
    shown = new Date(day.getFullYear(), day.getMonth(), 1);
    focusDate = date;
    render();
    focusOn(date);
  }

  title.onclick = async () => {
    const answer = await api.pickDate(selected || dateOf(shown), title);
    if (!answer) return;
    go(answer);
    select(answer);
  };

  $("prev").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1);
    render();
  };
  $("next").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
    render();
  };
  $("today").onclick = () => {
    const now = new Date();
    shown = new Date(now.getFullYear(), now.getMonth(), 1);
    render();
    select(dateOf(now), { focus: true });
  };

  newDay.onclick = () => {
    if (selected) api.postMessage({ type: "create", date: selected });
  };

  dayList.addEventListener("click", (event) => {
    const row = event.target.closest ? event.target.closest("button[data-path]") : null;
    if (!row) return;
    api.postMessage({
      type: "open",
      path: row.dataset.path,
      rel: row.dataset.rel || "",
      split: !!(event.ctrlKey || event.metaKey),
    });
  });

  grid.addEventListener("click", (event) => {
    const button = event.target.closest ? event.target.closest("button") : null;
    if (!button) return;
    if (button.dataset.week) {
      // A week number picks the whole week; Ctrl or Cmd still opens its note.
      if (event.ctrlKey || event.metaKey) {
        api.postMessage({ type: "week", date: button.dataset.week });
        return;
      }
      selectWeek(button.dataset.week);
      return;
    }
    const date = button.dataset.date;
    if (!date) return;
    focusDate = date;
    // Ctrl or Cmd on a day opens that day's note beside this one; a plain
    // click only chooses the day.
    if (event.ctrlKey || event.metaKey) {
      api.postMessage({ type: "create", date: date, split: true });
      return;
    }
    select(date);
  });

  // A grid of buttons, walked with the arrow keys and Home/End, as a calendar
  // is: the day clicked keeps the focus, and Enter chooses it.
  grid.addEventListener("keydown", (event) => {
    const button = document.activeElement;
    const date = button && button.dataset ? button.dataset.date : null;
    if (!date) return;
    const column = between(cells[0], date) % 7;
    let next = null;
    switch (event.key) {
      case "ArrowLeft":
        next = shift(date, -1);
        break;
      case "ArrowRight":
        next = shift(date, 1);
        break;
      case "ArrowUp":
        next = shift(date, -7);
        break;
      case "ArrowDown":
        next = shift(date, 7);
        break;
      case "Home":
        next = shift(date, -column);
        break;
      case "End":
        next = shift(date, 6 - column);
        break;
      case "PageUp":
      case "PageDown":
        next = page(date, event.key === "PageUp" ? -1 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    go(next);
  });

  /** The same day a month before or after, keeping the day of the month. */
  function page(date, months) {
    const day = dayOf(date);
    const dayOfMonth = day.getDate();
    const month = new Date(day.getFullYear(), day.getMonth() + months, 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return dateOf(new Date(month.getFullYear(), month.getMonth(), Math.min(dayOfMonth, last)));
  }

  api.onDidReceiveMessage((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "state") {
      state = Object.assign(state, message);
      noted = new Set(state.dates || []);
      if (!picked && !selected && isDate(state.today)) {
        // Nothing chosen yet: the day in progress is the one to show.
        picked = true;
        const today = state.today;
        if (today.slice(0, 7) !== dateOf(shown).slice(0, 7)) {
          const day = dayOf(today);
          shown = new Date(day.getFullYear(), day.getMonth(), 1);
        }
        selected = today;
        dayInfo = null;
      }
      if (isDate(state.reveal)) {
        const day = dayOf(state.reveal);
        shown = new Date(day.getFullYear(), day.getMonth(), 1);
        focusDate = state.reveal;
        selected = state.reveal;
        weekSel = null;
        dayInfo = null;
      }
      asked = null;
      render();
      const want = chosen();
      if (want) api.postMessage({ type: "select", from: want.from, to: want.to });
      return;
    }
    if (message.type === "day") {
      dayInfo = message;
      if (answers(message)) paint();
      return;
    }
    if (message.type === "stats") {
      stats = new Map();
      for (const day of message.days || []) {
        if (day && day.date) stats.set(day.date, day);
      }
      render();
      return;
    }
    if (message.type === "reveal" && isDate(message.date)) {
      const day = dayOf(message.date);
      shown = new Date(day.getFullYear(), day.getMonth(), 1);
      focusDate = message.date;
      render();
      select(message.date, { focus: true });
    }
  });

  render();
  api.postMessage({ type: "ready" });
})();

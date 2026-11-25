# Calendar

A month calendar in the sidebar, made after Obsidian's Calendar plugin: the days you wrote in are marked, a click chooses a day, and the notes written that day are listed under the month. A day with no daily note yet gets one from a button.

- **Plugins › Open Calendar** opens it as a tab; the sidebar's **Calendar** tab is the same calendar, and both widths work.
- The dots under a day are the words written that day: one filled dot per 250 words, at most five, and a written day always shows at least one; a day that still has tasks open shows one hollow dot more. A day with open tasks and no words yet shows only that hollow dot.
- **A click chooses a day** and writes nothing: the notes written that day appear under the month - that day's own note first, the rest newest first, each with a mark (accent for the day's own note) and the time it was written. A row opens its note; **Ctrl or ⌘ click** opens it in a split.
- The busier a day is with notes, the deeper its cell is shaded - one or two notes lightly, five or more darkest - so a scattered day stands out.
- A day without a note shows **New note** above the list: it writes the day's note from the template and opens it, asking first unless that setting is off. **Ctrl or ⌘ click** on a day in the month creates that day's note straight into a split.
- With week numbers on (the default), a column on the left names each week. **A click on a week number chooses the whole week** and lists the notes written in it, each row starting with its date; **Ctrl or ⌘ click** on the number opens (or writes) that week's note instead.
- **Plugins › Open Today's Note** and **Reveal the Open Note** follow the note in front; the arrow keys, Home/End and PageUp/PageDown move about the month, and Enter chooses the day in focus.
- The month's name is a button: it opens Textus's own date picker to jump to another month.

## Settings

- **Start the week on**: the language's first day, Sunday or Monday - the same day the week numbers count from.
- **Words per dot**: 250 by default; 0 turns the dots off and marks the days with notes instead.
- **Show week numbers**: on by default; a click chooses the whole week, Ctrl/⌘ click opens that week's note.
- **Ask before creating a note**: on by default; turned off, a new note is written without asking.

## Obsidian vaults

In an Obsidian vault the folder, the name format and the template come from the vault's own daily notes settings, which Textus has already resolved; Textus never changes them. A vault without daily notes settings keeps its notes at its top. A new note is filled in from the vault's template - `{{date}}`, `{{title}}` and the rest. Weekly notes follow Periodic Notes when the vault has it.

## How it differs from the Obsidian plugin

- A click chooses a day and lists its notes; Obsidian opens the day's note, creating it when missing. Creating is a button of its own here, and Ctrl/⌘ click still opens a split.
- The list under the month and the shading by note count are new: Obsidian's calendar only draws dots.
- A click on a week number chooses the week and lists its notes; Obsidian opens the weekly note (here that is Ctrl/⌘ click).
- **Today** is a button; Obsidian resets the month with a small dot. The month's name is Textus's own date picker.
- Weekly notes are read from the vault only; the plugin keeps no weekly settings of its own.
- Date names, the first day of the week and the weekday names follow Textus's language (`textus.dates` / `Intl`); Obsidian's locale override is not read.
- The community extension points (holidays, tags, the file menu) are not reproduced; the dots are words and open tasks.

## Permissions

It reads and writes files in the open folder: to find the notes there, count their words, write one from the template, and list the notes changed on a day. It reads which document is in front, to point at its day. Needs Textus 1.4.3 or newer.

## Changelog

- **0.3.1** - The description now says why it asks for files.write: writing a day's missing note from the template.
- **0.3.0** - A row in the list opens its note (resolved by relative path, with a notice when it is gone); the shade of a day deepens with the number of notes written in it; a click on a week number chooses the whole week and lists its notes, while Ctrl/⌘ click opens the weekly note.
- **0.2.0** - A click chooses a day; the notes written that day are listed under the month (the day's own note first, then newest first, with times); a **New note** button; week numbers on by default.
- **0.1.0** - First version: the month calendar in the sidebar and as a tab, a dot per N words, a hollow dot for open tasks, week numbers, the week starting as the language has it, Ctrl/⌘ click for a split, today and reveal-the-open-note, and an Obsidian vault's daily notes settings (Periodic Notes included).

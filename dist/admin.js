// Librarian - admin.nav module: the full housekeeping report, on its own
// admin page. Every probable duplicate and every saga hole; each copy with
// its quality, size, file path and a link to its page, the best copy of each
// year marked, and the spares offered to the trash. Moving to the trash goes
// through evey.media.trash: Evey shows its own confirmation, built from its
// own records, and nothing moves without it. Self-contained IIFE; the
// detection block is inlined VERBATIM from scan.js - the test suite fails on
// drift.
"use strict";
(function () {
  // --- inlined from scan.js (source of truth; kept byte-identical) ---
  // normTitle flattens a title for comparison: lowercase, accents stripped,
  // punctuation collapsed, leading articles dropped (fr/en/de) - "L'Été" and
  // "Ete" must collide, that is the point.
  function normTitle(t) {
    return String(t || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^(le|la|les|l|the|a|an|un|une|der|die|das) /, "")
      .replace(/ +/g, " ")
      .trim();
  }

  var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };

  // sagaKey splits "Rocky III" / "Iron Man 2" / "Halloween part 4" into
  // { base, num }. An unnumbered title is episode 1 of its own base - that is
  // what lets "Rocky II without Rocky" surface as a hole. Bounded at 15: past
  // that, a trailing number is more likely a year fragment than an episode.
  function sagaKey(title) {
    var n = normTitle(title);
    var m = /^(.*?)(?: (?:part|partie|chapter|chapitre|episode|vol|volume))? (\d{1,2}|[ivx]{1,4})$/.exec(n);
    if (!m) return { base: n, num: 1 };
    var raw = m[2];
    var num = /^\d+$/.test(raw) ? parseInt(raw, 10) : ROMAN[raw] || 0;
    if (num < 1 || num > 15) return { base: n, num: 1 };
    return { base: m[1].trim(), num: num };
  }

  // Release and quality tags: noise in a file name, never what tells two
  // films apart.
  var NOISE = {};
  ("2160p 1080p 1080i 720p 576p 480p 4k uhd hd sd fhd bluray bdrip brrip bdremux remux web webrip webdl dl hdtv " +
   "dvdrip dvd dvdscr hdrip x264 x265 h264 h265 hevc avc xvid divx mpeg4 aac ac3 eac3 dts dtshd truehd atmos mp3 " +
   "flac hdr hdr10 dv dolby vision 10bit 8bit multi vff vfq vf vo vostfr truefrench french english subfrench " +
   "proper repack internal limited mkv avi mp4 m4v ts").split(" ").forEach(function (w) { NOISE[w] = true; });

  // Editions: the same film, a different cut or format, never a spare copy.
  var EDITIONS = { "3d": "3d", "imax": "imax", "extended": "extended", "unrated": "unrated", "uncut": "uncut",
    "remastered": "remastered", "theatrical": "theatrical", "directors": "directors", "director": "directors" };

  // fileWords: the words of a file name that name the work, its edition set
  // apart. "Dune.2021.1080p.BluRay.x264-GROUP.mkv" -> {dune} + no edition;
  // "Edge of Tomorrow - 3D - 1080p.mkv" -> {edge, of, tomorrow} + 3d.
  function fileWords(path) {
    var base = String(path || "").split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, "");
    var words = normTitle(base).split(" ");
    var out = {}, editions = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || NOISE[w] || /^(19|20)\d\d$/.test(w)) continue;
      if (EDITIONS[w]) { editions.push(EDITIONS[w]); continue; }
      out[w] = true;
    }
    return { words: out, edition: editions.sort().join("+") };
  }

  function subset(a, b) {
    for (var k in a) if (!b[k]) return false;
    return true;
  }

  // sameWork: two items with the same title and year are copies of one film
  // only if, when their files are known, they are the same edition, their
  // file names agree (one's words within the other's: release groups add
  // words, they never change them) and their lengths are within 8 %. A film
  // the server misidentified fails one of these.
  function sameWork(a, b) {
    if (a.filePath && b.filePath) {
      var fa = fileWords(a.filePath), fb = fileWords(b.filePath);
      if (fa.edition !== fb.edition) return false;
      if (!subset(fa.words, fb.words) && !subset(fb.words, fa.words)) return false;
    }
    var da = Number(a.quality && a.quality.durationMs) || 0;
    var db = Number(b.quality && b.quality.durationMs) || 0;
    if (da > 0 && db > 0 && Math.abs(da - db) / Math.max(da, db) > 0.08) return false;
    return true;
  }

  // findDuplicates: copies of one film or series - same type, same title,
  // same year, and the same work by sameWork. A same title in another year is
  // another film, never listed. Each group's entries are linked copy to copy.
  function findDuplicates(items) {
    var byKey = {};
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      if (!it || !it.id || !it.title) continue;
      var ty = String(it.type || "");
      if (ty !== "MEDIA_ITEM_TYPE_MOVIE" && ty !== "MEDIA_ITEM_TYPE_SERIES") continue;
      var key = ty + ":" + normTitle(it.title) + ":" + (it.year || 0);
      (byKey[key] = byKey[key] || []).push(it);
    }
    var out = [];
    for (var k in byKey) {
      var group = byKey[k];
      if (group.length < 2) continue;
      // Cluster the group: a copy joins a cluster when it is the same work as
      // one of its members.
      var clusters = [];
      for (var j = 0; j < group.length; j++) {
        var home = null;
        for (var c = 0; c < clusters.length && !home; c++) {
          for (var m = 0; m < clusters[c].length; m++) {
            if (sameWork(group[j], clusters[c][m])) { home = clusters[c]; break; }
          }
        }
        if (home) home.push(group[j]);
        else clusters.push([group[j]]);
      }
      for (var q = 0; q < clusters.length; q++) {
        if (clusters[q].length < 2) continue;
        out.push({ title: clusters[q][0].title, entries: clusters[q], sameYear: true });
      }
    }
    out.sort(function (a, b) { return b.entries.length - a.entries.length; });
    return out;
  }

  // dupKey names a duplicate group by its copies, for "not a duplicate":
  // a new copy changes the key and brings the group back.
  function dupKey(group) {
    return "dup:" + group.entries.map(function (e) { return e.id; }).sort().join(",");
  }

  // findSagaHoles: numbered groups (at least one entry with num >= 2) whose
  // sequence 1..max misses numbers. Requires >= 2 entries in the group - a
  // lone "Blade II" is a choice, not a hole.
  function findSagaHoles(items) {
    var groups = {};
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      if (!it || !it.id || !it.title) continue;
      if (String(it.type || "") !== "MEDIA_ITEM_TYPE_MOVIE") continue;
      var key = sagaKey(it.title);
      if (!key.base) continue;
      var g = (groups[key.base] = groups[key.base] || { nums: {}, sample: it });
      g.nums[key.num] = it;
    }
    var out = [];
    for (var base in groups) {
      var nums = Object.keys(groups[base].nums).map(Number);
      if (nums.length < 2) continue;
      var max = Math.max.apply(null, nums);
      if (max < 2) continue;
      var missing = [];
      for (var n = 1; n <= max; n++) if (!groups[base].nums[n]) missing.push(n);
      if (missing.length === 0) continue;
      out.push({ base: base, have: nums.sort(function (a, b) { return a - b; }), missing: missing, sample: groups[base].sample });
    }
    out.sort(function (a, b) { return b.missing.length - a.missing.length; });
    return out;
  }

  // fetchWatchables reads every movie and series, page by page: one call of
  // the bridge returns at most 500 items, and without a type those are mixed
  // with seasons and episodes, so a large library was only ever half read.
  // `list` is window.evey.media.list; `libraryId` narrows to one library.
  // Bounded at 200 pages per type so a server that ignores paging cannot
  // spin the page forever.
  function fetchWatchables(list, libraryId) {
    var PAGE = 500;
    var out = [];
    function walk(type, page) {
      var opts = { type: type, page: page, pageSize: PAGE };
      if (libraryId) opts.libraryId = libraryId;
      return list(opts).then(function (resp) {
        var items = (resp && resp.items) || [];
        for (var i = 0; i < items.length; i++) out.push(items[i]);
        var total = Number(resp && resp.total) || 0;
        if (items.length === PAGE && page * PAGE < total && page < 200) return walk(type, page + 1);
      });
    }
    return walk("MEDIA_ITEM_TYPE_MOVIE", 1)
      .then(function () { return walk("MEDIA_ITEM_TYPE_SERIES", 1); })
      .then(function () { return out; });
  }
  // --- end inlined ---

  var STR = {
    fr: {
      loading: "Analyse des bibliothèques...",
      failed: "Lecture des bibliothèques impossible : ",
      scanned: function (n) { return n + " films et séries analysés"; },
      dupTitle: "Doublons probables",
      holeTitle: "Sagas incomplètes",
      none: "Rien à signaler.",
      copies: function (n) { return n + " copies"; },
      noPath: "chemin indisponible",
      noPathHint: "Les chemins et la qualité ne s'affichent qu'à un administrateur, avec la permission media.files accordée au plugin.",
      folder: "série : un dossier, pas un fichier",
      open: "Ouvrir",
      best: "meilleure qualité",
      trashOne: "Corbeille",
      keepBest: function (n) { return "Garder la meilleure, mettre " + (n > 1 ? "les " + n + " autres" : "l'autre") + " à la corbeille"; },
      trashed: function (n) { return n + (n > 1 ? " fichiers mis" : " fichier mis") + " à la corbeille, rien n'est effacé du disque"; },
      doneTitle: "Mis à la corbeille",
      doneLine: function (t, n, size) { return t + " : " + n + (n > 1 ? " copies déplacées" : " copie déplacée") + (size ? " (" + size + " libérés une fois la corbeille vidée)" : ""); },
      kept: "Gardée",
      keptNone: "Aucune autre copie de ce titre dans la bibliothèque.",
      movedTo: "Déplacé vers",
      doneHint: "Les fichiers sont dans le dossier .evey-trash de leur bibliothèque : rien n'est effacé du disque tant que vous ne le videz pas.",
      undo: "Annuler",
      notDup: "Pas un doublon",
      dismissedLine: function (n) { return n + (n > 1 ? " groupes écartés" : " groupe écarté") + " comme faux positifs"; },
      showAll: "Tout réafficher",
      pendingTag: "en cours, copie vers un autre disque",
      pendingHint: "Le dossier corbeille est sur un autre disque : Evey copie le fichier en arrière-plan, quelques minutes pour un gros film. Une notification Evey vous dira quand c'est fini, et « Annuler » sera proposé ensuite.",
      trashedPending: function (n) { return n + (n > 1 ? " fichiers partent" : " fichier part") + " vers la corbeille en arrière-plan"; },
      undoing: "Restauration...",
      restored: "Annulé : les fichiers sont revenus à leur place, les titres réapparaissent après le scan.",
      restoreFailed: function (n, msg) { return n + (n > 1 ? " fichiers n'ont pas pu" : " fichier n'a pas pu") + " revenir : " + msg; },
      trashFailed: function (n) { return n + (n > 1 ? " fichiers n'ont pas pu" : " fichier n'a pas pu") + " être déplacé"; },
      trashUnavailable: "La mise à la corbeille n'est pas disponible ici (permission media.trash, page admin du navigateur).",
      have: function (nums) { return "présents : " + nums.join(", "); },
      missing: function (nums) { return "il manque " + (nums.length > 1 ? "les épisodes " : "l'épisode ") + nums.join(", "); },
      recoverable: function (s) { return s + " récupérables en gardant la meilleure copie de chaque"; },
    },
    en: {
      loading: "Scanning libraries...",
      failed: "Could not read the libraries: ",
      scanned: function (n) { return n + " movies and series scanned"; },
      dupTitle: "Probable duplicates",
      holeTitle: "Sagas with holes",
      none: "Nothing to report.",
      copies: function (n) { return n + " copies"; },
      noPath: "path not available",
      noPathHint: "Paths and quality show only to an administrator, with the media.files permission granted to the plugin.",
      folder: "series: a folder, not a file",
      open: "Open",
      best: "best quality",
      trashOne: "Trash",
      keepBest: function (n) { return "Keep the best, move " + (n > 1 ? "the " + n + " others" : "the other") + " to the trash"; },
      trashed: function (n) { return n + (n > 1 ? " files" : " file") + " moved to the trash, nothing deleted from the disk"; },
      doneTitle: "Moved to the trash",
      doneLine: function (t, n, size) { return t + ": " + n + (n > 1 ? " copies moved" : " copy moved") + (size ? " (" + size + " freed once the trash is emptied)" : ""); },
      kept: "Kept",
      keptNone: "No other copy of this title in the library.",
      movedTo: "Moved to",
      doneHint: "The files are in the .evey-trash folder of their library: nothing is deleted from the disk until you empty it.",
      undo: "Undo",
      notDup: "Not a duplicate",
      dismissedLine: function (n) { return n + (n > 1 ? " groups" : " group") + " set aside as false positives"; },
      showAll: "Show them again",
      pendingTag: "in progress, copying to another disk",
      pendingHint: "The trash folder is on another disk: Evey copies the file in the background, a few minutes for a large film. An Evey notification will tell you when it is done, and Undo will be offered then.",
      trashedPending: function (n) { return n + (n > 1 ? " files are" : " file is") + " going to the trash in the background"; },
      undoing: "Restoring...",
      restored: "Undone: the files are back where they were, the titles reappear after the scan.",
      restoreFailed: function (n, msg) { return n + (n > 1 ? " files" : " file") + " could not come back: " + msg; },
      trashFailed: function (n) { return n + (n > 1 ? " files" : " file") + " could not be moved"; },
      trashUnavailable: "Moving to the trash is not available here (media.trash permission, browser admin page).",
      have: function (nums) { return "present: " + nums.join(", "); },
      missing: function (nums) { return "missing " + (nums.length > 1 ? "episodes " : "episode ") + nums.join(", "); },
      recoverable: function (s) { return s + " to recover by keeping the best copy of each"; },
    },
  };

  var UNITS = { fr: ["o", "Ko", "Mo", "Go", "To"], en: ["B", "KB", "MB", "GB", "TB"] };
  var units = UNITS.en;
  var S = STR.en;
  var canTrash = true;
  // What this visit moved to the trash, newest first: the group it came from
  // disappears from the duplicates once a single copy is left, so the page
  // says what happened and which copy stayed.
  var recent = [];
  // Items whose copy to the trash runs in the background (another disk): kept
  // out of the duplicates until Evey drops them, and the list read again
  // every few seconds meanwhile.
  var pending = {};
  // Groups the admin marked "not a duplicate", by dupKey, kept in the
  // plugin's prefs (this profile). A group that gains a copy comes back.
  var dismissed = {};
  function saveDismissed() {
    window.evey.prefs.set("dismissed", JSON.stringify(Object.keys(dismissed))).catch(function () {});
  }
  var pollTimer = 0;

  var MUTED = "color:var(--text-muted, #9aa0aa);";
  var BTN = "flex:none;padding:2px 9px;border-radius:6px;font:inherit;font-size:12px;cursor:pointer;background:transparent;";

  function h(tag, style, text) {
    var el = document.createElement(tag);
    if (style) el.setAttribute("style", style);
    if (text != null) el.textContent = text;
    return el;
  }

  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n <= 0) return "";
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i >= 3 ? n.toFixed(1) : Math.round(n)) + " " + units[i];
  }

  function fit() { window.evey.resize(document.body.scrollHeight); }

  // qualityLine: "2160p HEVC HDR10 10-bit · 25.0 Mb/s · EAC3 5.1".
  function qualityLine(q) {
    if (!q) return "";
    var parts = [];
    var v = [];
    if (q.height) v.push(q.height + "p");
    if (q.videoCodec) v.push(String(q.videoCodec).toUpperCase());
    if (q.hdrType) v.push(q.hdrType);
    if (Number(q.bitDepth) > 8) v.push(q.bitDepth + "-bit");
    if (v.length) parts.push(v.join(" "));
    var bps = Number(q.bitrate) || 0;
    if (bps > 0) parts.push((bps / 1e6).toFixed(1) + " Mb/s");
    if (q.audioCodec) {
      var ch = Number(q.audioChannels) || 0;
      var chs = ch >= 6 ? (ch - 1) + ".1" : ch === 2 ? "2.0" : ch ? ch + ".0" : "";
      parts.push((String(q.audioCodec).toUpperCase() + " " + chs).trim());
    }
    return parts.join(" · ");
  }

  // qualityScore ranks copies of one film: resolution first, then HDR, bit
  // depth, bitrate and size. A copy without quality data ranks last.
  function qualityScore(it) {
    var q = it.quality || {};
    return [Number(q.height) || 0, q.hdrType ? 1 : 0, Number(q.bitDepth) || 0, Number(q.bitrate) || 0, Number(it.fileSize) || 0];
  }

  function better(a, b) {
    var x = qualityScore(a), y = qualityScore(b);
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  }

  // byYear splits a duplicate group by year: two 2021 copies next to the
  // 1984 film are a spare copy AND a remake.
  function byYear(entries) {
    var out = {};
    for (var i = 0; i < entries.length; i++) (out[entries[i].year || 0] = out[entries[i].year || 0] || []).push(entries[i]);
    return out;
  }

  // plan: for each year with several copies that have files, the best one to
  // keep and the spares. Series (folders) are never planned.
  function plan(group) {
    var ys = byYear(group.entries);
    var best = {}, spares = [];
    for (var y in ys) {
      var files = ys[y].filter(function (e) { return !!e.filePath; });
      if (files.length < 2) continue;
      var top = files[0];
      for (var i = 1; i < files.length; i++) if (better(files[i], top)) top = files[i];
      best[top.id] = true;
      for (var j = 0; j < files.length; j++) if (files[j] !== top) spares.push(files[j]);
    }
    return { best: best, spares: spares };
  }

  function recoverable(dups) {
    var total = 0;
    for (var i = 0; i < dups.length; i++) {
      var sp = plan(dups[i]).spares;
      for (var j = 0; j < sp.length; j++) total += Number(sp[j].fileSize) || 0;
    }
    return total;
  }

  function button(label, danger, onClick) {
    var b = h("button", BTN + (danger
      ? "border:1px solid var(--danger, #dc2626);color:var(--danger, #dc2626);"
      : "border:1px solid var(--border, rgba(127,127,127,.35));color:var(--accent, #7aa2f7);"), label);
    b.onclick = onClick;
    return b;
  }

  // trash asks Evey to move `targets` (items of `group`); the copy kept is
  // the best of what is left of the group.
  function trash(targets, group) {
    if (!canTrash || targets.length === 0) return;
    var ids = targets.map(function (e) { return e.id; });
    window.evey.media.trash(ids).then(function (res) {
      var ok = (res && res.trashed && res.trashed.length) || 0;
      var ko = (res && res.failed && res.failed.length) || 0;
      if (ok) {
        var gone = {}, waiting = {};
        for (var i = 0; i < res.trashed.length; i++) {
          gone[res.trashed[i].id] = res.trashed[i].trashedPath;
          if (res.trashed[i].pending) { waiting[res.trashed[i].id] = true; pending[res.trashed[i].id] = true; }
        }
        var left = group.entries.filter(function (e) { return !(e.id in gone); });
        var kept = null;
        for (var j = 0; j < left.length; j++) if (!kept || better(left[j], kept)) kept = left[j];
        var freed = 0, moved = [], movedIds = [];
        for (var k = 0; k < targets.length; k++) {
          if (!(targets[k].id in gone)) continue;
          freed += Number(targets[k].fileSize) || 0;
          moved.push(gone[targets[k].id] || targets[k].filePath);
          movedIds.push(targets[k].id);
        }
        recent.unshift({ title: group.title, kept: kept, moved: moved, movedIds: movedIds, freed: freed });
      }
      var nPending = 0;
      for (var w in waiting) nPending++;
      if (ok - nPending > 0) window.evey.toast("success", S.trashed(ok - nPending));
      if (nPending) window.evey.toast("info", S.trashedPending(nPending));
      if (ko) window.evey.toast("error", S.trashFailed(ko) + " : " + res.failed[0].message);
      if (ok) load();
    }).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (msg === "cancelled") return;
      if (msg.indexOf("not permitted") >= 0) {
        canTrash = false;
        window.evey.toast("info", S.trashUnavailable);
        load();
        return;
      }
      window.evey.toast("error", msg);
    });
  }

  function copyRow(it, isBest, state, group) {
    var row = h("div", "display:flex;gap:12px;align-items:center;padding:5px 0;border-top:1px solid var(--border, rgba(127,127,127,.18));");
    var body = h("div", "flex:1;min-width:0;");
    var top = h("div", "display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:13px;");
    top.appendChild(h("span", "", it.year ? String(it.year) : "-"));
    var size = fmtSize(it.fileSize);
    if (size) top.appendChild(h("span", "font-weight:600;", size));
    var ql = qualityLine(it.quality);
    if (ql) top.appendChild(h("span", MUTED, ql));
    if (isBest) top.appendChild(h("span", "font-size:11px;padding:0 6px;border-radius:999px;background:var(--accent, #7aa2f7);color:#fff;", S.best));
    body.appendChild(top);
    var path;
    if (it.filePath) path = it.filePath;
    else if (String(it.type) === "MEDIA_ITEM_TYPE_SERIES") path = S.folder;
    else { path = S.noPath; state.missingPath = true; }
    var p = h("div", "font:11px ui-monospace,SFMono-Regular,Menlo,monospace;" + MUTED +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", path);
    p.title = path;
    body.appendChild(p);
    row.appendChild(body);
    row.appendChild(button(S.open, false, function () { window.evey.navigate("/media/" + it.id); }));
    if (canTrash && it.filePath) row.appendChild(button(S.trashOne, true, function () { trash([it], group); }));
    return row;
  }

  function section(title, count) {
    var box = h("section", "margin:0 0 20px;");
    var head = h("h2", "font-size:14px;font-weight:600;margin:0 0 8px;");
    head.appendChild(h("span", "", title));
    head.appendChild(h("span", "margin-left:8px;font-weight:400;" + MUTED, String(count)));
    box.appendChild(head);
    return box;
  }

  function card() {
    return h("div", "padding:8px 12px;margin:0 0 8px;border-radius:10px;background:var(--surface, rgba(127,127,127,.12));");
  }

  // undo puts the files of one trash action back. The library is scanned by
  // Evey, so the titles return a moment later: the list is read again twice.
  function undo(rec) {
    if (rec.busy || rec.restored) return;
    rec.busy = true;
    load();
    window.evey.media.restore(rec.moved).then(function (res) {
      rec.busy = false;
      var ok = (res && res.restored && res.restored.length) || 0;
      var ko = (res && res.failed && res.failed.length) || 0;
      if (ok) {
        rec.restored = true;
        window.evey.toast("success", S.restored);
      }
      if (ko) window.evey.toast("error", S.restoreFailed(ko, res.failed[0].message));
      load();
      setTimeout(load, 4000);
      setTimeout(load, 12000);
    }).catch(function (err) {
      rec.busy = false;
      window.evey.toast("error", err && err.message ? err.message : String(err));
      load();
    });
  }

  function isPending(rec) {
    for (var i = 0; rec.movedIds && i < rec.movedIds.length; i++) if (pending[rec.movedIds[i]]) return true;
    return false;
  }

  // settle drops from pending the items Evey no longer lists (their copy is
  // whole, the item gone) and reads the list again soon while any remain.
  function settle(items) {
    var listed = {};
    for (var i = 0; i < items.length; i++) listed[items[i].id] = true;
    var any = false;
    for (var id in pending) {
      if (!listed[id]) delete pending[id];
      else any = true;
    }
    clearTimeout(pollTimer);
    if (any) pollTimer = setTimeout(load, 10000);
    return items.filter(function (it) { return !pending[it.id]; });
  }

  // recentBox: what was moved this visit, the copy kept (quality, path, a
  // link) and where the others went. Stays until the page is left.
  function recentBox() {
    var box = h("section", "margin:0 0 20px;padding:10px 12px;border-radius:10px;" +
      "border:1px solid var(--success, #22c55e);background:rgba(34,197,94,.08);");
    box.appendChild(h("h2", "font-size:14px;font-weight:600;margin:0 0 6px;color:var(--success, #22c55e);", "✓ " + S.doneTitle));
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      var entry = h("div", "padding:6px 0;" + (i ? "border-top:1px solid var(--border, rgba(127,127,127,.18));" : ""));
      var top = h("div", "display:flex;gap:10px;align-items:center;");
      top.appendChild(h("div", "flex:1;font-weight:600;", S.doneLine(r.title, r.moved.length, fmtSize(r.freed))));
      if (r.restored) {
        entry.appendChild(top);
        entry.appendChild(h("div", MUTED, S.restored));
        box.appendChild(entry);
        continue;
      }
      var still = isPending(r);
      if (canTrash && !still) top.appendChild(button(r.busy ? S.undoing : S.undo, false, (function (rec) { return function () { undo(rec); }; })(r)));
      entry.appendChild(top);
      if (still) entry.appendChild(h("div", "margin-top:3px;font-size:12px;color:var(--warning, #f59e0b);", S.pendingHint));
      if (r.kept) {
        var kr = h("div", "display:flex;gap:10px;align-items:center;margin-top:3px;");
        var kb = h("div", "flex:1;min-width:0;");
        var line = S.kept + " : " + [r.kept.year, fmtSize(r.kept.fileSize), qualityLine(r.kept.quality)].filter(Boolean).join(" · ");
        kb.appendChild(h("div", "", line));
        var kp = h("div", "font:11px ui-monospace,SFMono-Regular,Menlo,monospace;" + MUTED + "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", r.kept.filePath || "");
        kp.title = r.kept.filePath || "";
        kb.appendChild(kp);
        kr.appendChild(kb);
        kr.appendChild(button(S.open, false, (function (id) { return function () { window.evey.navigate("/media/" + id); }; })(r.kept.id)));
        entry.appendChild(kr);
      } else {
        entry.appendChild(h("div", MUTED, S.keptNone));
      }
      for (var j = 0; j < r.moved.length; j++) {
        var waitingOne = r.movedIds && pending[r.movedIds[j]];
        var mv = h("div", "font:11px ui-monospace,SFMono-Regular,Menlo,monospace;" + MUTED + "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
          S.movedTo + " " + r.moved[j] + (waitingOne ? " (" + S.pendingTag + ")" : ""));
        mv.title = r.moved[j];
        entry.appendChild(mv);
      }
      box.appendChild(entry);
    }
    box.appendChild(h("p", "margin:6px 0 0;font-size:12px;" + MUTED, S.doneHint));
    return box;
  }

  function render(all) {
    var items = settle(all);
    var all = findDuplicates(items);
    var dups = all.filter(function (g) { return !dismissed[dupKey(g)]; });
    var setAside = all.length - dups.length;
    var holes = findSagaHoles(items);
    document.body.innerHTML = "";
    var root = h("div", "max-width:960px;font-size:13px;color:var(--text, #f1f5f9);");
    var summary = S.scanned(items.length);
    var saved = fmtSize(recoverable(dups));
    if (saved) summary += " · " + S.recoverable(saved);
    root.appendChild(h("p", "margin:0 0 14px;" + MUTED, summary));

    if (recent.length) root.appendChild(recentBox());

    var state = { missingPath: false };
    var dupBox = section(S.dupTitle, dups.length);
    if (dups.length === 0) dupBox.appendChild(h("p", "margin:0;" + MUTED, S.none));
    for (var i = 0; i < dups.length; i++) {
      var d = dups[i];
      var pl = plan(d);
      var c = card();
      var head = h("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:2px;");
      head.appendChild(h("strong", "font-size:14px;", d.title));
      head.appendChild(h("span", MUTED, S.copies(d.entries.length)));
      var nd = button(S.notDup, false, (function (key) {
        return function () { dismissed[key] = true; saveDismissed(); load(); };
      })(dupKey(d)));
      nd.style.marginLeft = "auto";
      head.appendChild(nd);
      if (canTrash && pl.spares.length) {
        var keep = button(S.keepBest(pl.spares.length), true, (function (spares, grp) {
          return function () { trash(spares, grp); };
        })(pl.spares, d));
        head.appendChild(keep);
      }
      c.appendChild(head);
      // By year (newest first), then best quality first within a year.
      var sorted = d.entries.slice().sort(function (a, b) {
        var ya = a.year || 0, yb = b.year || 0;
        if (ya !== yb) return yb - ya;
        return better(a, b) ? -1 : better(b, a) ? 1 : 0;
      });
      for (var j = 0; j < sorted.length; j++) c.appendChild(copyRow(sorted[j], !!pl.best[sorted[j].id], state, d));
      dupBox.appendChild(c);
    }
    if (state.missingPath) dupBox.appendChild(h("p", "margin:6px 0 0;font-size:12px;" + MUTED, S.noPathHint));
    if (setAside) {
      var aside = h("p", "margin:6px 0 0;font-size:12px;" + MUTED, S.dismissedLine(setAside) + " · ");
      var again = h("a", "color:var(--accent, #7aa2f7);cursor:pointer;", S.showAll);
      again.onclick = function () { dismissed = {}; saveDismissed(); load(); };
      aside.appendChild(again);
      dupBox.appendChild(aside);
    }
    root.appendChild(dupBox);

    var holeBox = section(S.holeTitle, holes.length);
    if (holes.length === 0) holeBox.appendChild(h("p", "margin:0;" + MUTED, S.none));
    for (var k = 0; k < holes.length; k++) {
      var g = holes[k];
      var hc = card();
      var hr = h("div", "display:flex;gap:12px;align-items:center;");
      var hb = h("div", "flex:1;min-width:0;");
      hb.appendChild(h("strong", "font-size:14px;", g.sample.title));
      hb.appendChild(h("div", MUTED + "margin-top:2px;", S.missing(g.missing) + " · " + S.have(g.have)));
      hr.appendChild(hb);
      hr.appendChild(button(S.open, false, (function (id) { return function () { window.evey.navigate("/media/" + id); }; })(g.sample.id)));
      hc.appendChild(hr);
      holeBox.appendChild(hc);
    }
    root.appendChild(holeBox);
    document.body.appendChild(root);
    fit();
  }

  function load() {
    fetchWatchables(window.evey.media.list).then(render).catch(function (err) {
      // On the admin page a failure is said, never hidden: an empty page
      // would read as "nothing to report".
      document.body.innerHTML = "";
      document.body.appendChild(h("p", "margin:0;color:var(--danger, #dc2626);font-size:13px;", S.failed + (err && err.message ? err.message : String(err))));
      fit();
    });
  }

  window.evey.onInit(function (init) {
    var lang = String(init.locale || "en").slice(0, 2);
    S = STR[lang] || STR.en;
    units = UNITS[lang] || UNITS.en;
    document.body.innerHTML = "";
    document.body.appendChild(h("p", "margin:0;font-size:13px;" + MUTED, S.loading));
    fit();
    window.evey.prefs.get("dismissed").then(function (r) {
      try { (JSON.parse((r && r.value) || "[]") || []).forEach(function (k) { dismissed[k] = true; }); } catch (e) { /* a bad value starts empty */ }
    }).catch(function () {}).then(load);
  });
})();

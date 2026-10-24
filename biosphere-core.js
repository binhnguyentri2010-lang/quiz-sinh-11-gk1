/* ==========================================================================
   BIOSPHERE — CORE DATA, GRADING, STORAGE & BOTANICAL ANATOMY PLATES
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_PREFIX = "biosphere_state_v1_";
  var WN_PREFIX = "BIOSPHERE_WN_V1:";
  var memoryFallback = {};
  var storageWarnShown = false;

  var IMAGE_DIMS = {
    "media/image1.png": { width: 326, height: 287 },
    "media/image2.png": { width: 396, height: 200 },
    "media/image3.png": { width: 999, height: 215 }
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getData() {
    var d = window.BIOSPHERE_DATA;
    if (!d || !Array.isArray(d.lessons)) {
      return { doc_title: "", school_year: "", lessons: [], images_b64: {} };
    }
    return d;
  }

  function getLesson(lessonId) {
    var lessons = getData().lessons;
    for (var i = 0; i < lessons.length; i++) {
      if (lessons[i].id === lessonId) return lessons[i];
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     3-Tier Resilient Storage (localStorage -> sessionStorage -> window.name)
     Survives MPA navigation even when Safari Private / Zalo WebView blocks storage
     -------------------------------------------------------------------------- */
  function readWindowNameMap() {
    try {
      var raw = window.name || "";
      if (raw.indexOf(WN_PREFIX) === 0) {
        var parsed = JSON.parse(raw.slice(WN_PREFIX.length));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (_e) {}
    return {};
  }

  function writeWindowNameMap(mapObj) {
    try {
      window.name = WN_PREFIX + JSON.stringify(mapObj || {});
    } catch (_e) {}
  }

  function createDefaultState(lessonId, firstUid) {
    return {
      version: 1,
      lessonId: lessonId,
      mode: "instant", // "instant" (Phản hồi tức thì) | "exam" (Thi trọn bài)
      currentUid: firstUid || "",
      answers: {},
      checked: {},
      flagged: {},
      submitted: false,
      view: "stage", // "stage" | "results"
      reviewFilter: "all", // "all" | "wrong" | "right"
      drill: null,
      updatedAt: Date.now()
    };
  }

  function sanitizeAnswersMap(rawAnswers, validUids) {
    var clean = {};
    if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
      return clean;
    }
    Object.keys(rawAnswers).forEach(function (uid) {
      var q = validUids[uid];
      if (!q) return;
      var val = rawAnswers[uid];
      if (q.part === "mcq") {
        if (val === "A" || val === "B" || val === "C" || val === "D") {
          clean[uid] = val;
        }
      } else if (q.part === "tf") {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          var cleanTf = {};
          ["a", "b", "c", "d"].forEach(function (k) {
            if (typeof val[k] === "boolean") cleanTf[k] = val[k];
          });
          if (Object.keys(cleanTf).length > 0) clean[uid] = cleanTf;
        }
      } else if (q.part === "short") {
        if (typeof val === "string" || typeof val === "number") {
          var s = String(val).slice(0, 80);
          if (s.length > 0) clean[uid] = s;
        }
      }
    });
    return clean;
  }

  function sanitizeBoolMap(rawMap, validUids) {
    var clean = {};
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      return clean;
    }
    Object.keys(rawMap).forEach(function (uid) {
      if (validUids[uid] && rawMap[uid] === true) clean[uid] = true;
    });
    return clean;
  }

  function sanitizeState(raw, lesson) {
    var firstUid = lesson && lesson.questions && lesson.questions[0] ? lesson.questions[0].uid : "";
    var base = createDefaultState(lesson ? lesson.id : "", firstUid);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;

    var validUids = {};
    if (lesson && Array.isArray(lesson.questions)) {
      for (var i = 0; i < lesson.questions.length; i++) {
        validUids[lesson.questions[i].uid] = lesson.questions[i];
      }
    }

    base.mode = raw.mode === "exam" ? "exam" : "instant";
    base.currentUid = typeof raw.currentUid === "string" && validUids[raw.currentUid] ? raw.currentUid : firstUid;
    base.submitted = Boolean(raw.submitted);
    base.view = raw.view === "results" && base.submitted ? "results" : "stage";
    base.reviewFilter = raw.reviewFilter === "wrong" || raw.reviewFilter === "right" ? raw.reviewFilter : "all";

    base.answers = sanitizeAnswersMap(raw.answers, validUids);
    base.checked = sanitizeBoolMap(raw.checked, validUids);
    base.flagged = sanitizeBoolMap(raw.flagged, validUids);

    if (raw.drill && typeof raw.drill === "object" && !Array.isArray(raw.drill) && Array.isArray(raw.drill.queue)) {
      var cleanQueue = raw.drill.queue.filter(function (uid) {
        return typeof uid === "string" && Boolean(validUids[uid]);
      });
      if (cleanQueue.length > 0) {
        var idx = Number(raw.drill.idx);
        if (!Number.isFinite(idx) || idx < 0 || idx >= cleanQueue.length) idx = 0;
        else idx = Math.floor(idx);
        base.drill = {
          round: Math.max(1, parseInt(raw.drill.round, 10) || 1),
          queue: cleanQueue,
          idx: idx,
          answers: sanitizeAnswersMap(raw.drill.answers, validUids),
          checked: sanitizeBoolMap(raw.drill.checked, validUids),
          masteredTotal: Math.max(0, parseInt(raw.drill.masteredTotal, 10) || 0),
          initialTotal: Math.max(cleanQueue.length, parseInt(raw.drill.initialTotal, 10) || cleanQueue.length)
        };
      }
    }

    return base;
  }

  function loadLessonState(lesson) {
    if (!lesson) return createDefaultState("", "");
    var key = STORAGE_PREFIX + lesson.id;

    try {
      var rawLocal = window.localStorage.getItem(key);
      if (rawLocal) return sanitizeState(JSON.parse(rawLocal), lesson);
    } catch (_e1) {}

    try {
      var rawSession = window.sessionStorage.getItem(key);
      if (rawSession) return sanitizeState(JSON.parse(rawSession), lesson);
    } catch (_e2) {}

    var wnMap = readWindowNameMap();
    if (wnMap[key]) {
      return sanitizeState(wnMap[key], lesson);
    }

    if (memoryFallback[key]) {
      return sanitizeState(memoryFallback[key], lesson);
    }

    return createDefaultState(lesson.id, lesson.questions[0] ? lesson.questions[0].uid : "");
  }

  function saveLessonState(lessonId, state) {
    if (!lessonId || !state) return;
    var key = STORAGE_PREFIX + lessonId;
    state.updatedAt = Date.now();
    memoryFallback[key] = state;
    var serialized = JSON.stringify(state);

    var savedLocal = false;
    try {
      window.localStorage.setItem(key, serialized);
      savedLocal = true;
    } catch (_errLocal) {
      savedLocal = false;
    }

    if (!savedLocal) {
      try {
        window.sessionStorage.setItem(key, serialized);
      } catch (_errSession) {}
      var wnMap = readWindowNameMap();
      wnMap[key] = state;
      writeWindowNameMap(wnMap);

      if (!storageWarnShown && typeof document !== "undefined" && document.body) {
        storageWarnShown = true;
        showToast("Trình duyệt đang tắt lưu trữ cố định — tiến độ vẫn được giữ trong phiên mở tab này.");
      }
    }
  }

  function clearLessonState(lesson) {
    if (!lesson) return createDefaultState("", "");
    var key = STORAGE_PREFIX + lesson.id;
    delete memoryFallback[key];
    try {
      window.localStorage.removeItem(key);
    } catch (_e1) {}
    try {
      window.sessionStorage.removeItem(key);
    } catch (_e2) {}
    var wnMap = readWindowNameMap();
    if (wnMap[key]) {
      delete wnMap[key];
      writeWindowNameMap(wnMap);
    }
    return createDefaultState(lesson.id, lesson.questions[0] ? lesson.questions[0].uid : "");
  }

  /* --------------------------------------------------------------------------
     Exact Question Completion, Short-Answer Normalization & Evaluation Logic
     -------------------------------------------------------------------------- */
  function normalizeShortAnswer(raw, expectedStr) {
    var rawStr = raw == null ? "" : String(raw);
    var trimmed = rawStr.trim();
    var exp = String(expectedStr == null ? "" : expectedStr).trim();

    if (!trimmed) {
      return {
        answered: false,
        rawTrimmed: "",
        normalized: "",
        hasInvalidChars: false
      };
    }

    // Flag letters or HTML symbols (e.g. "4 câu", "<img...>") without mutating input value
    var hasInvalidChars = /[^\d\s.,;:\-+]/.test(trimmed);
    if (hasInvalidChars) {
      return {
        answered: true,
        rawTrimmed: trimmed,
        normalized: trimmed,
        hasInvalidChars: true
      };
    }

    // Strip accidental outer punctuation (such as iOS double-space trailing dot "3.")
    var cleaned = trimmed.replace(/^[.,;:\s]+|[.,;:\s]+$/g, "");
    if (!cleaned) {
      return {
        answered: true,
        rawTrimmed: trimmed,
        normalized: trimmed,
        hasInvalidChars: true
      };
    }

    if (/^-/.test(cleaned)) {
      return {
        answered: true,
        rawTrimmed: trimmed,
        normalized: cleaned,
        hasInvalidChars: false
      };
    }

    if (exp.length > 1) {
      // Multi-digit ordered statement list (e.g. "124", "134"): tolerate spaces/commas/semicolons/hyphens
      if (/^\d+(?:[\s,;-]+\d+)+$/.test(cleaned)) {
        cleaned = cleaned.replace(/[\s,;-]+/g, "");
      } else if (/^\+?\d+$/.test(cleaned)) {
        cleaned = cleaned.replace(/^\+/, "");
      }
      return {
        answered: true,
        rawTrimmed: trimmed,
        normalized: cleaned,
        hasInvalidChars: false
      };
    }

    // Single-digit count ("1".."9"): tolerate optional '+' and leading zero ("06" -> "6"), keep "3.5" intact as wrong
    if (/^\+?\d+$/.test(cleaned)) {
      var noPlus = cleaned.replace(/^\+/, "");
      var noLeadZero = noPlus.replace(/^0+(?=\d)/, "");
      return {
        answered: true,
        rawTrimmed: trimmed,
        normalized: noLeadZero,
        hasInvalidChars: false
      };
    }

    return {
      answered: true,
      rawTrimmed: trimmed,
      normalized: cleaned,
      hasInvalidChars: false
    };
  }

  function countTfPicked(q, ans) {
    if (!q || q.part !== "tf" || !ans || typeof ans !== "object") return 0;
    var stmts = q.statements || [];
    var count = 0;
    for (var i = 0; i < stmts.length; i++) {
      if (typeof ans[stmts[i].key] === "boolean") count++;
    }
    return count;
  }

  function isQuestionAnswered(q, ans) {
    if (!q || ans == null) return false;
    if (q.part === "mcq") {
      return ans === "A" || ans === "B" || ans === "C" || ans === "D";
    }
    if (q.part === "tf") {
      var stmts = q.statements || [];
      return stmts.length > 0 && countTfPicked(q, ans) === stmts.length;
    }
    if (q.part === "short") {
      return String(ans).trim().length > 0;
    }
    return false;
  }

  function hasPartialAnswer(q, ans) {
    if (!q || ans == null) return false;
    if (q.part === "tf") {
      var picked = countTfPicked(q, ans);
      var total = (q.statements || []).length;
      return picked > 0 && picked < total;
    }
    return false;
  }

  function evaluateQuestion(q, ans) {
    var answered = isQuestionAnswered(q, ans);
    if (q.part === "mcq") {
      var isRight = answered && ans === q.answer;
      return {
        answered: answered,
        partial: false,
        isCorrect: isRight,
        userAnswer: answered ? ans : null,
        expectedAnswer: q.answer
      };
    }
    if (q.part === "tf") {
      var stmts = q.statements || [];
      var subCorrect = 0;
      var pickedCount = 0;
      var details = [];
      var obj = ans && typeof ans === "object" ? ans : {};
      for (var i = 0; i < stmts.length; i++) {
        var s = stmts[i];
        var picked = typeof obj[s.key] === "boolean" ? obj[s.key] : null;
        if (picked !== null) pickedCount++;
        var expected = Boolean(s.is_true);
        var match = picked !== null && picked === expected;
        if (match) subCorrect++;
        details.push({
          key: s.key,
          marker: s.marker_verbatim,
          picked: picked,
          expected: expected,
          match: match
        });
      }
      return {
        answered: answered,
        partial: pickedCount > 0 && pickedCount < stmts.length,
        pickedCount: pickedCount,
        isCorrect: answered && subCorrect === stmts.length,
        subCorrect: subCorrect,
        subTotal: stmts.length,
        details: details
      };
    }
    if (q.part === "short") {
      var expectedStr = String(q.answer).trim();
      var norm = normalizeShortAnswer(ans, expectedStr);
      return {
        answered: norm.answered,
        partial: false,
        hasInvalidChars: norm.hasInvalidChars,
        isCorrect: norm.answered && !norm.hasInvalidChars && norm.normalized === expectedStr,
        userAnswer: norm.rawTrimmed,
        normalizedAnswer: norm.normalized,
        expectedAnswer: expectedStr
      };
    }
    return { answered: false, partial: false, isCorrect: false };
  }

  function computeLessonMetrics(lesson, state) {
    var questions = (lesson && lesson.questions) || [];
    var answers = (state && state.answers) || {};
    var checked = (state && state.checked) || {};
    var submitted = Boolean(state && state.submitted);

    var total = questions.length;
    var answeredCount = 0;
    var partialCount = 0;
    var gradedCount = 0;
    var correctTotal = 0;

    var mcqTotal = 0;
    var mcqCorrect = 0;
    var mcqAnswered = 0;

    var tfTotal = 0;
    var tfFullCorrect = 0;
    var tfSubTotal = 0;
    var tfSubCorrect = 0;
    var tfAnswered = 0;
    var tfPartial = 0;

    var shortTotal = 0;
    var shortCorrect = 0;
    var shortAnswered = 0;

    var wrongUids = [];
    var rightUids = [];

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var ans = answers[q.uid];
      var ev = evaluateQuestion(q, ans);
      var isGraded = submitted || Boolean(checked[q.uid]);

      if (ev.answered) answeredCount++;
      else if (ev.partial) partialCount++;
      if (isGraded) gradedCount++;

      if (q.part === "mcq") {
        mcqTotal++;
        if (ev.answered) mcqAnswered++;
        if (ev.isCorrect) mcqCorrect++;
      } else if (q.part === "tf") {
        tfTotal++;
        tfSubTotal += ev.subTotal;
        if (ev.answered) tfAnswered++;
        else if (ev.partial) tfPartial++;
        tfSubCorrect += ev.subCorrect;
        if (ev.isCorrect) tfFullCorrect++;
      } else if (q.part === "short") {
        shortTotal++;
        if (ev.answered) shortAnswered++;
        if (ev.isCorrect) shortCorrect++;
      }

      if (ev.isCorrect) {
        correctTotal++;
        rightUids.push(q.uid);
      } else {
        wrongUids.push(q.uid);
      }
    }

    var subTotalAll = mcqTotal + tfSubTotal + shortTotal;
    var subCorrectTotal = mcqCorrect + tfSubCorrect + shortCorrect;

    var checkedWrongUids = questions
      .filter(function (q) {
        var isGraded = submitted || Boolean(checked[q.uid]);
        if (!isGraded) return false;
        return !evaluateQuestion(q, answers[q.uid]).isCorrect;
      })
      .map(function (q) {
        return q.uid;
      });

    return {
      total: total,
      answeredCount: answeredCount,
      partialCount: partialCount,
      touchedCount: answeredCount + partialCount,
      gradedCount: gradedCount,
      correctTotal: correctTotal,
      subTotalAll: subTotalAll,
      subCorrectTotal: subCorrectTotal,
      mcqTotal: mcqTotal,
      mcqCorrect: mcqCorrect,
      mcqAnswered: mcqAnswered,
      tfTotal: tfTotal,
      tfFullCorrect: tfFullCorrect,
      tfSubTotal: tfSubTotal,
      tfSubCorrect: tfSubCorrect,
      tfAnswered: tfAnswered,
      tfPartial: tfPartial,
      shortTotal: shortTotal,
      shortCorrect: shortCorrect,
      shortAnswered: shortAnswered,
      wrongUids: wrongUids,
      rightUids: rightUids,
      checkedWrongUids: checkedWrongUids
    };
  }

  /* --------------------------------------------------------------------------
     Verbatim Stem Block Renderer (Zero-CLS Intrinsic Image Dimensions)
     -------------------------------------------------------------------------- */
  function renderStemBlocksHtml(q, imagesB64) {
    var blocks = (q && q.stem_blocks) || [];
    var b64Map = imagesB64 || {};
    var out = [];

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b) continue;
      if (b.type === "html") {
        out.push('<p class="stem-p">' + b.html + "</p>");
      } else if (b.type === "table" && Array.isArray(b.rows) && b.rows.length > 0) {
        var tHtml = '<div class="specimen-table-wrap"><table class="specimen-table">';
        tHtml += "<thead><tr>";
        var headRow = b.rows[0] || [];
        for (var c = 0; c < headRow.length; c++) {
          tHtml += '<th scope="col">' + (headRow[c].html || "") + "</th>";
        }
        tHtml += "</tr></thead>";
        if (b.rows.length > 1) {
          tHtml += "<tbody>";
          for (var r = 1; r < b.rows.length; r++) {
            tHtml += "<tr>";
            var row = b.rows[r] || [];
            for (var k = 0; k < row.length; k++) {
              tHtml += "<td>" + (row[k].html || "") + "</td>";
            }
            tHtml += "</tr>";
          }
          tHtml += "</tbody>";
        }
        tHtml += "</table></div>";
        out.push(tHtml);
      } else if (b.type === "image" && b.src) {
        var resolvedSrc = b64Map[b.src] || b.src;
        var dims = IMAGE_DIMS[b.src] || { width: 480, height: 240 };
        var altLabel = escapeHtml((q.label_verbatim || "Sơ đồ") + " - Sơ đồ sinh học");
        out.push(
          '<figure class="specimen-figure">' +
            '<button type="button" class="btn-zoom-image" data-zoom-src="' +
            escapeHtml(resolvedSrc) +
            '" data-zoom-label="' +
            escapeHtml(q.label_verbatim || "Sơ đồ minh họa") +
            '" data-natural-w="' +
            dims.width +
            '" data-natural-h="' +
            dims.height +
            '" aria-label="Phóng to sơ đồ minh họa">' +
            '<img src="' +
            escapeHtml(resolvedSrc) +
            '" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '" alt="' +
            altLabel +
            '" loading="eager" />' +
            '<span class="zoom-caption">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>' +
            "<span>Chạm để soi phóng đại sơ đồ</span>" +
            "</span>" +
            "</button>" +
            "</figure>"
        );
      }
    }
    return out.join("");
  }

  /* --------------------------------------------------------------------------
     Toast & WebView-Safe Share / Synchronous Copy Fallback
     -------------------------------------------------------------------------- */
  var toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById("biosphere-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "biosphere-toast";
      el.className = "biosphere-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 3200);
  }

  function legacyCopySync(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch (_e) {
      return false;
    }
  }

  function showManualCopyModal(urlText) {
    var existing = document.getElementById("biosphere-copy-modal");
    if (existing) existing.remove();

    var wrap = document.createElement("div");
    wrap.id = "biosphere-copy-modal";
    wrap.className = "modal-backdrop";
    wrap.innerHTML =
      '<div class="dialog-card" role="dialog" aria-modal="true" aria-label="Sao chép liên kết chia sẻ">' +
      '<h2 class="dialog-title">Sao chép liên kết</h2>' +
      '<p class="dialog-desc">Chạm giữ ô bên dưới để sao chép liên kết gửi cho bạn bè:</p>' +
      '<input type="text" id="biosphere-manual-url" class="manual-copy-input" readonly value="' +
      escapeHtml(urlText) +
      '" />' +
      '<div class="dialog-actions" style="margin-top:14px;">' +
      '<button type="button" id="btn-close-manual-copy" class="btn-dialog-confirm">Đóng</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(wrap);

    var inp = document.getElementById("biosphere-manual-url");
    if (inp) {
      inp.focus();
      inp.select();
      try {
        inp.setSelectionRange(0, urlText.length);
      } catch (_e) {}
    }
    var closeBtn = document.getElementById("btn-close-manual-copy");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        wrap.remove();
      });
    }
    wrap.addEventListener("click", function (ev) {
      if (ev.target === wrap) wrap.remove();
    });
  }

  function shareLink(opts) {
    var rel = (opts && opts.url) || window.location.href;
    var shareUrl = rel;
    try {
      shareUrl = new URL(rel, window.location.href).href;
    } catch (_e) {}

    var isHttp = /^https?:$/i.test(window.location.protocol);
    var title = (opts && opts.title) || "BIOSPHERE — Ôn tập Sinh học 11 Giữa HKI";
    var text = (opts && opts.text) || title;

    if (!isHttp) {
      // Offline file:// mode: never pass file:// to navigator.share (throws TypeError)
      var publicBase = "https://binhnguyentri2010-lang.github.io/quiz-sinh-11-gk1/";
      var fileSlug = "";
      if (rel && rel.indexOf("bai-1") !== -1) fileSlug = "bai-1.html";
      else if (rel && rel.indexOf("bai-2") !== -1) fileSlug = "bai-2.html";
      else if (rel && rel.indexOf("bai-4") !== -1) fileSlug = "bai-4.html";
      var onlineEquivalent = publicBase + fileSlug;
      var copiedOffline = legacyCopySync(onlineEquivalent);
      if (copiedOffline) {
        showToast("Đã sao chép link web công khai để bạn gửi qua Zalo/Messenger!");
      } else {
        showManualCopyModal(onlineEquivalent);
      }
      return;
    }

    // Native share sheet on mobile Safari / Chrome when available over HTTPS
    if (window.isSecureContext && navigator.share && typeof navigator.share === "function") {
      // Also capture synchronous copy backup is NOT needed unless share fails, but mobile share sheet is primary
      navigator
        .share({ title: title, text: text, url: shareUrl })
        .then(function () {
          showToast("Đã mở bảng chia sẻ liên kết.");
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(shareUrl).then(
              function () {
                showToast("Đã sao chép liên kết vào bộ nhớ tạm!");
              },
              function () {
                showManualCopyModal(shareUrl);
              }
            );
          } else {
            showManualCopyModal(shareUrl);
          }
        });
      return;
    }

    // Synchronous copy FIRST inside user click gesture so Zalo/Messenger iOS WebView never loses transient activation
    var syncCopied = legacyCopySync(shareUrl);
    if (syncCopied) {
      showToast("Đã sao chép liên kết để bạn gửi nhanh!");
      return;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(shareUrl).then(
        function () {
          showToast("Đã sao chép liên kết để bạn gửi nhanh!");
        },
        function () {
          showManualCopyModal(shareUrl);
        }
      );
      return;
    }

    showManualCopyModal(shareUrl);
  }

  /* --------------------------------------------------------------------------
     Bespoke Biological Specimen Anatomy SVGs (Transplanted & Refined from V1)
     -------------------------------------------------------------------------- */
  function getBotanicalSvg(lessonId) {
    if (lessonId === "bai-1") {
      // Plant Cell Wall, Vacuole, Mitochondrion Cristae, Chloroplast & ATP Cycle
      return (
        '<svg viewBox="16 16 268 116" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Minh họa tế bào thực vật, ti thể, lục lạp và chu trình năng lượng ATP">' +
        '<path d="M92 24 H196 L224 54 V96 L196 124 H92 L64 96 V54 Z" fill="#FBF9F3" stroke="#123C32" stroke-width="1.7"/>' +
        '<path d="M96 30 H192 L217 57 V93 L192 118 H96 L71 93 V57 Z" fill="#F5F1E6" stroke="#123C32" stroke-width="1" stroke-dasharray="3 2"/>' +
        '<ellipse cx="116" cy="74" rx="22" ry="28" fill="#E9F3CF" stroke="#123C32" stroke-width="1.2"/>' +
        '<circle cx="116" cy="58" r="6" fill="#B7D96A" stroke="#123C32" stroke-width="1.1"/>' +
        '<ellipse cx="176" cy="54" rx="24" ry="12" transform="rotate(-12 176 54)" fill="#FCECE6" stroke="#123C32" stroke-width="1.3"/>' +
        '<path d="M158 56 C163 48, 166 60, 171 51 C176 44, 179 59, 184 50 C188 45, 191 55, 195 50" stroke="#E98261" stroke-width="1.4" fill="none"/>' +
        '<ellipse cx="174" cy="95" rx="23" ry="11" transform="rotate(8 174 95)" fill="#B7D96A" fill-opacity="0.5" stroke="#123C32" stroke-width="1.3"/>' +
        '<line x1="162" y1="93" x2="170" y2="93" stroke="#123C32" stroke-width="1.5"/>' +
        '<line x1="162" y1="96" x2="170" y2="96" stroke="#123C32" stroke-width="1.5"/>' +
        '<line x1="176" y1="94" x2="185" y2="94" stroke="#123C32" stroke-width="1.5"/>' +
        '<line x1="176" y1="97" x2="185" y2="97" stroke="#123C32" stroke-width="1.5"/>' +
        '<path d="M30 52 H58" stroke="#123C32" stroke-width="1.5"/>' +
        '<polygon points="61,52 54,48 54,56" fill="#123C32"/>' +
        '<path d="M226 96 H260" stroke="#E98261" stroke-width="1.5"/>' +
        '<polygon points="264,96 257,92 257,100" fill="#E98261"/>' +
        '<circle cx="254" cy="48" r="19" fill="#123C32"/>' +
        '<circle cx="254" cy="48" r="15.5" fill="none" stroke="#B7D96A" stroke-width="1" stroke-dasharray="2 2"/>' +
        '<text x="254" y="52.5" text-anchor="middle" fill="#B7D96A" font-family="Georgia, serif" font-size="12.5" font-weight="700">ATP</text>' +
        '<path d="M204 48 C216 40, 226 40, 234 45" stroke="#E98261" stroke-width="1.4" fill="none"/>' +
        '<text x="24" y="44" fill="#24312B" font-family="sans-serif" font-size="12" font-weight="700">O₂</text>' +
        '<text x="232" y="117" fill="#24312B" font-family="sans-serif" font-size="12" font-weight="700">CO₂</text>' +
        "</svg>"
      );
    }
    if (lessonId === "bai-2") {
      // Botanical Leaf Venation & Magnified Xylem/Phloem Vascular Bundle Cross-Section
      return (
        '<svg viewBox="16 18 268 118" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Minh họa hệ gân lá và bó mạch gỗ - mạch rây vận chuyển nước khoáng">' +
        '<path d="M36 116 C42 64, 82 26, 152 24 C146 84, 108 118, 36 116 Z" fill="#E9F3CF" stroke="#123C32" stroke-width="1.7"/>' +
        '<path d="M24 126 C48 104, 96 68, 150 25" stroke="#123C32" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path d="M66 94 C65 76, 72 62, 84 52" stroke="#123C32" stroke-width="1.2"/>' +
        '<path d="M88 76 C89 60, 97 48, 110 39" stroke="#123C32" stroke-width="1.2"/>' +
        '<path d="M112 56 C115 45, 122 37, 132 32" stroke="#123C32" stroke-width="1.1"/>' +
        '<path d="M74 88 C92 90, 108 84, 121 74" stroke="#123C32" stroke-width="1.2"/>' +
        '<path d="M98 68 C113 70, 125 65, 136 56" stroke="#123C32" stroke-width="1.1"/>' +
        '<circle cx="88" cy="76" r="5.5" fill="none" stroke="#E98261" stroke-width="1.6"/>' +
        '<line x1="94" y1="75" x2="176" y2="62" stroke="#E98261" stroke-width="1.2" stroke-dasharray="3 2"/>' +
        '<circle cx="222" cy="72" r="42" fill="#FBF9F3" stroke="#123C32" stroke-width="1.7"/>' +
        '<circle cx="222" cy="72" r="37" fill="none" stroke="#123C32" stroke-width="0.9" stroke-dasharray="2 2"/>' +
        '<path d="M185 72 H259" stroke="#123C32" stroke-width="1.2"/>' +
        '<circle cx="206" cy="55" r="6.8" fill="#B7D96A" stroke="#123C32" stroke-width="1.3"/>' +
        '<circle cx="222" cy="50" r="8.2" fill="#B7D96A" stroke="#123C32" stroke-width="1.3"/>' +
        '<circle cx="238" cy="55" r="6.8" fill="#B7D96A" stroke="#123C32" stroke-width="1.3"/>' +
        '<circle cx="215" cy="65" r="4.2" fill="#F5F1E6" stroke="#123C32" stroke-width="1.1"/>' +
        '<circle cx="229" cy="65" r="4.2" fill="#F5F1E6" stroke="#123C32" stroke-width="1.1"/>' +
        '<circle cx="208" cy="87" r="5.3" fill="#FCECE6" stroke="#E98261" stroke-width="1.3"/>' +
        '<circle cx="222" cy="90" r="5.8" fill="#FCECE6" stroke="#E98261" stroke-width="1.3"/>' +
        '<circle cx="236" cy="87" r="5.3" fill="#FCECE6" stroke="#E98261" stroke-width="1.3"/>' +
        '<text x="222" y="129" text-anchor="middle" fill="#123C32" font-family="sans-serif" font-size="12" font-weight="700">H₂O · Khoáng</text>' +
        "</svg>"
      );
    }
    // bai-4: Chloroplast Double Envelope, Thylakoid Grana Stacks & Light Spectrum Rays
    return (
      '<svg viewBox="16 14 268 118" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Minh họa lục lạp, chồng túi thylakoid grana và quang phổ ánh sáng">' +
      '<line x1="26" y1="24" x2="94" y2="62" stroke="#E98261" stroke-width="1.9"/>' +
      '<line x1="22" y1="36" x2="88" y2="68" stroke="#123C32" stroke-width="1.3" stroke-dasharray="4 2"/>' +
      '<line x1="34" y1="18" x2="102" y2="57" stroke="#B7D96A" stroke-width="1.9"/>' +
      '<circle cx="30" cy="26" r="8" fill="#E98261" fill-opacity="0.24" stroke="#E98261" stroke-width="1.3"/>' +
      '<ellipse cx="164" cy="82" rx="94" ry="42" fill="#FBF9F3" stroke="#123C32" stroke-width="1.8"/>' +
      '<ellipse cx="164" cy="82" rx="87" ry="36" fill="#E9F3CF" stroke="#123C32" stroke-width="1.1"/>' +
      '<line x1="118" y1="76" x2="210" y2="76" stroke="#123C32" stroke-width="1.3"/>' +
      '<line x1="118" y1="88" x2="210" y2="88" stroke="#123C32" stroke-width="1.3"/>' +
      '<g fill="#B7D96A" stroke="#123C32" stroke-width="1.25">' +
      '<rect x="102" y="64" width="28" height="7" rx="3.5"/>' +
      '<rect x="102" y="73" width="28" height="7" rx="3.5"/>' +
      '<rect x="102" y="82" width="28" height="7" rx="3.5"/>' +
      '<rect x="102" y="91" width="28" height="7" rx="3.5"/>' +
      '<rect x="150" y="59" width="28" height="7" rx="3.5"/>' +
      '<rect x="150" y="68" width="28" height="7" rx="3.5"/>' +
      '<rect x="150" y="77" width="28" height="7" rx="3.5"/>' +
      '<rect x="150" y="86" width="28" height="7" rx="3.5"/>' +
      '<rect x="150" y="95" width="28" height="7" rx="3.5"/>' +
      '<rect x="198" y="66" width="28" height="7" rx="3.5"/>' +
      '<rect x="198" y="75" width="28" height="7" rx="3.5"/>' +
      '<rect x="198" y="84" width="28" height="7" rx="3.5"/>' +
      "</g>" +
      '<text x="218" y="34" fill="#123C32" font-family="Georgia, serif" font-size="12.5" font-weight="700">CO₂ → O₂</text>' +
      "</svg>"
    );
  }

  window.BIOSPHERE_CORE = {
    escapeHtml: escapeHtml,
    getData: getData,
    getLesson: getLesson,
    loadLessonState: loadLessonState,
    saveLessonState: saveLessonState,
    clearLessonState: clearLessonState,
    normalizeShortAnswer: normalizeShortAnswer,
    countTfPicked: countTfPicked,
    isQuestionAnswered: isQuestionAnswered,
    hasPartialAnswer: hasPartialAnswer,
    evaluateQuestion: evaluateQuestion,
    computeLessonMetrics: computeLessonMetrics,
    renderStemBlocksHtml: renderStemBlocksHtml,
    shareLink: shareLink,
    showToast: showToast,
    getBotanicalSvg: getBotanicalSvg
  };
})();

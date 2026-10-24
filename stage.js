/* ==========================================================================
   BIOSPHERE — SPECIMEN FOCUS STAGE & RAPID REFLEX DECK ENGINE
   Used by: bai-1.html, bai-2.html, bai-4.html
   ========================================================================== */
(function () {
  "use strict";

  var CORE = window.BIOSPHERE_CORE;
  if (!CORE) return;

  var lessonId = document.body.getAttribute("data-lesson-id") || "bai-1";
  var data = CORE.getData();
  var lesson = CORE.getLesson(lessonId);
  if (!lesson) return;

  var questionMap = {};
  var partBuckets = { mcq: [], tf: [], short: [] };
  (lesson.questions || []).forEach(function (q) {
    questionMap[q.uid] = q;
    if (partBuckets[q.part]) partBuckets[q.part].push(q);
  });

  var state = CORE.loadLessonState(lesson);
  var transientHint = "";
  var highlightMissingTf = false;
  var resetConfirmPending = false;
  var resetConfirmTimer = null;
  var lastFocusedBeforeModal = null;
  var currentLightboxNatW = 0;
  var currentLightboxNatH = 0;

  /* --------------------------------------------------------------------------
     DOM References
     -------------------------------------------------------------------------- */
  var dom = {
    lessonCodeTag: document.getElementById("lesson-code-tag"),
    lessonDesktopTitle: document.getElementById("lesson-desktop-title"),
    stageCounter: document.getElementById("stage-counter"),
    btnShareTop: document.getElementById("btn-share-top"),
    btnMapTrigger: document.getElementById("btn-map-trigger"),
    mapTriggerLabel: document.getElementById("map-trigger-label"),
    leafVeinFill: document.getElementById("leaf-vein-fill"),
    leafVeinTrack: document.getElementById("leaf-vein-track"),
    stageSubbar: document.getElementById("stage-subbar"),
    partPillsWrap: document.getElementById("part-pills"),
    modeSwitchWrap: document.getElementById("mode-switch-group"),
    drillBanner: document.getElementById("drill-banner"),
    drillBannerText: document.getElementById("drill-banner-text"),
    btnExitDrill: document.getElementById("btn-exit-drill"),
    focusMain: document.getElementById("focus-main"),
    resultsContainer: document.getElementById("results-container"),
    reflexDock: document.getElementById("reflex-dock"),
    btnPrev: document.getElementById("btn-prev-q"),
    btnNext: document.getElementById("btn-next-q"),
    btnPrimaryReflex: document.getElementById("btn-primary-reflex"),

    // Drawer
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    drawerTitle: document.getElementById("drawer-title"),
    btnCloseDrawer: document.getElementById("btn-close-drawer"),
    drawerBody: document.getElementById("drawer-body"),
    btnSubmitDrawer: document.getElementById("btn-submit-drawer"),
    btnResetDrawer: document.getElementById("btn-reset-drawer"),

    // Generic Dialog Modal
    dialogBackdrop: document.getElementById("dialog-backdrop"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogDesc: document.getElementById("dialog-desc"),
    btnDialogCancel: document.getElementById("btn-dialog-cancel"),
    btnDialogConfirm: document.getElementById("btn-dialog-confirm"),

    // Image Lightbox Zoom Modal
    lightboxBackdrop: document.getElementById("lightbox-backdrop"),
    lightboxTitle: document.getElementById("lightbox-title"),
    lightboxViewport: document.getElementById("lightbox-viewport"),
    lightboxImg: document.getElementById("lightbox-img"),
    lightboxHint: document.getElementById("lightbox-hint"),
    btnCloseLightbox: document.getElementById("btn-close-lightbox")
  };

  var activeDialogCallback = null;
  var activeCancelCallback = null;

  /* --------------------------------------------------------------------------
     Modal Body Scroll Lock & Focus Restoration
     -------------------------------------------------------------------------- */
  function anyOverlayOpen() {
    return Boolean(
      (dom.drawerBackdrop && !dom.drawerBackdrop.hidden) ||
        (dom.dialogBackdrop && !dom.dialogBackdrop.hidden) ||
        (dom.lightboxBackdrop && !dom.lightboxBackdrop.hidden)
    );
  }

  function syncBodyScrollLock() {
    document.body.style.overflow = anyOverlayOpen() ? "hidden" : "";
  }

  function captureFocusOrigin() {
    if (!anyOverlayOpen() && document.activeElement && document.activeElement !== document.body) {
      lastFocusedBeforeModal = document.activeElement;
    }
  }

  function restoreFocusOrigin() {
    syncBodyScrollLock();
    if (!anyOverlayOpen() && lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      try {
        if (document.contains(lastFocusedBeforeModal)) {
          lastFocusedBeforeModal.focus();
        }
      } catch (_e) {}
      lastFocusedBeforeModal = null;
    }
  }

  /* --------------------------------------------------------------------------
     Helpers for Active Deck (Normal 27/30 Deck vs Focused Wrong Drill)
     -------------------------------------------------------------------------- */
  function isDrillActive() {
    return Boolean(state.drill && Array.isArray(state.drill.queue) && state.drill.queue.length > 0);
  }

  function getActiveQuestions() {
    if (isDrillActive()) {
      return state.drill.queue
        .map(function (uid) {
          return questionMap[uid];
        })
        .filter(Boolean);
    }
    return lesson.questions || [];
  }

  function getCurrentIndex(activeQs) {
    if (!activeQs.length) return 0;
    if (isDrillActive()) {
      var idx = state.drill.idx || 0;
      if (idx < 0 || idx >= activeQs.length) idx = 0;
      return idx;
    }
    for (var i = 0; i < activeQs.length; i++) {
      if (activeQs[i].uid === state.currentUid) return i;
    }
    state.currentUid = activeQs[0].uid;
    return 0;
  }

  function getActiveAnswer(uid) {
    if (isDrillActive()) {
      return state.drill.answers[uid];
    }
    return state.answers[uid];
  }

  function setActiveAnswer(uid, val) {
    if (isDrillActive()) {
      state.drill.answers[uid] = val;
    } else {
      state.answers[uid] = val;
    }
  }

  function isQuestionGradedInCurrentContext(uid) {
    if (isDrillActive()) {
      return Boolean(state.drill.checked[uid]);
    }
    if (state.submitted) return true;
    if (state.mode === "instant" && state.checked[uid]) return true;
    return false;
  }

  function persist() {
    CORE.saveLessonState(lesson.id, state);
  }

  /* --------------------------------------------------------------------------
     Leaf-Vein Boundary Nodes Setup
     -------------------------------------------------------------------------- */
  function renderLeafVeinNodes() {
    if (!dom.leafVeinTrack) return;
    var oldNodes = dom.leafVeinTrack.querySelectorAll(".vein-node");
    for (var i = 0; i < oldNodes.length; i++) {
      oldNodes[i].remove();
    }
    if (isDrillActive()) return;

    var total = (lesson.questions || []).length;
    if (total <= 0) return;
    var p1End = partBuckets.mcq.length;
    var p2End = p1End + partBuckets.tf.length;

    var m = CORE.computeLessonMetrics(lesson, state);
    var boundaries = [p1End, p2End, total];

    boundaries.forEach(function (count) {
      var pct = Math.min(100, Math.round((count / total) * 100));
      var dot = document.createElement("span");
      dot.className = "vein-node" + (m.answeredCount >= count ? " is-reached" : "");
      dot.style.left = pct + "%";
      dom.leafVeinTrack.appendChild(dot);
    });
  }

  /* --------------------------------------------------------------------------
     Topbar & Subbar Update
     -------------------------------------------------------------------------- */
  function updateChrome() {
    var m = CORE.computeLessonMetrics(lesson, state);
    var activeQs = getActiveQuestions();
    var idx = getCurrentIndex(activeQs);

    if (dom.lessonCodeTag) {
      dom.lessonCodeTag.textContent = "Bài " + lesson.number;
    }
    if (dom.lessonDesktopTitle) {
      dom.lessonDesktopTitle.textContent = lesson.title_short || lesson.title_full || "";
    }
    if (dom.drawerTitle) {
      dom.drawerTitle.textContent = "Bản đồ " + m.total + " câu · " + (lesson.title_full || "Bài " + lesson.number);
    }

    if (state.view === "results") {
      if (dom.stageCounter) dom.stageCounter.textContent = "Kết quả · " + m.total + " câu";
      if (dom.leafVeinFill) {
        var rPct = m.total > 0 ? Math.round((m.answeredCount / m.total) * 100) : 0;
        dom.leafVeinFill.style.width = rPct + "%";
      }
      if (dom.mapTriggerLabel) {
        dom.mapTriggerLabel.textContent = "Bản đồ (" + m.answeredCount + "/" + m.total + ")";
      }
      renderLeafVeinNodes();
      return;
    }

    if (isDrillActive()) {
      var d = state.drill;
      var drillAnswered = 0;
      d.queue.forEach(function (u) {
        if (CORE.isQuestionAnswered(questionMap[u], d.answers[u])) drillAnswered++;
      });
      var dPct = d.queue.length > 0 ? Math.round((drillAnswered / d.queue.length) * 100) : 0;
      if (dom.stageCounter) {
        dom.stageCounter.textContent = "Luyện sai " + (idx + 1) + " / " + d.queue.length;
      }
      if (dom.leafVeinFill) dom.leafVeinFill.style.width = dPct + "%";
      if (dom.mapTriggerLabel) {
        dom.mapTriggerLabel.textContent = "Bản đồ (" + drillAnswered + "/" + d.queue.length + ")";
      }
    } else {
      var pct = m.total > 0 ? Math.round((m.answeredCount / m.total) * 100) : 0;
      if (dom.stageCounter) {
        dom.stageCounter.textContent = "Câu " + (idx + 1) + " / " + m.total;
      }
      if (dom.leafVeinFill) dom.leafVeinFill.style.width = pct + "%";
      if (dom.mapTriggerLabel) {
        dom.mapTriggerLabel.textContent = "Bản đồ (" + m.answeredCount + "/" + m.total + ")";
      }
    }

    renderLeafVeinNodes();
    renderSubbar(m, activeQs[idx]);
    updateReflexDock(activeQs, idx);
  }

  function renderSubbar(metrics, currentQ) {
    if (!dom.stageSubbar) return;

    if (isDrillActive()) {
      dom.stageSubbar.hidden = true;
      if (dom.drillBanner) {
        dom.drillBanner.hidden = false;
        var d = state.drill;
        if (dom.drillBannerText) {
          dom.drillBannerText.textContent =
            "Vòng " +
            d.round +
            " · Luyện riêng " +
            d.queue.length +
            " câu chưa thuộc (Đã gỡ " +
            d.masteredTotal +
            "/" +
            d.initialTotal +
            " câu)";
        }
      }
      return;
    }

    if (dom.drillBanner) dom.drillBanner.hidden = true;
    dom.stageSubbar.hidden = false;

    if (dom.partPillsWrap) {
      var curPart = currentQ ? currentQ.part : "mcq";
      var pillsData = [
        { key: "mcq", label: "Phần I (" + metrics.mcqAnswered + "/" + metrics.mcqTotal + ")" },
        { key: "tf", label: "Phần II (" + metrics.tfAnswered + "/" + metrics.tfTotal + ")" },
        { key: "short", label: "Phần III (" + metrics.shortAnswered + "/" + metrics.shortTotal + ")" }
      ];
      dom.partPillsWrap.innerHTML = pillsData
        .map(function (p) {
          return (
            '<button type="button" class="part-pill' +
            (curPart === p.key ? " is-active" : "") +
            '" data-jump-part="' +
            p.key +
            '">' +
            p.label +
            "</button>"
          );
        })
        .join("");
    }

    if (dom.modeSwitchWrap) {
      if (state.submitted) {
        dom.modeSwitchWrap.innerHTML =
          '<button type="button" class="mode-btn is-active" data-open-results="1">Xem bảng kết quả</button>';
      } else {
        dom.modeSwitchWrap.innerHTML =
          '<button type="button" class="mode-btn' +
          (state.mode === "instant" ? " is-active" : "") +
          '" data-set-mode="instant" aria-pressed="' +
          (state.mode === "instant" ? "true" : "false") +
          '">Tức thì</button>' +
          '<button type="button" class="mode-btn' +
          (state.mode === "exam" ? " is-active" : "") +
          '" data-set-mode="exam" aria-pressed="' +
          (state.mode === "exam" ? "true" : "false") +
          '">Trọn bài</button>';
      }
    }

    var inlineSubBtn = document.getElementById("btn-submit-inline");
    if (inlineSubBtn) {
      inlineSubBtn.hidden = Boolean(state.submitted);
    }
  }

  /* --------------------------------------------------------------------------
     Reflex Bottom Dock Update
     -------------------------------------------------------------------------- */
  function updateReflexDock(activeQs, idx) {
    if (!dom.reflexDock || state.view === "results") return;
    var q = activeQs[idx];
    if (!q) return;

    var isLast = idx >= activeQs.length - 1;
    if (dom.btnPrev) dom.btnPrev.disabled = idx <= 0;
    if (dom.btnNext) dom.btnNext.disabled = isLast;

    if (!dom.btnPrimaryReflex) return;
    dom.btnPrimaryReflex.className = "btn-reflex-primary";

    var graded = isQuestionGradedInCurrentContext(q.uid);
    var ans = getActiveAnswer(q.uid);
    var answered = CORE.isQuestionAnswered(q, ans);

    if (isDrillActive()) {
      if (!graded) {
        dom.btnPrimaryReflex.textContent = "Kiểm tra câu này";
        if (answered) dom.btnPrimaryReflex.classList.add("is-sprout");
      } else if (!isLast) {
        dom.btnPrimaryReflex.textContent = "Câu sai tiếp theo →";
        dom.btnPrimaryReflex.classList.add("is-sprout");
      } else {
        dom.btnPrimaryReflex.textContent = "Tổng kết vòng luyện";
        dom.btnPrimaryReflex.classList.add("is-coral");
      }
      return;
    }

    if (state.submitted) {
      if (!isLast) {
        dom.btnPrimaryReflex.textContent = "Câu tiếp theo →";
      } else {
        dom.btnPrimaryReflex.textContent = "Về màn hình kết quả";
        dom.btnPrimaryReflex.classList.add("is-sprout");
      }
      return;
    }

    if (state.mode === "instant") {
      if (!graded) {
        dom.btnPrimaryReflex.textContent = "Kiểm tra đáp án";
        if (answered) dom.btnPrimaryReflex.classList.add("is-sprout");
      } else if (!isLast) {
        dom.btnPrimaryReflex.textContent = "Câu tiếp theo →";
        dom.btnPrimaryReflex.classList.add("is-sprout");
      } else {
        dom.btnPrimaryReflex.textContent = "Nộp bài & Xem tổng kết";
        dom.btnPrimaryReflex.classList.add("is-coral");
      }
    } else {
      if (!isLast) {
        dom.btnPrimaryReflex.textContent = answered ? "Lưu & Sang câu tiếp →" : "Câu tiếp theo →";
        if (answered) dom.btnPrimaryReflex.classList.add("is-sprout");
      } else {
        dom.btnPrimaryReflex.textContent = "Nộp bài & Chấm điểm";
        dom.btnPrimaryReflex.classList.add("is-coral");
      }
    }
  }

  /* --------------------------------------------------------------------------
     Render Active Question on Focus Stage
     -------------------------------------------------------------------------- */
  function renderQuestionStage() {
    if (!dom.focusMain) return;
    var activeQs = getActiveQuestions();
    var idx = getCurrentIndex(activeQs);
    var q = activeQs[idx];
    if (!q) return;

    var graded = isQuestionGradedInCurrentContext(q.uid);
    var ans = getActiveAnswer(q.uid);
    var ev = CORE.evaluateQuestion(q, ans);
    var isFlagged = Boolean(state.flagged[q.uid]);

    var interactionHtml = "";
    if (q.part === "mcq") {
      interactionHtml = renderMcqOptions(q, ans, graded);
    } else if (q.part === "tf") {
      interactionHtml = renderTfStatements(q, ans, graded);
    } else if (q.part === "short") {
      interactionHtml = renderShortInput(q, ans, graded, ev);
    }

    var hintHtml = "";
    if (transientHint) {
      hintHtml = '<div class="inline-hint-alert" role="alert">' + CORE.escapeHtml(transientHint) + "</div>";
    }

    var feedbackHtml = "";
    if (graded) {
      feedbackHtml = renderFeedbackBanner(q, ev);
    }

    var kbdHintRight =
      q.part === "mcq"
        ? '<span>Chọn nhanh: <kbd class="kbd-chip">A–D</kbd> hoặc <kbd class="kbd-chip">1–4</kbd></span>'
        : q.part === "short"
          ? '<span>Nhập số rồi nhấn <kbd class="kbd-chip">Enter</kbd></span>'
          : '<span>Chọn đủ 4 mệnh đề rồi nhấn <kbd class="kbd-chip">Enter</kbd></span>';

    dom.focusMain.innerHTML =
      '<article class="specimen-card" data-question-uid="' +
      CORE.escapeHtml(q.uid) +
      '">' +
      '<div class="specimen-card-head">' +
      '<div class="specimen-meta-left">' +
      '<span class="part-label-chip">' +
      CORE.escapeHtml(q.part_title) +
      "</span>" +
      "</div>" +
      '<button type="button" class="btn-flag' +
      (isFlagged ? " is-flagged" : "") +
      '" id="btn-toggle-flag" aria-pressed="' +
      (isFlagged ? "true" : "false") +
      '">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="' +
      (isFlagged ? "currentColor" : "none") +
      '" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
      "<span>" +
      (isFlagged ? "Đã đánh dấu" : "Đánh dấu") +
      "</span>" +
      "</button>" +
      "</div>" +
      '<div class="question-label-verbatim">' +
      CORE.escapeHtml(q.label_verbatim) +
      "</div>" +
      '<div class="question-stem">' +
      CORE.renderStemBlocksHtml(q, data.images_b64) +
      "</div>" +
      interactionHtml +
      hintHtml +
      feedbackHtml +
      "</article>" +
      '<div class="desktop-kbd-bar" aria-hidden="true">' +
      kbdHintRight +
      '<span>Chuyển câu: <kbd class="kbd-chip">←</kbd> <kbd class="kbd-chip">→</kbd> · Hành động chính: <kbd class="kbd-chip">Enter</kbd></span>' +
      "</div>";
  }

  function renderMcqOptions(q, ans, graded) {
    var opts = q.options || [];
    var rows = opts.map(function (opt) {
      var selected = ans === opt.key;
      var cls = ["mcq-option"];
      var stateTag = "";
      var badgeLabel = opt.prefix_verbatim || opt.key + ".";

      if (graded) {
        if (opt.key === q.answer) {
          cls.push("is-correct");
          stateTag = '<span class="mcq-state-tag">' + (selected ? "Bạn chọn · Đúng" : "Đáp án đúng") + "</span>";
        } else if (selected) {
          cls.push("is-wrong");
          stateTag = '<span class="mcq-state-tag">Bạn chọn · Sai</span>';
        }
      } else if (selected) {
        cls.push("is-selected");
      }

      return (
        '<button type="button" class="' +
        cls.join(" ") +
        '" data-mcq-key="' +
        CORE.escapeHtml(opt.key) +
        '" aria-pressed="' +
        (selected ? "true" : "false") +
        '"' +
        (graded ? " disabled" : "") +
        ">" +
        '<span class="mcq-key-badge">' +
        CORE.escapeHtml(badgeLabel) +
        "</span>" +
        '<span class="mcq-option-body">' +
        opt.html +
        "</span>" +
        stateTag +
        "</button>"
      );
    });
    return '<div class="mcq-list" role="group" aria-label="Các lựa chọn trả lời">' + rows.join("") + "</div>";
  }

  function renderTfStatements(q, ans, graded) {
    var obj = ans && typeof ans === "object" ? ans : {};
    var stmts = q.statements || [];

    var cards = stmts.map(function (s) {
      var picked = typeof obj[s.key] === "boolean" ? obj[s.key] : null;
      var expected = Boolean(s.is_true);
      var cardCls = ["tf-card"];
      var verdictHtml = "";

      if (graded) {
        var isMatch = picked !== null && picked === expected;
        cardCls.push(isMatch ? "is-graded-right" : "is-graded-wrong");
        var pickedWord = picked === true ? "Đúng" : picked === false ? "Sai" : "Chưa chọn";
        var expWord = expected ? "Đúng" : "Sai";
        verdictHtml =
          '<div class="tf-verdict-note">' +
          (isMatch
            ? "Chính xác (" + expWord + ")"
            : "Bạn chọn: " + pickedWord + " · Đáp án chuẩn: " + expWord) +
          "</div>";
      } else if (highlightMissingTf && picked === null) {
        cardCls.push("is-missing-warning");
      }

      var trueBtnCls = ["tf-choice-btn"];
      var falseBtnCls = ["tf-choice-btn"];

      if (graded) {
        if (picked === true) {
          trueBtnCls.push(expected === true ? "is-correct-pick" : "is-wrong-pick");
        } else if (expected === true) {
          trueBtnCls.push("is-actual-answer");
        }

        if (picked === false) {
          falseBtnCls.push(expected === false ? "is-correct-pick" : "is-wrong-pick");
        } else if (expected === false) {
          falseBtnCls.push("is-actual-answer");
        }
      } else {
        if (picked === true) trueBtnCls.push("is-selected");
        if (picked === false) falseBtnCls.push("is-selected");
      }

      return (
        '<div class="' +
        cardCls.join(" ") +
        '">' +
        '<div class="tf-statement-row">' +
        '<span class="tf-marker">' +
        CORE.escapeHtml(s.marker_verbatim) +
        "</span>" +
        '<div class="tf-statement-text">' +
        s.html +
        verdictHtml +
        "</div>" +
        "</div>" +
        '<div class="tf-controls-wrap">' +
        '<div class="tf-dual-bar" role="group" aria-label="Mệnh đề ' +
        CORE.escapeHtml(s.marker_verbatim) +
        '">' +
        '<button type="button" class="' +
        trueBtnCls.join(" ") +
        '" data-tf-key="' +
        CORE.escapeHtml(s.key) +
        '" data-tf-val="true" aria-pressed="' +
        (picked === true ? "true" : "false") +
        '"' +
        (graded ? " disabled" : "") +
        ">Đúng</button>" +
        '<button type="button" class="' +
        falseBtnCls.join(" ") +
        '" data-tf-key="' +
        CORE.escapeHtml(s.key) +
        '" data-tf-val="false" aria-pressed="' +
        (picked === false ? "true" : "false") +
        '"' +
        (graded ? " disabled" : "") +
        ">Sai</button>" +
        "</div>" +
        "</div>" +
        "</div>"
      );
    });

    return '<div class="tf-list">' + cards.join("") + "</div>";
  }

  function renderShortInput(q, ans, graded, ev) {
    var valStr = ans == null ? "" : String(ans);
    var inputCls = ["short-numeric-input"];
    if (graded) {
      inputCls.push(ev.isCorrect ? "is-correct" : "is-wrong");
    }
    var normCheck = CORE.normalizeShortAnswer(valStr, q.answer);
    var showInvalidWarn = !graded && normCheck.hasInvalidChars;
    var placeholderText = String(q.answer).length > 1 ? "Ví dụ: 124" : "Ví dụ: 4";

    return (
      '<div class="short-answer-box">' +
      '<label class="short-label" for="short-answer-input">Nhập đáp số của bạn (chỉ cần nhập chữ số):</label>' +
      '<div class="short-input-row">' +
      '<input type="text" id="short-answer-input" class="' +
      inputCls.join(" ") +
      '" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="64" placeholder="' +
      placeholderText +
      '" value="' +
      CORE.escapeHtml(valStr) +
      '"' +
      (graded ? " readonly" : "") +
      " />" +
      (!graded
        ? '<button type="button" id="btn-clear-short" class="btn-clear-short"' +
          (valStr.length === 0 ? " hidden" : "") +
          ">Xóa</button>"
        : "") +
      "</div>" +
      '<div id="short-format-warn" class="short-format-warn" role="alert"' +
      (showInvalidWarn ? "" : " hidden") +
      ">Chỉ nhập các chữ số (ví dụ: 4 hoặc 124), không kèm chữ cái hay ký hiệu lạ.</div>" +
      "</div>"
    );
  }

  function renderRetrySingleActionHtml(ev) {
    if (state.submitted || isDrillActive() || state.mode !== "instant" || ev.isCorrect) {
      return "";
    }
    return (
      '<div class="feedback-actions-row">' +
      '<button type="button" class="btn-retry-single" data-retry-single="1">Thử lại câu này</button>' +
      "</div>"
    );
  }

  function renderFeedbackBanner(q, ev) {
    var retryBtnHtml = renderRetrySingleActionHtml(ev);

    if (q.part === "mcq") {
      if (ev.isCorrect) {
        return (
          '<div class="feedback-banner is-right" role="status">' +
          '<div class="feedback-headline">Chính xác! Đáp án chuẩn là ' +
          CORE.escapeHtml(q.answer) +
          ".</div>" +
          "</div>"
        );
      }
      var pickedTxt = ev.userAnswer ? "Bạn đã chọn " + CORE.escapeHtml(ev.userAnswer) + " · " : "Bạn chưa chọn đáp án · ";
      return (
        '<div class="feedback-banner is-wrong" role="status">' +
        '<div class="feedback-headline">Chưa chính xác</div>' +
        '<div class="feedback-detail">' +
        pickedTxt +
        "Đáp án đúng của câu này là <strong>" +
        CORE.escapeHtml(q.answer) +
        "</strong>.</div>" +
        retryBtnHtml +
        "</div>"
      );
    }

    if (q.part === "tf") {
      if (ev.isCorrect) {
        return (
          '<div class="feedback-banner is-right" role="status">' +
          '<div class="feedback-headline">Chính xác trọn vẹn 4/4 mệnh đề!</div>' +
          "</div>"
        );
      }
      var rightPattern = (q.statements || [])
        .map(function (s) {
          return s.key + ": " + (s.is_true ? "Đúng" : "Sai");
        })
        .join(" · ");
      return (
        '<div class="feedback-banner is-wrong" role="status">' +
        '<div class="feedback-headline">Đúng ' +
        ev.subCorrect +
        "/" +
        ev.subTotal +
        " mệnh đề</div>" +
        '<div class="feedback-detail">Đáp án chuẩn: <strong>' +
        CORE.escapeHtml(rightPattern) +
        "</strong></div>" +
        retryBtnHtml +
        "</div>"
      );
    }

    if (q.part === "short") {
      if (ev.isCorrect) {
        return (
          '<div class="feedback-banner is-right" role="status">' +
          '<div class="feedback-headline">Chính xác! Đáp số chuẩn là ' +
          CORE.escapeHtml(ev.expectedAnswer) +
          ".</div>" +
          "</div>"
        );
      }
      var uTxt = ev.userAnswer ? '"' + CORE.escapeHtml(ev.userAnswer) + '"' : "(Bỏ trống)";
      return (
        '<div class="feedback-banner is-wrong" role="status">' +
        '<div class="feedback-headline">Chưa khớp đáp số</div>' +
        '<div class="feedback-detail">Bạn nhập: ' +
        uTxt +
        " · Đáp án chuẩn: <strong>" +
        CORE.escapeHtml(ev.expectedAnswer) +
        "</strong></div>" +
        retryBtnHtml +
        "</div>"
      );
    }
    return "";
  }

  /* --------------------------------------------------------------------------
     Results View Renderer (Mobile-Stacked TF Review — Zero 64px Column Crush!)
     -------------------------------------------------------------------------- */
  function renderResultsView() {
    if (!dom.resultsContainer) return;
    var m = CORE.computeLessonMetrics(lesson, state);
    var wrongCount = m.wrongUids.length;
    var rightCount = m.rightUids.length;

    var filter = state.reviewFilter || "all";
    var filteredQs = (lesson.questions || []).filter(function (q) {
      var isRight = CORE.evaluateQuestion(q, state.answers[q.uid]).isCorrect;
      if (filter === "wrong") return !isRight;
      if (filter === "right") return isRight;
      return true;
    });

    var reviewCards = [];
    if (filteredQs.length === 0) {
      reviewCards.push(
        '<div class="empty-review-box">' +
          (filter === "wrong"
            ? "Tuyệt vời! Bạn không còn câu sai nào trong danh mục này."
            : "Chưa có câu hỏi nào trong bộ lọc này.") +
          "</div>"
      );
    } else {
      filteredQs.forEach(function (q) {
        var ev = CORE.evaluateQuestion(q, state.answers[q.uid]);
        var statusText = ev.isCorrect
          ? "Đúng trọn vẹn"
          : ev.answered
            ? q.part === "tf"
              ? "Chưa trọn vẹn (" + ev.subCorrect + "/4 ý)"
              : "Chưa đúng"
            : ev.partial
              ? "Làm dở (" + ev.pickedCount + "/4 ý)"
              : "Chưa trả lời";

        var detailCompare = "";
        if (q.part === "mcq") {
          var rightOpt = (q.options || []).find(function (o) {
            return o.key === q.answer;
          });
          var pickedOpt = (q.options || []).find(function (o) {
            return o.key === ev.userAnswer;
          });
          var pPref = pickedOpt ? pickedOpt.prefix_verbatim || pickedOpt.key + "." : "";
          var rPref = rightOpt ? rightOpt.prefix_verbatim || rightOpt.key + "." : "";
          detailCompare =
            '<div class="review-compare-box">' +
            "<div><strong>Bạn chọn:</strong> " +
            (pickedOpt ? CORE.escapeHtml(pPref + " ") + pickedOpt.html : "<em>Bỏ trống</em>") +
            "</div>" +
            "<div><strong>Đáp án chuẩn:</strong> " +
            (rightOpt ? CORE.escapeHtml(rPref + " ") + rightOpt.html : CORE.escapeHtml(q.answer)) +
            "</div>" +
            "</div>";
        } else if (q.part === "tf") {
          var tfItems = (q.statements || [])
            .map(function (s, idxS) {
              var dItem = ev.details[idxS];
              var pStr = dItem.picked === true ? "Đúng" : dItem.picked === false ? "Sai" : "Bỏ trống";
              var eStr = dItem.expected ? "Đúng" : "Sai";
              return (
                '<div class="review-tf-row">' +
                '<div class="review-tf-stmt">' +
                '<span class="review-tf-marker">' +
                CORE.escapeHtml(s.marker_verbatim) +
                "</span>" +
                '<div class="review-tf-text">' +
                s.html +
                "</div>" +
                "</div>" +
                '<div class="review-tf-verdict ' +
                (dItem.match ? "is-match" : "is-mismatch") +
                '">' +
                "Bạn: " +
                pStr +
                " · Chuẩn: " +
                eStr +
                "</div>" +
                "</div>"
              );
            })
            .join("");
          detailCompare =
            '<div class="review-compare-box">' +
            "<div><strong>Kết quả mệnh đề:</strong> Đúng " +
            ev.subCorrect +
            "/4 ý</div>" +
            '<div class="review-tf-list">' +
            tfItems +
            "</div>" +
            "</div>";
        } else if (q.part === "short") {
          detailCompare =
            '<div class="review-compare-box">' +
            "<div><strong>Bạn nhập:</strong> " +
            (ev.userAnswer ? CORE.escapeHtml(ev.userAnswer) : "<em>Bỏ trống</em>") +
            "</div>" +
            "<div><strong>Đáp số chuẩn:</strong> " +
            CORE.escapeHtml(ev.expectedAnswer) +
            "</div>" +
            "</div>";
        }

        reviewCards.push(
          '<article class="review-item ' +
            (ev.isCorrect ? "is-right" : "is-wrong") +
            '">' +
            '<div class="review-item-head">' +
            '<span class="part-label-chip">' +
            CORE.escapeHtml(q.part_title) +
            "</span>" +
            '<span class="review-status-pill ' +
            (ev.isCorrect ? "pill-right" : "pill-wrong") +
            '">' +
            CORE.escapeHtml(statusText) +
            "</span>" +
            "</div>" +
            '<div class="question-label-verbatim">' +
            CORE.escapeHtml(q.label_verbatim) +
            "</div>" +
            '<div class="question-stem" style="margin-bottom:10px;">' +
            CORE.renderStemBlocksHtml(q, data.images_b64) +
            "</div>" +
            detailCompare +
            "</article>"
        );
      });
    }

    dom.resultsContainer.innerHTML =
      '<section class="results-hero">' +
      '<p class="results-eyebrow">BÁO CÁO TIÊU BẢN · BÀI ' +
      lesson.number +
      "</p>" +
      '<h1 class="results-title">' +
      CORE.escapeHtml(lesson.title_full) +
      "</h1>" +
      '<p class="results-summary-line">' +
      (wrongCount === 0
        ? "Xuất sắc! Bạn đã trả lời đúng trọn vẹn 100% (" +
          m.total +
          "/" +
          m.total +
          " câu · " +
          m.subCorrectTotal +
          "/" +
          m.subTotalAll +
          " ý) của bài này."
        : "Đúng trọn vẹn " +
          m.correctTotal +
          "/" +
          m.total +
          " câu (Tổng số ý đúng: " +
          m.subCorrectTotal +
          "/" +
          m.subTotalAll +
          " ý). Bạn hãy bấm Luyện lại riêng câu sai để gỡ sạch các câu nhầm trước giờ kiểm tra!") +
      "</p>" +
      '<div class="results-metrics-grid">' +
      '<div class="metric-box">' +
      '<div class="metric-label">Câu đúng trọn vẹn</div>' +
      '<div class="metric-val">' +
      m.correctTotal +
      " / " +
      m.total +
      "</div>" +
      '<div class="metric-sub">Tổng ý đúng: ' +
      m.subCorrectTotal +
      "/" +
      m.subTotalAll +
      "</div>" +
      "</div>" +
      '<div class="metric-box">' +
      '<div class="metric-label">Phần I · 4 lựa chọn</div>' +
      '<div class="metric-val">' +
      m.mcqCorrect +
      " / " +
      m.mcqTotal +
      "</div>" +
      '<div class="metric-sub">Câu trắc nghiệm ABCD</div>' +
      "</div>" +
      '<div class="metric-box">' +
      '<div class="metric-label">Phần II · Đúng/Sai</div>' +
      '<div class="metric-val">' +
      m.tfSubCorrect +
      " / " +
      m.tfSubTotal +
      " ý</div>" +
      '<div class="metric-sub">Trọn 4 ý: ' +
      m.tfFullCorrect +
      " / " +
      m.tfTotal +
      " câu</div>" +
      "</div>" +
      '<div class="metric-box">' +
      '<div class="metric-label">Phần III · Trả lời ngắn</div>' +
      '<div class="metric-val">' +
      m.shortCorrect +
      " / " +
      m.shortTotal +
      "</div>" +
      '<div class="metric-sub">Điền đáp số chính xác</div>' +
      "</div>" +
      "</div>" +
      '<div class="results-cta-bar">' +
      (wrongCount > 0
        ? '<button type="button" class="btn-retry-wrong-hero" id="btn-start-wrong-drill">' +
          "Luyện lại riêng " +
          wrongCount +
          " câu sai" +
          "</button>"
        : '<button type="button" class="btn-retry-wrong-hero" id="btn-start-wrong-drill" disabled>Đã thuộc 100% câu hỏi!</button>') +
      '<button type="button" class="btn-secondary-hero" id="btn-back-to-stage">Soi lại từng câu</button>' +
      '<button type="button" class="btn-secondary-hero" id="btn-restart-fresh">Làm lại từ đầu</button>' +
      '<a class="btn-secondary-hero" href="./index.html" style="display:inline-flex;align-items:center;">← Về sảnh BIOSPHERE</a>' +
      "</div>" +
      "</section>" +
      '<div class="review-filter-bar">' +
      '<div class="filter-tabs" role="tablist" aria-label="Bộ lọc xem lại câu hỏi">' +
      '<button type="button" class="filter-tab' +
      (filter === "all" ? " is-active" : "") +
      '" data-review-filter="all">Tất cả (' +
      m.total +
      ")</button>" +
      '<button type="button" class="filter-tab' +
      (filter === "wrong" ? " is-active" : "") +
      '" data-review-filter="wrong">Câu sai (' +
      wrongCount +
      ")</button>" +
      '<button type="button" class="filter-tab' +
      (filter === "right" ? " is-active" : "") +
      '" data-review-filter="right">Câu đúng (' +
      rightCount +
      ")</button>" +
      "</div>" +
      "</div>" +
      '<div class="review-list">' +
      reviewCards.join("") +
      "</div>";
  }

  /* --------------------------------------------------------------------------
     Master Render Orchestrator
     -------------------------------------------------------------------------- */
  function renderApp() {
    if (state.view === "results" && state.submitted) {
      if (dom.stageSubbar) dom.stageSubbar.hidden = true;
      if (dom.drillBanner) dom.drillBanner.hidden = true;
      if (dom.focusMain) dom.focusMain.hidden = true;
      if (dom.reflexDock) dom.reflexDock.hidden = true;
      if (dom.resultsContainer) {
        dom.resultsContainer.hidden = false;
        renderResultsView();
      }
      updateChrome();
      return;
    }

    if (dom.resultsContainer) dom.resultsContainer.hidden = true;
    if (dom.focusMain) dom.focusMain.hidden = false;
    if (dom.reflexDock) dom.reflexDock.hidden = false;

    updateChrome();
    renderQuestionStage();
    if (dom.drawerBackdrop && !dom.drawerBackdrop.hidden) {
      renderDrawerMap();
    }
  }

  /* --------------------------------------------------------------------------
     Drawer Map Renderer
     -------------------------------------------------------------------------- */
  function renderDrawerMap() {
    if (!dom.drawerBody) return;
    var activeQs = getActiveQuestions();
    var curIdx = getCurrentIndex(activeQs);
    var curUid = activeQs[curIdx] ? activeQs[curIdx].uid : "";

    if (isDrillActive()) {
      var d = state.drill;
      var cells = d.queue
        .map(function (uid, i) {
          var q = questionMap[uid];
          if (!q) return "";
          var ans = d.answers[uid];
          var graded = Boolean(d.checked[uid]);
          var ev = CORE.evaluateQuestion(q, ans);
          var cls = ["map-cell"];
          if (uid === curUid) cls.push("is-current");
          if (graded) {
            cls.push(ev.isCorrect ? "is-right" : "is-wrong");
          } else if (ev.answered) {
            cls.push("is-answered");
          } else if (ev.partial) {
            cls.push("is-partial");
          }
          return (
            '<button type="button" class="' +
            cls.join(" ") +
            '" data-map-idx="' +
            i +
            '">' +
            (i + 1) +
            (state.flagged[uid] ? '<span class="map-flag-dot" aria-hidden="true"></span>' : "") +
            "</button>"
          );
        })
        .join("");

      dom.drawerBody.innerHTML =
        '<div class="drawer-part-group">' +
        '<h3 class="drawer-part-title">Vòng ' +
        d.round +
        " · Danh sách câu sai đang luyện (" +
        d.queue.length +
        " câu)</h3>" +
        '<div class="drawer-grid">' +
        cells +
        "</div>" +
        "</div>";

      if (dom.btnSubmitDrawer) dom.btnSubmitDrawer.textContent = "Tổng kết vòng luyện câu sai";
      return;
    }

    var groups = [
      { key: "mcq", title: "PHẦN I. Trắc nghiệm 4 lựa chọn", items: partBuckets.mcq },
      { key: "tf", title: "PHẦN II. Trắc nghiệm Đúng/Sai", items: partBuckets.tf },
      { key: "short", title: "PHẦN III. Trả lời ngắn", items: partBuckets.short }
    ];

    var html = groups
      .map(function (g) {
        var btns = g.items
          .map(function (q) {
            var ans = state.answers[q.uid];
            var graded = state.submitted || (state.mode === "instant" && state.checked[q.uid]);
            var ev = CORE.evaluateQuestion(q, ans);
            var cls = ["map-cell"];
            if (q.uid === curUid && state.view === "stage") cls.push("is-current");
            if (graded) {
              cls.push(ev.isCorrect ? "is-right" : "is-wrong");
            } else if (ev.answered) {
              cls.push("is-answered");
            } else if (ev.partial) {
              cls.push("is-partial");
            }
            return (
              '<button type="button" class="' +
              cls.join(" ") +
              '" data-map-uid="' +
              CORE.escapeHtml(q.uid) +
              '" aria-label="' +
              CORE.escapeHtml(q.part_title + " - Câu " + q.number) +
              '">' +
              q.number +
              (state.flagged[q.uid] ? '<span class="map-flag-dot" aria-hidden="true"></span>' : "") +
              "</button>"
            );
          })
          .join("");
        return (
          '<div class="drawer-part-group">' +
          '<h3 class="drawer-part-title">' +
          CORE.escapeHtml(g.title) +
          "</h3>" +
          '<div class="drawer-grid">' +
          btns +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    dom.drawerBody.innerHTML = html;
    if (dom.btnSubmitDrawer) {
      dom.btnSubmitDrawer.textContent = state.submitted ? "Xem màn hình kết quả" : "Nộp bài & Xem tổng kết";
    }
  }

  function openDrawer() {
    if (!dom.drawerBackdrop) return;
    captureFocusOrigin();
    resetConfirmPending = false;
    updateResetButtonLabel();
    renderDrawerMap();
    dom.drawerBackdrop.hidden = false;
    syncBodyScrollLock();
    if (dom.btnCloseDrawer) dom.btnCloseDrawer.focus();
  }

  function closeDrawer() {
    if (!dom.drawerBackdrop) return;
    dom.drawerBackdrop.hidden = true;
    restoreFocusOrigin();
  }

  function updateResetButtonLabel() {
    if (!dom.btnResetDrawer) return;
    if (resetConfirmPending) {
      dom.btnResetDrawer.textContent = "Bấm lần nữa để xóa dữ liệu bài này";
      dom.btnResetDrawer.classList.add("is-confirming");
    } else {
      dom.btnResetDrawer.textContent = "Làm mới bài này từ đầu";
      dom.btnResetDrawer.classList.remove("is-confirming");
    }
  }

  /* --------------------------------------------------------------------------
     Navigation, Checking, Submission & Retry-Wrong Mastery Loop
     -------------------------------------------------------------------------- */
  function goToQuestionIndex(newIdx) {
    var activeQs = getActiveQuestions();
    if (newIdx < 0 || newIdx >= activeQs.length) return;
    transientHint = "";
    highlightMissingTf = false;

    if (isDrillActive()) {
      state.drill.idx = newIdx;
    } else {
      state.currentUid = activeQs[newIdx].uid;
    }
    state.view = "stage";
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function checkCurrentQuestion() {
    var activeQs = getActiveQuestions();
    var idx = getCurrentIndex(activeQs);
    var q = activeQs[idx];
    if (!q) return;

    var ans = getActiveAnswer(q.uid);
    if (!CORE.isQuestionAnswered(q, ans)) {
      if (q.part === "tf") {
        highlightMissingTf = true;
        transientHint = "Bạn hãy chọn Đúng hoặc Sai cho đủ cả 4 mệnh đề a, b, c, d trước khi kiểm tra nhé.";
      } else if (q.part === "short") {
        transientHint = "Bạn hãy nhập đáp số vào ô trống trước khi bấm Kiểm tra nhé.";
      } else {
        transientHint = "Bạn hãy chọn 1 phương án A, B, C hoặc D trước khi bấm Kiểm tra nhé.";
      }
      renderQuestionStage();
      if (q.part === "short") {
        var inp = document.getElementById("short-answer-input");
        if (inp) inp.focus();
      }
      return;
    }

    if (q.part === "short") {
      var normCheck = CORE.normalizeShortAnswer(ans, q.answer);
      if (normCheck.hasInvalidChars) {
        transientHint = "Đáp số chỉ gồm chữ số (ví dụ: 4 hoặc 124). Bạn hãy bỏ chữ cái hoặc ký hiệu thừa trước khi chấm nhé.";
        renderQuestionStage();
        var inpInvalid = document.getElementById("short-answer-input");
        if (inpInvalid) inpInvalid.focus();
        return;
      }
    }

    transientHint = "";
    highlightMissingTf = false;

    if (isDrillActive()) {
      state.drill.checked[q.uid] = true;
      var ev = CORE.evaluateQuestion(q, ans);
      if (ev.isCorrect) {
        state.answers[q.uid] = JSON.parse(JSON.stringify(ans));
        state.checked[q.uid] = true;
        state.drill.masteredTotal = (state.drill.masteredTotal || 0) + 1;
      }
    } else {
      state.checked[q.uid] = true;
    }

    persist();
    renderApp();
  }

  function handlePrimaryReflexAction() {
    var activeQs = getActiveQuestions();
    var idx = getCurrentIndex(activeQs);
    var q = activeQs[idx];
    if (!q) return;

    var isLast = idx >= activeQs.length - 1;
    var graded = isQuestionGradedInCurrentContext(q.uid);

    if (isDrillActive()) {
      if (!graded) {
        checkCurrentQuestion();
      } else if (!isLast) {
        goToQuestionIndex(idx + 1);
      } else {
        finishDrillRound();
      }
      return;
    }

    if (state.submitted) {
      if (!isLast) {
        goToQuestionIndex(idx + 1);
      } else {
        state.view = "results";
        persist();
        renderApp();
        window.scrollTo({ top: 0, behavior: "auto" });
      }
      return;
    }

    if (state.mode === "instant") {
      if (!graded) {
        checkCurrentQuestion();
      } else if (!isLast) {
        goToQuestionIndex(idx + 1);
      } else {
        requestSubmitExam();
      }
    } else {
      if (!isLast) {
        goToQuestionIndex(idx + 1);
      } else {
        requestSubmitExam();
      }
    }
  }

  function requestSubmitExam() {
    closeDrawer();
    if (state.submitted) {
      state.view = "results";
      persist();
      renderApp();
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    var m = CORE.computeLessonMetrics(lesson, state);
    var remaining = m.total - m.answeredCount;

    if (remaining > 0) {
      var partialNote =
        m.partialCount > 0
          ? " (trong đó có " + m.partialCount + " câu Đúng/Sai mới chọn dở chưa đủ 4 mệnh đề)"
          : "";
      openDialog({
        title: "Còn " + remaining + " câu chưa hoàn thành",
        desc:
          "Bạn đã hoàn thành " +
          m.answeredCount +
          "/" +
          m.total +
          " câu của Bài " +
          lesson.number +
          partialNote +
          ". Các câu hoặc mệnh đề bỏ trống sẽ tính là chưa đúng khi chấm điểm. Bạn muốn nộp bài ngay hay quay lại làm tiếp?",
        cancelText: "Quay lại làm tiếp",
        confirmText: "Nộp bài ngay",
        onConfirm: finalizeSubmitExam
      });
      return;
    }

    finalizeSubmitExam();
  }

  function finalizeSubmitExam() {
    state.drill = null;
    state.submitted = true;
    (lesson.questions || []).forEach(function (q) {
      state.checked[q.uid] = true;
    });
    state.view = "results";
    state.reviewFilter = "all";
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function startWrongDrill(wrongUids) {
    if (!Array.isArray(wrongUids) || wrongUids.length === 0) {
      CORE.showToast("Bạn đã làm đúng 100%, không còn câu sai nào!");
      return;
    }
    transientHint = "";
    highlightMissingTf = false;
    state.drill = {
      round: 1,
      queue: wrongUids.slice(),
      idx: 0,
      answers: {},
      checked: {},
      masteredTotal: 0,
      initialTotal: wrongUids.length
    };
    state.view = "stage";
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: "auto" });
    CORE.showToast("Bắt đầu luyện riêng " + wrongUids.length + " câu sai cho đến khi thuộc 100%!");
  }

  function finishDrillRound() {
    if (!isDrillActive()) return;
    var d = state.drill;

    var uncheckedIdx = -1;
    for (var i = 0; i < d.queue.length; i++) {
      if (!d.checked[d.queue[i]]) {
        uncheckedIdx = i;
        break;
      }
    }
    if (uncheckedIdx !== -1) {
      openDialog({
        title: "Còn câu chưa kiểm tra trong vòng này",
        desc: "Bạn vẫn còn câu chưa bấm Kiểm tra trong vòng luyện câu sai. Bạn muốn chuyển tới câu đó để làm nốt không?",
        cancelText: "Thoát về kết quả",
        confirmText: "Làm nốt câu còn lại",
        onConfirm: function () {
          goToQuestionIndex(uncheckedIdx);
        },
        onCancel: exitDrillToResults
      });
      return;
    }

    var stillWrong = d.queue.filter(function (uid) {
      var q = questionMap[uid];
      return !CORE.evaluateQuestion(q, d.answers[uid]).isCorrect;
    });

    if (stillWrong.length === 0) {
      state.drill = null;
      state.submitted = true;
      state.view = "results";
      state.reviewFilter = "all";
      persist();
      renderApp();
      window.scrollTo({ top: 0, behavior: "auto" });
      CORE.showToast("Chúc mừng bạn! Đã gỡ sạch 100% câu sai!");
      return;
    }

    var masteredThisRound = d.queue.length - stillWrong.length;
    var nextRound = d.round + 1;

    openDialog({
      title: "Kết thúc Vòng " + d.round + ": Còn " + stillWrong.length + " câu cần nhớ lại",
      desc:
        "Bạn vừa trả lời đúng " +
        masteredThisRound +
        "/" +
        d.queue.length +
        " câu trong vòng này. Hãy bước sang Vòng " +
        nextRound +
        " với " +
        stillWrong.length +
        " câu còn nhầm để thuộc trọn vẹn 100% nhé!",
      cancelText: "Tạm dừng xem kết quả",
      confirmText: "Tiếp tục Vòng " + nextRound + " (" + stillWrong.length + " câu)",
      onConfirm: function () {
        state.drill = {
          round: nextRound,
          queue: stillWrong,
          idx: 0,
          answers: {},
          checked: {},
          masteredTotal: d.masteredTotal || 0,
          initialTotal: d.initialTotal || d.queue.length
        };
        state.view = "stage";
        persist();
        renderApp();
        window.scrollTo({ top: 0, behavior: "auto" });
      },
      onCancel: exitDrillToResults
    });
  }

  function exitDrillToResults() {
    state.drill = null;
    state.view = state.submitted ? "results" : "stage";
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* --------------------------------------------------------------------------
     Accessible Dialog & 3-Level Specimen Lightbox Zoom
     -------------------------------------------------------------------------- */
  function openDialog(cfg) {
    if (!dom.dialogBackdrop) return;
    captureFocusOrigin();
    if (dom.dialogTitle) dom.dialogTitle.textContent = cfg.title || "";
    if (dom.dialogDesc) dom.dialogDesc.textContent = cfg.desc || "";
    if (dom.btnDialogCancel) dom.btnDialogCancel.textContent = cfg.cancelText || "Hủy";
    if (dom.btnDialogConfirm) dom.btnDialogConfirm.textContent = cfg.confirmText || "Đồng ý";
    activeDialogCallback = cfg.onConfirm || null;
    activeCancelCallback = cfg.onCancel || null;
    dom.dialogBackdrop.hidden = false;
    syncBodyScrollLock();
    if (dom.btnDialogConfirm) dom.btnDialogConfirm.focus();
  }

  function closeDialog(runCancel) {
    if (!dom.dialogBackdrop) return;
    dom.dialogBackdrop.hidden = true;
    var cancelFn = activeCancelCallback;
    activeDialogCallback = null;
    activeCancelCallback = null;
    restoreFocusOrigin();
    if (runCancel && typeof cancelFn === "function") cancelFn();
  }

  function applyLightboxZoom(mode) {
    if (!dom.lightboxViewport || !dom.lightboxImg || !dom.lightboxBackdrop) return;
    var btns = dom.lightboxBackdrop.querySelectorAll("[data-lightbox-zoom]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("is-active", btns[i].getAttribute("data-lightbox-zoom") === mode);
    }

    var natW = currentLightboxNatW || dom.lightboxImg.naturalWidth || 640;
    if (mode === "fit") {
      dom.lightboxViewport.classList.remove("is-scrollable");
      dom.lightboxImg.style.width = "";
      dom.lightboxImg.style.maxWidth = "100%";
      if (dom.lightboxHint) {
        dom.lightboxHint.textContent = "Chọn \"Gốc 100%\" hoặc \"180%\" để kéo soi chi tiết các ký hiệu nhỏ.";
      }
    } else if (mode === "actual") {
      dom.lightboxViewport.classList.add("is-scrollable");
      dom.lightboxImg.style.maxWidth = "none";
      dom.lightboxImg.style.width = Math.max(natW, 560) + "px";
      if (dom.lightboxHint) {
        dom.lightboxHint.textContent = "Đang hiển thị kích thước gốc rõ nét — vuốt ngang để xem trọn sơ đồ.";
      }
    } else if (mode === "zoom180") {
      dom.lightboxViewport.classList.add("is-scrollable");
      dom.lightboxImg.style.maxWidth = "none";
      dom.lightboxImg.style.width = Math.round(Math.max(natW, 480) * 1.65) + "px";
      if (dom.lightboxHint) {
        dom.lightboxHint.textContent = "Đang phóng đại 180% — vuốt ngang/dọc để soi chi tiết.";
      }
    }
  }

  function openLightbox(src, label, natW, natH) {
    if (!dom.lightboxBackdrop || !dom.lightboxImg) return;
    captureFocusOrigin();
    currentLightboxNatW = parseInt(natW, 10) || 0;
    currentLightboxNatH = parseInt(natH, 10) || 0;

    if (currentLightboxNatW > 0 && currentLightboxNatH > 0) {
      dom.lightboxImg.setAttribute("width", String(currentLightboxNatW));
      dom.lightboxImg.setAttribute("height", String(currentLightboxNatH));
    }
    dom.lightboxImg.src = src;
    dom.lightboxImg.alt = label || "Sơ đồ phóng to";
    if (dom.lightboxTitle) dom.lightboxTitle.textContent = (label || "Sơ đồ") + " — Soi chi tiết";

    dom.lightboxBackdrop.hidden = false;
    syncBodyScrollLock();

    // Auto-open wide strip diagrams (such as 999x215 image3.png) at full natural size on narrow phones (< 640px)
    var w = currentLightboxNatW || dom.lightboxImg.naturalWidth || 0;
    var h = currentLightboxNatH || dom.lightboxImg.naturalHeight || 0;
    if (window.innerWidth < 640 && w > 520 && h > 0 && w / h > 2.0) {
      applyLightboxZoom("actual");
    } else {
      applyLightboxZoom("fit");
    }

    if (dom.lightboxViewport) {
      dom.lightboxViewport.scrollLeft = 0;
      dom.lightboxViewport.scrollTop = 0;
    }
    if (dom.btnCloseLightbox) dom.btnCloseLightbox.focus();
  }

  function closeLightbox() {
    if (!dom.lightboxBackdrop) return;
    dom.lightboxBackdrop.hidden = true;
    if (dom.lightboxImg) {
      dom.lightboxImg.removeAttribute("src");
      dom.lightboxImg.removeAttribute("width");
      dom.lightboxImg.removeAttribute("height");
      dom.lightboxImg.style.width = "";
      dom.lightboxImg.style.maxWidth = "";
    }
    restoreFocusOrigin();
  }

  /* --------------------------------------------------------------------------
     Event Listeners & Desktop Keyboard Reflex Shortcuts
     -------------------------------------------------------------------------- */
  function bindEvents() {
    if (dom.btnShareTop) {
      dom.btnShareTop.addEventListener("click", function () {
        CORE.shareLink({
          url: "./" + lesson.slug,
          title: lesson.title_full + " — BIOSPHERE Sinh học 11",
          text: "Ôn tập " + lesson.title_full + " (Sinh học 11 Giữa HKI):"
        });
      });
    }

    if (dom.btnMapTrigger) {
      dom.btnMapTrigger.addEventListener("click", openDrawer);
    }
    if (dom.btnCloseDrawer) {
      dom.btnCloseDrawer.addEventListener("click", closeDrawer);
    }
    if (dom.drawerBackdrop) {
      dom.drawerBackdrop.addEventListener("click", function (ev) {
        if (ev.target === dom.drawerBackdrop) closeDrawer();
      });
    }
    if (dom.btnSubmitDrawer) {
      dom.btnSubmitDrawer.addEventListener("click", function () {
        if (isDrillActive()) {
          closeDrawer();
          finishDrillRound();
        } else {
          requestSubmitExam();
        }
      });
    }
    if (dom.btnResetDrawer) {
      dom.btnResetDrawer.addEventListener("click", function () {
        if (!resetConfirmPending) {
          resetConfirmPending = true;
          updateResetButtonLabel();
          if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
          resetConfirmTimer = setTimeout(function () {
            resetConfirmPending = false;
            updateResetButtonLabel();
          }, 4000);
          return;
        }
        resetConfirmPending = false;
        state = CORE.clearLessonState(lesson);
        transientHint = "";
        highlightMissingTf = false;
        closeDrawer();
        renderApp();
        CORE.showToast("Đã làm mới toàn bộ dữ liệu Bài " + lesson.number + ".");
      });
    }

    if (dom.btnExitDrill) {
      dom.btnExitDrill.addEventListener("click", exitDrillToResults);
    }

    if (dom.btnPrev) {
      dom.btnPrev.addEventListener("click", function () {
        var idx = getCurrentIndex(getActiveQuestions());
        goToQuestionIndex(idx - 1);
      });
    }
    if (dom.btnNext) {
      dom.btnNext.addEventListener("click", function () {
        var idx = getCurrentIndex(getActiveQuestions());
        goToQuestionIndex(idx + 1);
      });
    }
    if (dom.btnPrimaryReflex) {
      dom.btnPrimaryReflex.addEventListener("click", handlePrimaryReflexAction);
    }

    if (dom.btnDialogCancel) {
      dom.btnDialogCancel.addEventListener("click", function () {
        closeDialog(true);
      });
    }
    if (dom.btnDialogConfirm) {
      dom.btnDialogConfirm.addEventListener("click", function () {
        var fn = activeDialogCallback;
        closeDialog(false);
        if (typeof fn === "function") fn();
      });
    }
    if (dom.dialogBackdrop) {
      dom.dialogBackdrop.addEventListener("click", function (ev) {
        if (ev.target === dom.dialogBackdrop) closeDialog(true);
      });
    }

    if (dom.btnCloseLightbox) {
      dom.btnCloseLightbox.addEventListener("click", closeLightbox);
    }
    if (dom.lightboxBackdrop) {
      dom.lightboxBackdrop.addEventListener("click", function (ev) {
        if (ev.target === dom.lightboxBackdrop) {
          closeLightbox();
          return;
        }
        var zBtn = ev.target.closest("[data-lightbox-zoom]");
        if (zBtn) {
          applyLightboxZoom(zBtn.getAttribute("data-lightbox-zoom"));
        }
      });
    }

    // Delegated Clicks
    document.addEventListener("click", function (ev) {
      var target = ev.target;

      // 1. Zoomable diagram button
      var zoomBtn = target.closest("[data-zoom-src]");
      if (zoomBtn) {
        openLightbox(
          zoomBtn.getAttribute("data-zoom-src"),
          zoomBtn.getAttribute("data-zoom-label"),
          zoomBtn.getAttribute("data-natural-w"),
          zoomBtn.getAttribute("data-natural-h")
        );
        return;
      }

      // 2. Single-question retry in Instant mode
      var retrySingleBtn = target.closest("[data-retry-single]");
      if (retrySingleBtn && !state.submitted && !isDrillActive() && state.mode === "instant") {
        var activeQsRetry = getActiveQuestions();
        var qRetry = activeQsRetry[getCurrentIndex(activeQsRetry)];
        if (qRetry) {
          delete state.checked[qRetry.uid];
          transientHint = "";
          highlightMissingTf = false;
          persist();
          renderApp();
          if (qRetry.part === "short") {
            var sInp = document.getElementById("short-answer-input");
            if (sInp) sInp.focus();
          }
        }
        return;
      }

      // 3. Part jump pill
      var partBtn = target.closest("[data-jump-part]");
      if (partBtn && !isDrillActive()) {
        var targetPart = partBtn.getAttribute("data-jump-part");
        var list = partBuckets[targetPart] || [];
        if (list.length > 0) {
          var dest = list[0];
          for (var i = 0; i < list.length; i++) {
            if (!CORE.isQuestionAnswered(list[i], state.answers[list[i].uid])) {
              dest = list[i];
              break;
            }
          }
          var allQs = getActiveQuestions();
          var curIdx = getCurrentIndex(allQs);
          if (allQs[curIdx] && allQs[curIdx].part === targetPart) {
            dest = list[0];
          }
          var newIndex = allQs.indexOf(dest);
          if (newIndex !== -1) goToQuestionIndex(newIndex);
        }
        return;
      }

      // 4. Mode toggle
      var modeBtn = target.closest("[data-set-mode]");
      if (modeBtn && !state.submitted) {
        var nextMode = modeBtn.getAttribute("data-set-mode");
        if (nextMode === "instant" || nextMode === "exam") {
          state.mode = nextMode;
          transientHint = "";
          highlightMissingTf = false;
          persist();
          renderApp();
        }
        return;
      }

      var openResBtn = target.closest("[data-open-results]");
      if (openResBtn && state.submitted) {
        state.view = "results";
        persist();
        renderApp();
        window.scrollTo({ top: 0, behavior: "auto" });
        return;
      }

      var submitInlineBtn = target.closest("#btn-submit-inline");
      if (submitInlineBtn) {
        requestSubmitExam();
        return;
      }

      // 5. Bookmark flag
      var flagBtn = target.closest("#btn-toggle-flag");
      if (flagBtn) {
        var activeQs = getActiveQuestions();
        var q = activeQs[getCurrentIndex(activeQs)];
        if (q) {
          if (state.flagged[q.uid]) {
            delete state.flagged[q.uid];
          } else {
            state.flagged[q.uid] = true;
          }
          persist();
          renderApp();
        }
        return;
      }

      // 6. MCQ Option click
      var mcqBtn = target.closest("[data-mcq-key]");
      if (mcqBtn && !mcqBtn.disabled) {
        var activeQsMcq = getActiveQuestions();
        var qMcq = activeQsMcq[getCurrentIndex(activeQsMcq)];
        if (qMcq && qMcq.part === "mcq" && !isQuestionGradedInCurrentContext(qMcq.uid)) {
          setActiveAnswer(qMcq.uid, mcqBtn.getAttribute("data-mcq-key"));
          transientHint = "";
          persist();
          renderApp();
        }
        return;
      }

      // 7. TF Choice click
      var tfBtn = target.closest("[data-tf-key]");
      if (tfBtn && !tfBtn.disabled) {
        var activeQsTf = getActiveQuestions();
        var qTf = activeQsTf[getCurrentIndex(activeQsTf)];
        if (qTf && qTf.part === "tf" && !isQuestionGradedInCurrentContext(qTf.uid)) {
          var sKey = tfBtn.getAttribute("data-tf-key");
          var sVal = tfBtn.getAttribute("data-tf-val") === "true";
          var curObj = getActiveAnswer(qTf.uid);
          var nextObj = curObj && typeof curObj === "object" ? Object.assign({}, curObj) : {};
          nextObj[sKey] = sVal;
          setActiveAnswer(qTf.uid, nextObj);
          if (CORE.isQuestionAnswered(qTf, nextObj)) {
            transientHint = "";
            highlightMissingTf = false;
          }
          persist();
          renderApp();
        }
        return;
      }

      // 8. Short Clear button
      var clearShort = target.closest("#btn-clear-short");
      if (clearShort) {
        var activeQsSh = getActiveQuestions();
        var qSh = activeQsSh[getCurrentIndex(activeQsSh)];
        if (qSh && qSh.part === "short" && !isQuestionGradedInCurrentContext(qSh.uid)) {
          setActiveAnswer(qSh.uid, "");
          persist();
          var inp = document.getElementById("short-answer-input");
          if (inp) {
            inp.value = "";
            inp.focus();
          }
          var warnEl = document.getElementById("short-format-warn");
          if (warnEl) warnEl.hidden = true;
          clearShort.hidden = true;
          updateChrome();
        }
        return;
      }

      // 9. Drawer Map cell jump
      var mapUidBtn = target.closest("[data-map-uid]");
      if (mapUidBtn) {
        var targetUid = mapUidBtn.getAttribute("data-map-uid");
        var allList = getActiveQuestions();
        for (var k = 0; k < allList.length; k++) {
          if (allList[k].uid === targetUid) {
            closeDrawer();
            goToQuestionIndex(k);
            break;
          }
        }
        return;
      }

      var mapIdxBtn = target.closest("[data-map-idx]");
      if (mapIdxBtn) {
        var targetIdx = parseInt(mapIdxBtn.getAttribute("data-map-idx"), 10);
        if (Number.isFinite(targetIdx)) {
          closeDrawer();
          goToQuestionIndex(targetIdx);
        }
        return;
      }

      // 10. Results screen actions
      var filterTab = target.closest("[data-review-filter]");
      if (filterTab) {
        state.reviewFilter = filterTab.getAttribute("data-review-filter") || "all";
        persist();
        renderResultsView();
        return;
      }

      var retryHeroBtn = target.closest("#btn-start-wrong-drill");
      if (retryHeroBtn) {
        var mNow = CORE.computeLessonMetrics(lesson, state);
        startWrongDrill(mNow.wrongUids);
        return;
      }

      var backStageBtn = target.closest("#btn-back-to-stage");
      if (backStageBtn) {
        state.view = "stage";
        persist();
        renderApp();
        window.scrollTo({ top: 0, behavior: "auto" });
        return;
      }

      var restartFreshBtn = target.closest("#btn-restart-fresh");
      if (restartFreshBtn) {
        openDialog({
          title: "Làm lại Bài " + lesson.number + " từ đầu?",
          desc:
            "Toàn bộ câu trả lời hiện tại của Bài " +
            lesson.number +
            " sẽ được xóa sạch để bạn luyện lại đề mới hoàn toàn.",
          cancelText: "Giữ lại kết quả",
          confirmText: "Xóa & Làm lại từ đầu",
          onConfirm: function () {
            state = CORE.clearLessonState(lesson);
            transientHint = "";
            highlightMissingTf = false;
            renderApp();
            window.scrollTo({ top: 0, behavior: "auto" });
            CORE.showToast("Đã sẵn sàng lượt làm mới Bài " + lesson.number + "!");
          }
        });
      }
    });

    // Live input listener for Part III Short Answer (never re-renders input -> preserves cursor & IME!)
    document.addEventListener("input", function (ev) {
      if (ev.target && ev.target.id === "short-answer-input") {
        var activeQs = getActiveQuestions();
        var q = activeQs[getCurrentIndex(activeQs)];
        if (!q || q.part !== "short" || isQuestionGradedInCurrentContext(q.uid)) return;

        var rawVal = ev.target.value;
        setActiveAnswer(q.uid, rawVal);
        var normLive = CORE.normalizeShortAnswer(rawVal, q.answer);
        var warnEl = document.getElementById("short-format-warn");
        if (warnEl) warnEl.hidden = !normLive.hasInvalidChars;

        if (rawVal.trim().length > 0 && !normLive.hasInvalidChars && transientHint) {
          transientHint = "";
          var alertEl = document.querySelector(".inline-hint-alert");
          if (alertEl) alertEl.remove();
        }
        var clearBtn = document.getElementById("btn-clear-short");
        if (clearBtn) clearBtn.hidden = rawVal.length === 0;
        persist();
        updateChrome();
      }
    });

    // Virtual keyboard dock guard for short mobile screens
    document.addEventListener("focusin", function (ev) {
      if (ev.target && ev.target.id === "short-answer-input") {
        document.body.classList.add("is-short-focused");
      }
    });
    document.addEventListener("focusout", function (ev) {
      if (ev.target && ev.target.id === "short-answer-input") {
        document.body.classList.remove("is-short-focused");
      }
    });

    // Desktop Keyboard Shortcuts (never hijacks Enter when Tab-focused on interactive buttons/links!)
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;

      if (ev.key === "Escape") {
        if (dom.lightboxBackdrop && !dom.lightboxBackdrop.hidden) {
          ev.preventDefault();
          closeLightbox();
          return;
        }
        if (dom.dialogBackdrop && !dom.dialogBackdrop.hidden) {
          ev.preventDefault();
          closeDialog(true);
          return;
        }
        if (dom.drawerBackdrop && !dom.drawerBackdrop.hidden) {
          ev.preventDefault();
          closeDrawer();
          return;
        }
        return;
      }

      if (anyOverlayOpen() || state.view === "results") {
        return;
      }

      var activeEl = document.activeElement;
      var inShortInput = Boolean(activeEl && activeEl.id === "short-answer-input");

      if (inShortInput) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          handlePrimaryReflexAction();
          return;
        }
        if (ev.key === "ArrowLeft" && activeEl.value.length === 0) {
          ev.preventDefault();
          goToQuestionIndex(getCurrentIndex(getActiveQuestions()) - 1);
          return;
        }
        if (ev.key === "ArrowRight" && activeEl.value.length === 0) {
          ev.preventDefault();
          goToQuestionIndex(getCurrentIndex(getActiveQuestions()) + 1);
          return;
        }
        return;
      }

      var activeQs = getActiveQuestions();
      var idx = getCurrentIndex(activeQs);
      var q = activeQs[idx];
      if (!q) return;

      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        goToQuestionIndex(idx - 1);
        return;
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        goToQuestionIndex(idx + 1);
        return;
      }

      // Only trigger global Enter action when no interactive button/link has keyboard focus
      if (ev.key === "Enter") {
        var onBodyOnly = !activeEl || activeEl === document.body || activeEl === document.documentElement;
        if (onBodyOnly) {
          ev.preventDefault();
          handlePrimaryReflexAction();
        }
        return;
      }

      if (q.part === "mcq" && !isQuestionGradedInCurrentContext(q.uid)) {
        var keyUpper = ev.key.toUpperCase();
        var mapKey = null;
        if (keyUpper === "1" || keyUpper === "A") mapKey = "A";
        else if (keyUpper === "2" || keyUpper === "B") mapKey = "B";
        else if (keyUpper === "3" || keyUpper === "C") mapKey = "C";
        else if (keyUpper === "4" || keyUpper === "D") mapKey = "D";

        if (mapKey) {
          ev.preventDefault();
          setActiveAnswer(q.uid, mapKey);
          transientHint = "";
          persist();
          renderApp();
        }
      }
    });

    // Cross-tab & iOS Safari bfcache sync
    window.addEventListener("pageshow", function (ev) {
      if (ev && ev.persisted) {
        state = CORE.loadLessonState(lesson);
        renderApp();
      }
    });
    window.addEventListener("storage", function () {
      state = CORE.loadLessonState(lesson);
      renderApp();
    });
  }

  /* --------------------------------------------------------------------------
     Handle URL Deep-Links (?view=results, ?retry=wrong) & Boot
     -------------------------------------------------------------------------- */
  function applyDeepLinks() {
    try {
      var params = new URLSearchParams(window.location.search);
      var wantView = params.get("view");
      var wantRetry = params.get("retry");

      if (wantRetry === "wrong") {
        var m = CORE.computeLessonMetrics(lesson, state);
        var pool = state.submitted ? m.wrongUids : m.checkedWrongUids;
        if (pool.length > 0) {
          startWrongDrill(pool);
        }
      } else if (wantView === "results" && state.submitted) {
        state.view = "results";
        persist();
      }

      if (wantView || wantRetry) {
        var cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", cleanUrl);
      }
    } catch (_e) {}
  }

  bindEvents();
  applyDeepLinks();
  renderApp();
})();

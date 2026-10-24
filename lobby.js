/* ==========================================================================
   BIOSPHERE — POSTER LOBBY CONTROLLER (index.html)
   3 Independent Lesson Specimen Plates — Zero Combined 87-Question Mode
   ========================================================================== */
(function () {
  "use strict";

  var CORE = window.BIOSPHERE_CORE;

  function renderLobby() {
    if (!CORE) return;
    var data = CORE.getData();
    var lessons = data.lessons || [];
    var grid = document.getElementById("specimen-plates-grid");
    var ledgerList = document.getElementById("independent-ledger-list");
    var ledgerCaption = document.getElementById("overall-stat-caption");
    if (!grid) return;

    var completedLessons = 0;
    var startedLessons = 0;
    var cardsHtml = [];
    var ledgerRowsHtml = [];

    for (var i = 0; i < lessons.length; i++) {
      var lesson = lessons[i];
      var state = CORE.loadLessonState(lesson);
      var m = CORE.computeLessonMetrics(lesson, state);

      if (state.submitted) completedLessons++;
      if (m.touchedCount > 0 || state.submitted) startedLessons++;

      var pct = m.total > 0 ? Math.round((m.answeredCount / m.total) * 100) : 0;

      var statusLeft = "Chưa làm";
      var statusRight = "0 / " + m.total + " câu";
      var ledgerStatus = "0 / " + m.total + " câu";
      var primaryLabel = "Bắt đầu Bài " + lesson.number;
      var primaryHref = "./" + lesson.slug;

      if (state.submitted) {
        statusLeft = "Đã nộp: " + m.correctTotal + "/" + m.total + " câu đúng";
        statusRight = m.tfSubCorrect + "/" + m.tfSubTotal + " ý Đ/S";
        ledgerStatus = "Đúng " + m.correctTotal + "/" + m.total + " câu";
        primaryLabel = m.wrongUids.length === 0 ? "Xem lại bài (Đạt 100%)" : "Mở lại Bài " + lesson.number;
      } else if (m.answeredCount > 0) {
        statusLeft = state.drill ? "Đang luyện câu sai" : "Đang làm dở";
        statusRight = m.answeredCount + " / " + m.total + " câu";
        ledgerStatus = "Đã làm " + m.answeredCount + "/" + m.total + " câu";
        primaryLabel = "Làm tiếp (" + m.answeredCount + "/" + m.total + ")";
      } else if (m.partialCount > 0) {
        statusLeft = "Đang chọn dở";
        statusRight = m.partialCount + " câu Đ/S chọn dở";
        ledgerStatus = "Chọn dở " + m.partialCount + " câu";
        primaryLabel = "Làm tiếp Bài " + lesson.number;
      }

      ledgerRowsHtml.push(
        '<div class="ledger-lesson-row">' +
          '<span class="ledger-lesson-name">Bài ' +
          CORE.escapeHtml(lesson.number) +
          "</span>" +
          '<span class="ledger-lesson-val' +
          (state.submitted ? " is-done" : m.touchedCount > 0 ? " is-active" : "") +
          '">' +
          CORE.escapeHtml(ledgerStatus) +
          "</span>" +
          "</div>"
      );

      var secondaryButtons = [];
      if (state.submitted) {
        secondaryButtons.push(
          '<a class="btn-results-plate" href="./' +
            CORE.escapeHtml(lesson.slug) +
            '?view=results">Bảng kết quả</a>'
        );
        if (m.wrongUids.length > 0) {
          secondaryButtons.push(
            '<a class="btn-retry-plate" href="./' +
              CORE.escapeHtml(lesson.slug) +
              '?retry=wrong">Luyện riêng ' +
              m.wrongUids.length +
              " câu sai</a>"
          );
        }
      } else if (m.checkedWrongUids.length > 0) {
        secondaryButtons.push(
          '<a class="btn-retry-plate" href="./' +
            CORE.escapeHtml(lesson.slug) +
            '?retry=wrong">Luyện ' +
            m.checkedWrongUids.length +
            " câu vừa sai</a>"
        );
      }

      var badgeCode = "BÀI " + (lesson.number < 10 ? "0" + lesson.number : lesson.number);

      cardsHtml.push(
        '<article class="specimen-plate" data-lesson-card="' +
          CORE.escapeHtml(lesson.id) +
          '">' +
          '<div class="plate-top-group">' +
          '<div class="plate-header">' +
          '<span class="plate-badge">' +
          CORE.escapeHtml(badgeCode) +
          "</span>" +
          '<span class="plate-count-pill">' +
          m.total +
          " câu độc lập</span>" +
          "</div>" +
          '<div class="plate-illustration">' +
          CORE.getBotanicalSvg(lesson.id) +
          "</div>" +
          '<h2 class="plate-title">' +
          CORE.escapeHtml(lesson.title_full) +
          "</h2>" +
          '<div class="plate-parts-breakdown">' +
          '<span class="part-chip">Phần I: ' +
          m.mcqTotal +
          " câu ABCD</span>" +
          '<span class="part-chip">Phần II: ' +
          m.tfTotal +
          " câu Đ/S (" +
          m.tfSubTotal +
          " ý)</span>" +
          '<span class="part-chip">Phần III: ' +
          m.shortTotal +
          " câu ngắn</span>" +
          "</div>" +
          "</div>" +
          '<div class="plate-bottom-group">' +
          '<div class="plate-progress-box">' +
          '<div class="plate-progress-meta">' +
          "<span>" +
          CORE.escapeHtml(statusLeft) +
          "</span>" +
          '<span class="plate-progress-right">' +
          CORE.escapeHtml(statusRight) +
          "</span>" +
          "</div>" +
          '<div class="plate-vein-bar"><div class="plate-vein-fill" style="width:' +
          pct +
          '%"></div></div>' +
          "</div>" +
          '<div class="plate-actions">' +
          '<div class="plate-primary-row">' +
          '<a class="btn-open-plate" href="' +
          CORE.escapeHtml(primaryHref) +
          '">' +
          CORE.escapeHtml(primaryLabel) +
          "</a>" +
          '<button type="button" class="btn-share-plate" data-share-lesson="' +
          CORE.escapeHtml(lesson.slug) +
          '" data-share-title="' +
          CORE.escapeHtml(lesson.title_full + " — Sinh học 11 Giữa HKI") +
          '" aria-label="Chia sẻ ' +
          CORE.escapeHtml(lesson.title_full) +
          '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>' +
          "<span>Chia sẻ</span>" +
          "</button>" +
          "</div>" +
          (secondaryButtons.length > 0
            ? '<div class="plate-secondary-row">' + secondaryButtons.join("") + "</div>"
            : "") +
          "</div>" +
          "</div>" +
          "</article>"
      );
    }

    grid.innerHTML = cardsHtml.join("");
    if (ledgerList) {
      ledgerList.innerHTML = ledgerRowsHtml.join("");
    }
    if (ledgerCaption) {
      if (startedLessons === 0) {
        ledgerCaption.textContent = "Mỗi chương chấm điểm và tự lưu tiến độ tách biệt trên thiết bị của bạn.";
      } else {
        ledgerCaption.textContent =
          "Đã mở " + startedLessons + "/3 bài độc lập · Đã nộp hoàn tất " + completedLessons + "/3 bài.";
      }
    }
  }

  function bindLobbyEvents() {
    var shareMainBtn = document.getElementById("btn-share-lobby");
    if (shareMainBtn) {
      shareMainBtn.addEventListener("click", function () {
        CORE.shareLink({
          url: "./index.html",
          title: "BIOSPHERE — Ôn tập Sinh học 11 Giữa HKI (2026 - 2027)",
          text: "Bộ đề ôn tập Kiểm tra Giữa HKI Sinh học 11 (3 bài độc lập: Bài 1, Bài 2, Bài 4):"
        });
      });
    }

    document.addEventListener("click", function (ev) {
      var shareBtn = ev.target.closest("[data-share-lesson]");
      if (shareBtn) {
        ev.preventDefault();
        var slug = shareBtn.getAttribute("data-share-lesson");
        var title = shareBtn.getAttribute("data-share-title");
        CORE.shareLink({
          url: "./" + slug,
          title: title,
          text: "Cùng luyện đề " + title
        });
      }
    });

    window.addEventListener("pageshow", renderLobby);
    window.addEventListener("storage", renderLobby);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderLobby();
      bindLobbyEvents();
    });
  } else {
    renderLobby();
    bindLobbyEvents();
  }
})();

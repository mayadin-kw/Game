import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  update,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBpcJHADMt7FWqGo-PRae2oa_916qD6KAI",
  authDomain: "ques-87f74.firebaseapp.com",
  databaseURL: "https://ques-87f74-default-rtdb.firebaseio.com",
  projectId: "ques-87f74",
  storageBucket: "ques-87f74.firebasestorage.app",
  messagingSenderId: "110924910325",
  appId: "1:110924910325:web:e92f80606985124c77ffbc",
  measurementId: "G-B7MMDCHE3V",
};

const SHARE_ROOT = "https://sli0tin.github.io/Game/";
const STORAGE_CLIENT_ID = "direct-quiz:client-id";
const STORAGE_PLAYER_PREFIX = "direct-quiz:player:";
const POINT_VALUES = [200, 400, 600];
const RULES_MESSAGE =
  "قوانين اللعبة: لكل لاعب دور في اختيار السؤال، لكن النقاط تذهب لأسرع شخص يجيب إجابة صحيحة. التحكم بعرض الصفحات والأسئلة لمنشئ الغرفة فقط، بينما الجميع يستطيعون الكتابة في الدردشة.";
const PLAYER_COLORS = [
  { name: "مرجاني", value: "#ff7f6e" },
  { name: "سماوي", value: "#4cb8ff" },
  { name: "نعناعي", value: "#4fcf9a" },
  { name: "ذهبي", value: "#f4b942" },
];

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const elements = {
  screen: document.querySelector("#screen"),
  topMeta: document.querySelector("#topMeta"),
  chatHint: document.querySelector("#chatHint"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatSendBtn: document.querySelector("#chatSendBtn"),
  rulesBtn: document.querySelector("#rulesBtn"),
  toast: document.querySelector("#toast"),
};

const state = {
  clientId: getOrCreateClientId(),
  authUid: "",
  roomCode: getRoomCodeFromUrl(),
  room: null,
  roomMissing: false,
  localFileData: null,
  uploadProgress: 0,
  uploadStats: { categories: 0, questions: 0, sheetName: "", fileName: "" },
  loadingFile: false,
  actionBusy: false,
  pendingResponderId: "none",
  joinDraft: {
    name: "",
    role: "player",
    color: PLAYER_COLORS[0].value,
  },
  playerId: "",
  chatDraft: "",
  unsubscribeRoom: null,
  toastTimer: null,
};

const numberFormatter = new Intl.NumberFormat("ar-KW");

init();

async function init() {
  syncViewportHeight();
  bindEvents();
  render();

  if (state.roomCode) {
    subscribeToRoom(state.roomCode);
  } else {
    render();
  }
}

function bindEvents() {
  window.addEventListener("resize", syncViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewportHeight);
  }

  document.addEventListener("click", async (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl || state.actionBusy) {
      return;
    }

    const action = actionEl.dataset.action;
    try {
      switch (action) {
        case "create-room":
          await createRoomFromUploadedFile();
          break;
        case "copy-room-link":
          await copyRoomLink();
          break;
        case "start-match":
          await startMatch();
          break;
        case "toggle-category":
          await toggleCategory(actionEl.dataset.categoryId);
          break;
        case "confirm-categories":
          await confirmCategories();
          break;
        case "set-turn":
          await setTurnPlayer(actionEl.dataset.playerId);
          break;
        case "open-question":
          await openQuestion(actionEl.dataset.categoryId, Number(actionEl.dataset.point));
          break;
        case "show-answer":
          await goToAnswerSelection();
          break;
        case "pick-responder":
          state.pendingResponderId = actionEl.dataset.playerId || "none";
          render();
          break;
        case "commit-answer":
          await commitAnswer(state.pendingResponderId);
          break;
        case "advance-result":
          await advanceFromResult();
          break;
        case "reset-same-file":
          await resetGameWithSameFile();
          break;
        case "go-home":
          goHome(true);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(error);
      showToast("حدث خطأ أثناء تنفيذ الطلب.");
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.id === "excelInput" && target.files?.[0]) {
      await readExcelFile(target.files[0]);
      target.value = "";
      return;
    }

    if (target.name === "joinRole") {
      state.joinDraft.role = target.value;
      syncDraftColor();
      render();
      return;
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "joinName") {
      state.joinDraft.name = target.value;
      return;
    }

    if (target.id === "chatInput") {
      elements.chatSendBtn.disabled = !canUseChat() || !target.value.trim() || state.actionBusy;
      return;
    }

    if (target.name === "joinColor") {
      state.joinDraft.color = target.value;
      render();
      return;
    }
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "joinForm") {
      event.preventDefault();
      await joinCurrentRoom();
      return;
    }

    if (event.target.id === "chatForm") {
      event.preventDefault();
      await sendChatMessage();
    }
  });

  elements.rulesBtn.addEventListener("click", async () => {
    if (!canUseChat()) {
      showToast("ادخل الغرفة أولاً حتى تستخدم الدردشة.");
      return;
    }
    await sendSystemChatMessage(RULES_MESSAGE);
  });
}

function render() {
  renderTopMeta();
  renderScreen();
  renderChat();
}

function renderTopMeta() {
  const currentPlayer = getCurrentPlayer();
  const room = state.room;

  if (!room) {
    elements.topMeta.innerHTML = `
      <span class="meta-pill">واجهة متجاوبة بالكامل</span>
      <span class="meta-pill accent">${state.localFileData ? "الملف جاهز" : "ارفع ملف Excel"}</span>
    `;
    return;
  }

  const roleLabel = currentPlayer
    ? currentPlayer.role === "player"
      ? "لاعب"
      : "متفرج"
    : "زائر";

  elements.topMeta.innerHTML = `
    <span class="meta-pill">رمز الغرفة ${escapeHtml(room.code || state.roomCode || "")}</span>
    <span class="meta-pill ${isHost() ? "accent" : ""}">
      ${isHost() ? "منشئ الغرفة" : roleLabel}
      ${currentPlayer ? `• ${escapeHtml(currentPlayer.name)}` : ""}
    </span>
    <button class="secondary-button compact" data-action="copy-room-link" type="button">نسخ الرابط</button>
  `;
}

function renderScreen() {
  if (state.roomCode && !state.room && !state.roomMissing) {
    elements.screen.innerHTML = renderLoadingScreen();
    return;
  }

  if (state.roomMissing) {
    elements.screen.innerHTML = renderMissingRoomScreen();
    return;
  }

  if (!state.room) {
    elements.screen.innerHTML = renderLandingScreen();
    return;
  }

  const currentPlayer = getCurrentPlayer();
  if (!currentPlayer) {
    elements.screen.innerHTML = renderJoinScreen();
    return;
  }

  const status = state.room.game?.status || "lobby";
  if (status === "lobby") {
    elements.screen.innerHTML = renderLobbyScreen();
    return;
  }
  if (status === "category-select") {
    elements.screen.innerHTML = renderCategorySelectionScreen();
    return;
  }
  if (status === "board") {
    elements.screen.innerHTML = renderBoardScreen();
    return;
  }
  if (status === "question") {
    elements.screen.innerHTML = renderQuestionScreen();
    return;
  }
  if (status === "answer-select") {
    elements.screen.innerHTML = renderAnswerSelectionScreen();
    return;
  }
  if (status === "answer-result") {
    elements.screen.innerHTML = renderAnswerResultScreen();
    return;
  }
  if (status === "finished") {
    elements.screen.innerHTML = renderFinishedScreen();
    return;
  }

  elements.screen.innerHTML = renderLoadingScreen();
}

function renderChat() {
  const room = state.room;
  const currentPlayer = getCurrentPlayer();
  const chatMessages = getChatMessages(room);
  const roomReady = Boolean(room);
  const joined = Boolean(currentPlayer);

  elements.rulesBtn.disabled = !roomReady || !joined || state.actionBusy;
  elements.chatInput.disabled = !roomReady || !joined || state.actionBusy;
  elements.chatSendBtn.disabled = !roomReady || !joined || !elements.chatInput.value.trim();
  elements.chatHint.textContent = !roomReady
    ? "أنشئ غرفة أو ادخل غرفة لبدء المحادثة."
    : joined
      ? "الدردشة متاحة لجميع اللاعبين والمتفرجين."
      : "ادخل الغرفة باسمك حتى تتمكن من الكتابة.";

  if (!roomReady) {
    elements.chatMessages.innerHTML = `
      <div class="message system">الدردشة ستظهر هنا بعد إنشاء غرفة أو فتح رابط غرفة موجودة.</div>
    `;
    return;
  }

  if (!chatMessages.length) {
    elements.chatMessages.innerHTML = `
      <div class="message system">لا توجد رسائل بعد. يمكنك إرسال التعليمات أو الضغط على زر القوانين.</div>
    `;
    return;
  }

  elements.chatMessages.innerHTML = chatMessages
    .map((message) => {
      const typeClass =
        message.type === "system"
          ? "system"
          : message.playerId && message.playerId === state.playerId
            ? "own"
            : "other";

      return `
        <article class="message ${typeClass}">
          ${message.type === "system" ? "" : `<strong>${escapeHtml(message.senderName || "لاعب")}</strong>`}
          <span>${escapeHtml(message.text || "")}</span>
        </article>
      `;
    })
    .join("");

  requestAnimationFrame(() => {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  });
}

function renderLandingScreen() {
  const fileReady = Boolean(state.localFileData);
  const uploadLabel = state.loadingFile ? "جارٍ قراءة ملف Excel..." : "ارفع ملف Excel أولاً";
  const buttonLabel = state.loadingFile ? "جارٍ التحميل" : fileReady ? "ابدأ اللعبة وأنشئ الغرفة" : "انتظر رفع الملف";
  const categoriesPreview = fileReady
    ? state.localFileData.categories.map((category) => `<span class="pill">${escapeHtml(category.name)}</span>`).join("")
    : `<span class="inline-note">سيتم هنا عرض التصنيفات بعد قراءة الملف.</span>`;

  return `
    <div class="screen-shell hero-panel">
      <div class="hero-copy">
        <h2>ارفع نفس ملف Excel ثم افتح غرفة اللعبة مباشرة</h2>
        <p>
          التطبيق يقرأ أول شيت من الملف بنفس الأعمدة:
          <strong>التصنيف / السؤال / الخيارات / الإجابة الصحيحة / النقاط</strong>.
          أثناء التحميل يظهر شريط التقدم وعدد التصنيفات وعدد الأسئلة.
        </p>
      </div>

      <div class="hero-grid">
        <label class="upload-dropzone">
          <input id="excelInput" class="file-input" type="file" accept=".xlsx,.xls" />
          <div class="column">
            <span class="pill accent">${escapeHtml(uploadLabel)}</span>
            <strong>${fileReady ? escapeHtml(state.uploadStats.fileName || state.localFileData.fileName) : "اختر الملف من جهازك"}</strong>
            <p>
              الملف المرجعي الذي طلبته سيتم قراءته بنفس الصيغة. بعد اكتمال القراءة سيتفعل زر بدء اللعبة تلقائياً.
            </p>
          </div>

          <div class="column">
            <div class="progress-track">
              <div class="progress-bar" style="width:${state.uploadProgress}%;"></div>
            </div>
            <div class="summary-stat-grid">
              <div class="stat-box">
                <span>عدد التصنيفات</span>
                <strong>${numberFormatter.format(state.uploadStats.categories || 0)}</strong>
              </div>
              <div class="stat-box">
                <span>عدد الأسئلة</span>
                <strong>${numberFormatter.format(state.uploadStats.questions || 0)}</strong>
              </div>
            </div>
          </div>
        </label>

        <div class="summary-card">
          <div class="column">
            <span class="pill ${fileReady ? "success" : ""}">${fileReady ? "الملف جاهز" : "بانتظار الرفع"}</span>
            <strong>${escapeHtml(state.uploadStats.sheetName || "سيظهر اسم الشيت هنا")}</strong>
            <p class="soft-copy">
              الموقع مصمم ليتناسب مع الهاتف بدون سكرول للصفحة الأساسية، مع مربع دردشة ثابت في الأسفل، ولوحة لعب متزامنة للجميع.
            </p>
          </div>
          <div class="row">${categoriesPreview}</div>
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">بعد الضغط على البدء سيتم إنشاء غرفة مع رابط قابل للنسخ.</span>
        <button
          class="primary-button"
          data-action="create-room"
          type="button"
          ${!fileReady || state.loadingFile ? "disabled" : ""}
        >
          ${escapeHtml(buttonLabel)}
        </button>
      </div>
    </div>
  `;
}

function renderLoadingScreen() {
  return `
    <div class="screen-shell error-shell">
      <div class="screen-header">
        <div>
          <h2>جارٍ تجهيز الغرفة</h2>
          <p class="screen-copy">يتم الآن الاتصال بقاعدة البيانات وتحميل حالة الغرفة.</p>
        </div>
      </div>
      <div class="screen-body">
        <div class="result-card">
          <div class="emoji">⏳</div>
          <h3 class="screen-title">لحظة واحدة...</h3>
          <p class="soft-copy">إذا فتحت رابط الغرفة للتو فسيظهر المحتوى هنا مباشرة بعد وصول البيانات.</p>
        </div>
      </div>
      <div class="screen-footer"></div>
    </div>
  `;
}

function renderMissingRoomScreen() {
  return `
    <div class="screen-shell error-shell">
      <div class="screen-header">
        <div>
          <h2>الغرفة غير موجودة</h2>
          <p class="screen-copy">تأكد من رابط الغرفة أو أنشئ غرفة جديدة من الصفحة الرئيسية.</p>
        </div>
      </div>
      <div class="screen-body">
        <div class="result-card fail">
          <div class="emoji">🚪</div>
          <h3 class="screen-title">الرابط لا يشير إلى غرفة صالحة</h3>
          <p class="soft-copy">ربما تم حذف الغرفة أو لم يتم إنشاؤها بعد.</p>
        </div>
      </div>
      <div class="screen-footer">
        <button class="primary-button" data-action="go-home" type="button">العودة للرئيسية</button>
      </div>
    </div>
  `;
}

function renderJoinScreen() {
  const room = state.room;
  const players = getPlayers(room);
  const spectators = getSpectators(room);
  const availableColors = getAvailableColors();
  const gameStarted = room.game?.status && room.game.status !== "lobby";
  const forceSpectator = gameStarted || players.length >= 4;
  const currentRole = forceSpectator ? "spectator" : state.joinDraft.role;
  const link = buildShareLink(room.code);

  if (forceSpectator && state.joinDraft.role !== "spectator") {
    state.joinDraft.role = "spectator";
  }

  syncDraftColor();

  return `
    <div class="screen-shell join-panel">
      <div class="screen-header">
        <div>
          <h2>الانضمام إلى الغرفة</h2>
          <p class="screen-copy">اكتب اسمك، اختر لوناً غير مستخدم أو ادخل كمشاهد.</p>
        </div>
        <span class="status-chip ${players.length >= 4 ? "danger" : "success"}">
          اللاعبون ${numberFormatter.format(players.length)}/٤
        </span>
      </div>

      <div class="screen-body">
        <div class="join-card">
          <div class="link-box">
            <small>رابط الغرفة القابل للنسخ</small>
            <code>${escapeHtml(link)}</code>
          </div>

          <div class="player-grid">
            ${players.length
              ? players.map((player) => renderPlayerChip(player, room.game?.turnPlayerId)).join("")
              : `<div class="player-chip"><strong>لا يوجد لاعب بعد</strong><small>ادخل أول لاعب لبدء المباراة.</small></div>`}
          </div>

          <form id="joinForm" class="column">
            <input
              id="joinName"
              class="text-input"
              type="text"
              maxlength="24"
              placeholder="اسمك داخل الغرفة"
              value="${escapeHtml(state.joinDraft.name)}"
              required
            />

            <div class="row">
              <label class="pill">
                <input type="radio" name="joinRole" value="player" ${currentRole === "player" ? "checked" : ""} ${forceSpectator ? "disabled" : ""} />
                لاعب
              </label>
              <label class="pill">
                <input type="radio" name="joinRole" value="spectator" ${currentRole === "spectator" ? "checked" : ""} />
                متفرج
              </label>
            </div>

            ${
              currentRole === "player"
                ? `
                  <div class="player-grid">
                    ${availableColors
                      .map((color) => {
                        const active = state.joinDraft.color === color.value;
                        return `
                          <label class="color-option ${active ? "active" : ""}" style="box-shadow: inset 0 0 0 2px ${active ? color.value : "transparent"};">
                            <input type="radio" name="joinColor" value="${color.value}" ${active ? "checked" : ""} hidden />
                            <strong>${escapeHtml(color.name)}</strong>
                            <small>${escapeHtml(color.value)}</small>
                          </label>
                        `;
                      })
                      .join("")}
                  </div>
                `
                : `<p class="inline-note">كمتفرج ستشاهد جميع الشاشات لكن لن تدخل في حساب الدور أو النقاط.</p>`
            }

            <div class="screen-footer">
              <span class="inline-note">
                ${
                  forceSpectator
                    ? "بعد بدء اللعبة أو عند اكتمال ٤ لاعبين، يكون الانضمام الجديد كمشاهد فقط."
                    : "الألوان المعروضة هي فقط الألوان غير المستخدمة حالياً."
                }
              </span>
              <button class="primary-button" type="submit" ${state.actionBusy ? "disabled" : ""}>دخول الغرفة</button>
            </div>
          </form>

          ${
            spectators.length
              ? `
                <div class="spectator-grid">
                  ${spectators
                    .map(
                      (spectator) => `
                        <div class="player-chip">
                          <strong>${escapeHtml(spectator.name)}</strong>
                          <small>متفرج</small>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">منشئ الغرفة فقط يتحكم بعرض الأسئلة والتنقل بين الصفحات.</span>
        <button class="secondary-button" data-action="copy-room-link" type="button">نسخ رابط الغرفة</button>
      </div>
    </div>
  `;
}

function renderLobbyScreen() {
  const room = state.room;
  const players = getPlayers(room);
  const spectators = getSpectators(room);
  const link = buildShareLink(room.code);

  return `
    <div class="screen-shell lobby-shell">
      <div class="screen-header">
        <div>
          <h2>لوبي الغرفة</h2>
          <p class="screen-copy">بعد اكتمال اللاعبين يمكن لمنشئ الغرفة بدء المباراة ثم اختيار التصنيفات.</p>
        </div>
        <span class="status-chip success">اللاعبون ${numberFormatter.format(players.length)}/٤</span>
      </div>

      <div class="screen-body column">
        <div class="link-box">
          <small>رابط الغرفة</small>
          <code>${escapeHtml(link)}</code>
        </div>

        <div class="panel-block column">
          <div class="row">
            <span class="pill">اسم الملف: ${escapeHtml(room.sourceFileName || "Excel")}</span>
            <span class="pill">التصنيفات: ${numberFormatter.format(room.categoryCount || 0)}</span>
            <span class="pill">الأسئلة: ${numberFormatter.format(room.questionCount || 0)}</span>
          </div>

          <div class="player-grid">
            ${players.length
              ? players.map((player) => renderPlayerChip(player, room.game?.turnPlayerId)).join("")
              : `<div class="player-chip"><strong>بانتظار أول لاعب</strong><small>لن يبدأ اللوبي حتى يوجد لاعب واحد على الأقل.</small></div>`}
          </div>

          ${
            spectators.length
              ? `
                <div class="column">
                  <strong>المتفرجون</strong>
                  <div class="spectator-grid">
                    ${spectators
                      .map(
                        (spectator) => `
                          <div class="player-chip">
                            <strong>${escapeHtml(spectator.name)}</strong>
                            <small>متفرج</small>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">
          ${isHost() ? "يمكنك البدء الآن إذا كان هناك لاعب واحد على الأقل." : "بانتظار منشئ الغرفة لبدء المباراة."}
        </span>
        <div class="row">
          <button class="secondary-button" data-action="copy-room-link" type="button">نسخ الرابط</button>
          ${
            isHost()
              ? `<button class="primary-button" data-action="start-match" type="button" ${players.length ? "" : "disabled"}>ابدأ المباراة</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function renderCategorySelectionScreen() {
  const room = state.room;
  const categories = getCategories(room);
  const selectedIds = room.game?.selectedCategoryIds || [];
  const exactSix = categories.length === 6;
  const selectedCount = selectedIds.length;

  return `
    <div class="screen-shell selection-shell">
      <div class="screen-header">
        <div>
          <h2>اختيار التصنيفات</h2>
          <p class="screen-copy">
            ${
              exactSix
                ? "الملف يحتوي على ٦ تصنيفات فقط، لذلك ظهرت كلها محددة تلقائياً."
                : "اختر ٦ تصنيفات فقط، ثم اضغط التالي للانتقال إلى لوحة اللعب."
            }
          </p>
        </div>
        <span class="status-chip ${selectedCount === 6 ? "success" : ""}">
          المحدد ${numberFormatter.format(selectedCount)}/٦
        </span>
      </div>

      <div class="screen-body">
        <div class="categories-grid">
          ${categories
            .map((category) => {
              const selected = selectedIds.includes(category.id);
              return `
                <button
                  class="category-card ${selected ? "selected" : ""} ${exactSix ? "locked" : ""}"
                  type="button"
                  data-action="toggle-category"
                  data-category-id="${escapeHtml(category.id)}"
                  ${!isHost() || exactSix ? "disabled" : ""}
                >
                  <div class="column">
                    <h3>${escapeHtml(category.name)}</h3>
                    <small>
                      ٢٠٠: ${numberFormatter.format(getQuestionsCount(category, 200))}
                      • ٤٠٠: ${numberFormatter.format(getQuestionsCount(category, 400))}
                      • ٦٠٠: ${numberFormatter.format(getQuestionsCount(category, 600))}
                    </small>
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">${isHost() ? "التالي يفتح لوحة اللعب للجميع." : "بانتظار منشئ الغرفة لاختيار التصنيفات."}</span>
        ${
          isHost()
            ? `<button class="primary-button" data-action="confirm-categories" type="button" ${selectedCount === 6 ? "" : "disabled"}>التالي</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderBoardScreen() {
  const room = state.room;
  const players = getPlayers(room);
  const selectedCategories = getSelectedCategories(room);
  const currentTurnId = room.game?.turnPlayerId || "";
  const hasCurrentTurn = Boolean(currentTurnId);

  return `
    <div class="screen-shell board-shell">
      <div class="screen-header">
        <div>
          <h2>لوحة التصنيفات</h2>
          <p class="screen-copy">
            ${hasCurrentTurn ? "تم تحديد صاحب الدور الحالي، ويمكن الآن اختيار السؤال." : "اضغط على أحد اللاعبين لتحديد صاحب أول دور."}
          </p>
        </div>
        <span class="status-chip accent">
          ${hasCurrentTurn ? `الدور الحالي: ${escapeHtml(getPlayerName(currentTurnId))}` : "بانتظار تحديد الدور"}
        </span>
      </div>

      <div class="screen-body board-body">
        <div class="score-wrap column">
          <div class="row">
            <span class="pill">انقر على اسم اللاعب لتحديد دوره</span>
            <span class="pill">النقاط تتغير حسب أسرع إجابة</span>
          </div>
          <div class="score-strip">
            ${players.map((player) => renderScoreCard(player, currentTurnId)).join("")}
          </div>
        </div>

        <div class="row">
          <span class="pill">٦ تصنيفات</span>
          <span class="pill">٣ أزرار في كل تصنيف: ٢٠٠ / ٤٠٠ / ٦٠٠</span>
        </div>

        <div class="categories-grid">
          ${selectedCategories.map((category) => renderBoardCategoryCard(category)).join("")}
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">
          ${isHost() ? "جميع ما تشاهده هنا سيظهر أيضاً لكل اللاعبين والمتفرجين لكن بدون تحكم." : "أنت تشاهد بث مباشر لحالة اللوحة ولا يمكنك تعديلها."}
        </span>
      </div>
    </div>
  `;
}

function renderQuestionScreen() {
  const question = state.room?.game?.currentQuestion;
  if (!question) {
    return renderLoadingScreen();
  }

  return `
    <div class="screen-shell question-shell">
      <div class="screen-header">
        <div>
          <h2>صفحة السؤال</h2>
          <p class="screen-copy">السؤال ظاهر الآن لجميع الموجودين في الغرفة.</p>
        </div>
        <div class="row">
          <span class="pill">${escapeHtml(question.categoryName)}</span>
          <span class="pill">${numberFormatter.format(question.point)} نقطة</span>
        </div>
      </div>

      <div class="screen-body">
        <div class="question-box">
          <div class="question-text">
            <h2>${escapeHtml(question.question)}</h2>
          </div>
          <div class="option-grid">
            ${question.optionsList.map((option) => `<div class="choice-card"><strong>${escapeHtml(option)}</strong></div>`).join("")}
          </div>
          <div class="screen-footer">
            <span class="inline-note">بعد انتهاء الوقت اضغط التالي لإظهار الجواب الصحيح واختيار من جاوب.</span>
            ${isHost() ? `<button class="primary-button" data-action="show-answer" type="button">التالي</button>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAnswerSelectionScreen() {
  const room = state.room;
  const question = room?.game?.currentQuestion;
  const players = getPlayers(room);
  if (!question) {
    return renderLoadingScreen();
  }

  return `
    <div class="screen-shell question-shell">
      <div class="screen-header">
        <div>
          <h2>اختيار من أجاب</h2>
          <p class="screen-copy">الجواب الصحيح ظاهر الآن، وحدد اللاعب الأسرع أو اختر "لا أحد".</p>
        </div>
        <span class="status-chip success">الجواب: ${escapeHtml(question.answer)}</span>
      </div>

      <div class="screen-body">
        <div class="answer-box">
          <div class="question-text">
            <h2>${escapeHtml(question.answer)}</h2>
          </div>
          <div class="answer-grid">
            ${players
              .map((player) => {
                const active = state.pendingResponderId === player.id;
                return `
                  <button
                    class="choice-card ${active ? "active" : ""}"
                    data-action="pick-responder"
                    data-player-id="${escapeHtml(player.id)}"
                    type="button"
                  >
                    <strong>${escapeHtml(player.name)}</strong>
                    <small>${numberFormatter.format(player.score || 0)} نقطة</small>
                  </button>
                `;
              })
              .join("")}
            <button
              class="choice-card ${state.pendingResponderId === "none" ? "active" : ""}"
              data-action="pick-responder"
              data-player-id="none"
              type="button"
            >
              <strong>لا أحد</strong>
              <small>لا يوجد من جاوب بشكل صحيح</small>
            </button>
          </div>
          <div class="screen-footer">
            <span class="inline-note">الاختيار هنا يحدد اللاعب الذي ستضاف له النقاط.</span>
            ${isHost() ? `<button class="primary-button" data-action="commit-answer" type="button">التالي</button>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAnswerResultScreen() {
  const result = state.room?.game?.lastResult;
  if (!result) {
    return renderLoadingScreen();
  }

  const success = Boolean(result.success);
  return `
    <div class="screen-shell result-shell">
      <div class="screen-header">
        <div>
          <h2>${success ? "تم احتساب النقاط" : "لا أحد أجاب"}</h2>
          <p class="screen-copy">هذه الصفحة متزامنة عند جميع المشاركين قبل العودة إلى لوحة التصنيفات.</p>
        </div>
        <span class="status-chip ${success ? "success" : "danger"}">
          ${escapeHtml(result.categoryName)} • ${numberFormatter.format(result.point)} نقطة
        </span>
      </div>

      <div class="screen-body">
        <div class="result-card ${success ? "success" : "fail"}">
          <div class="emoji">${success ? "😄" : "😢"}</div>
          <h3 class="screen-title">${success ? escapeHtml(result.playerName) : "لم يجب أحد"}</h3>
          ${
            success
              ? `<div class="result-score">+${numberFormatter.format(result.point)} نقطة</div>`
              : `<div class="result-score">0 نقطة</div>`
          }
          <p class="soft-copy">الإجابة الصحيحة: ${escapeHtml(result.answer)}</p>
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">عند الضغط على التالي ستعود اللوحة، أو ستظهر صفحة الفوز إذا انتهت جميع الأسئلة.</span>
        ${isHost() ? `<button class="primary-button" data-action="advance-result" type="button">التالي</button>` : ""}
      </div>
    </div>
  `;
}

function renderFinishedScreen() {
  const winner = state.room?.game?.winner;
  const rankings = winner?.rankings || [];
  const losers = rankings.slice(1);

  if (!winner) {
    return renderLoadingScreen();
  }

  return `
    <div class="screen-shell finish-shell">
      <div class="screen-header">
        <div>
          <h2>انتهت المباراة</h2>
          <p class="screen-copy">جميع أزرار اللوحة أُغلقت، وهذه النتيجة النهائية للجولة الحالية.</p>
        </div>
        <span class="status-chip success">اكتملت كل الأسئلة</span>
      </div>

      <div class="screen-body">
        <div class="finish-card">
          <div class="emoji">👑</div>
          <h2>${escapeHtml(winner.name)}</h2>
          <div class="winner-score">${numberFormatter.format(winner.score || 0)} نقطة</div>
          <p class="soft-copy">الفائز بالمركز الأول في هذه الجولة.</p>

          ${
            losers.length
              ? `
                <div class="losers-list">
                  ${losers
                    .map(
                      (loser) => `
                        <div class="loser-row">
                          <strong>${escapeHtml(loser.name)}</strong>
                          <span>${numberFormatter.format(loser.score || 0)} نقطة</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </div>

      <div class="screen-footer">
        <span class="inline-note">يمكنك إعادة اللعب بنفس الملف أو العودة للرئيسية لاختيار ملف جديد.</span>
        ${
          isHost()
            ? `
              <div class="row">
                <button class="secondary-button" data-action="go-home" type="button">تغيير الملف</button>
                <button class="primary-button" data-action="reset-same-file" type="button">لعبة جديدة بنفس الملف</button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderPlayerChip(player, currentTurnId) {
  const current = player.id === currentTurnId;
  return `
    <div class="player-chip">
      <strong>${escapeHtml(player.name)}</strong>
      <small>${current ? "صاحب الدور الحالي" : player.role === "player" ? "لاعب" : "متفرج"}</small>
      ${
        player.role === "player"
          ? `<span class="pill" style="background:${escapeHtml(player.color)}22;border-color:${escapeHtml(player.color)}55;">${numberFormatter.format(player.score || 0)} نقطة</span>`
          : ""
      }
    </div>
  `;
}

function renderScoreCard(player, currentTurnId) {
  return `
    <button
      class="score-card ${player.id === currentTurnId ? "current" : ""}"
      type="button"
      data-action="set-turn"
      data-player-id="${escapeHtml(player.id)}"
      style="background: linear-gradient(180deg, ${escapeHtml(player.color)} 0%, ${escapeHtml(mixColor(player.color, "#3a2516", 0.32))} 100%);"
      ${!isHost() ? "disabled" : ""}
    >
      <strong>${escapeHtml(player.name)}</strong>
      <span>${numberFormatter.format(player.score || 0)} نقطة</span>
      <small>${player.id === currentTurnId ? "يختار السؤال الآن" : "اضغط لتحديد الدور"}</small>
    </button>
  `;
}

function renderBoardCategoryCard(category) {
  const board = state.room?.game?.board || {};
  const categoryBoard = board[category.id] || {};
  return `
    <div class="category-card">
      <div class="column">
        <h3>${escapeHtml(category.name)}</h3>
        <small>٣ أزرار من الأسئلة لهذا التصنيف</small>
      </div>
      <div class="point-column">
        ${POINT_VALUES.map((point) => renderPointButton(category, point, categoryBoard[String(point)] || {})).join("")}
      </div>
    </div>
  `;
}

function renderPointButton(category, point, cell) {
  const used = cell.state === "used" || cell.state === "pending";
  const currentTurnId = state.room?.game?.turnPlayerId || "";
  const canOpen = isHost() && !used && Boolean(currentTurnId);
  const style = cell.color ? `style="background:${escapeHtml(cell.color)};"` : "";
  const label = cell.state === "pending" ? "جاري العرض" : numberFormatter.format(point);
  const footer = cell.playerName ? `<small>${escapeHtml(cell.playerName)}</small>` : used ? "<small>مغلق</small>" : "<small>جاهز</small>";

  return `
    <button
      class="point-button ${used ? "used" : ""}"
      type="button"
      data-action="open-question"
      data-category-id="${escapeHtml(category.id)}"
      data-point="${point}"
      ${style}
      ${canOpen ? "" : "disabled"}
    >
      <span>${label}</span>
      ${footer}
    </button>
  `;
}

async function readExcelFile(file) {
  if (!window.XLSX) {
    showToast("مكتبة قراءة Excel لم تُحمّل.");
    return;
  }

  state.loadingFile = true;
  state.uploadProgress = 3;
  state.uploadStats = {
    categories: 0,
    questions: 0,
    sheetName: "",
    fileName: file.name,
  };
  state.localFileData = null;
  render();

  try {
    const buffer = await readFileAsArrayBuffer(file);
    state.uploadProgress = 58;
    render();

    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const bodyRows = rows.slice(1);
    const categoryMap = new Map();
    let questionCounter = 0;

    state.uploadStats.sheetName = sheetName || "";

    for (let index = 0; index < bodyRows.length; index += 1) {
      const row = bodyRows[index];
      const categoryName = String(row[0] || "").trim();
      const questionText = String(row[1] || "").trim();
      const optionsText = String(row[2] || "").trim();
      const answerText = String(row[3] || "").trim();
      const point = normalizePoint(row[4]);

      if (!categoryName || !questionText || !POINT_VALUES.includes(point)) {
        continue;
      }

      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, {
          id: `cat-${categoryMap.size + 1}`,
          name: categoryName,
          questionsByPoint: {
            200: [],
            400: [],
            600: [],
          },
        });
      }

      const category = categoryMap.get(categoryName);
      questionCounter += 1;
      category.questionsByPoint[point].push({
        id: `q-${questionCounter}`,
        question: questionText,
        options: optionsText,
        optionsList: splitOptions(optionsText),
        answer: answerText,
        point,
      });

      if (index % 12 === 0 || index === bodyRows.length - 1) {
        state.uploadStats.categories = categoryMap.size;
        state.uploadStats.questions = questionCounter;
        state.uploadProgress = 58 + Math.round(((index + 1) / bodyRows.length) * 42);
        render();
        await nextFrame();
      }
    }

    const categories = [...categoryMap.values()];
    if (!categories.length) {
      throw new Error("No valid questions found.");
    }

    state.localFileData = {
      fileName: file.name,
      sheetName,
      questionCount: questionCounter,
      categoryCount: categories.length,
      categories,
    };
    state.uploadProgress = 100;
    state.uploadStats.categories = categories.length;
    state.uploadStats.questions = questionCounter;
    showToast("اكتملت قراءة ملف Excel.");
  } catch (error) {
    console.error(error);
    state.localFileData = null;
    state.uploadProgress = 0;
    state.uploadStats.categories = 0;
    state.uploadStats.questions = 0;
    showToast("تعذر قراءة الملف. تأكد أنه بصيغة Excel صحيحة.");
  } finally {
    state.loadingFile = false;
    render();
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.max(3, Math.round((event.loaded / event.total) * 55));
      state.uploadProgress = percent;
      render();
    };

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsArrayBuffer(file);
  });
}

async function createRoomFromUploadedFile() {
  if (!state.localFileData) {
    showToast("ارفع ملف Excel أولاً.");
    return;
  }

  setBusy(true);
  try {
    const roomCode = await generateRoomCode();
    const now = Date.now();
    const categories = JSON.parse(JSON.stringify(state.localFileData.categories));
    const roomData = {
      code: roomCode,
      createdAt: now,
      ownerUid: state.authUid || "",
      ownerClientId: state.clientId,
      sourceFileName: state.localFileData.fileName,
      sourceSheetName: state.localFileData.sheetName,
      questionCount: state.localFileData.questionCount,
      categoryCount: state.localFileData.categoryCount,
      dataset: {
        categories,
      },
      players: {},
      chat: {
        welcome: {
          id: "welcome",
          type: "system",
          text: "تم إنشاء الغرفة. يمكنكم الانضمام كلاعبين أو متفرجين، والدردشة متاحة للجميع.",
          createdAt: now,
        },
      },
      game: {
        status: "lobby",
        selectedCategoryIds: [],
        board: {},
        currentQuestion: null,
        lastResult: null,
        winner: null,
        turnPlayerId: "",
      },
    };

    await set(ref(db, `rooms/${roomCode}`), roomData);
    state.roomCode = roomCode;
    state.roomMissing = false;
    state.playerId = "";
    updateUrl(roomCode);
    subscribeToRoom(roomCode);
    showToast("تم إنشاء الغرفة بنجاح.");
  } finally {
    setBusy(false);
  }
}

async function generateRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }

    const snapshot = await get(ref(db, `rooms/${code}`));
    if (!snapshot.exists()) {
      return code;
    }
  }

  throw new Error("Failed to generate a unique room code.");
}

function subscribeToRoom(roomCode) {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  state.unsubscribeRoom = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      state.room = null;
      state.roomMissing = true;
      render();
      return;
    }

    state.roomMissing = false;
    state.room = snapshot.val();
    state.room.code = state.room.code || roomCode;
    restorePlayerIdentity();
    syncDraftColor();
    render();
  });
}

function restorePlayerIdentity() {
  const room = state.room;
  if (!room) {
    return;
  }

  const storedPlayerId = localStorage.getItem(getPlayerStorageKey(room.code)) || state.playerId;
  if (storedPlayerId && room.players?.[storedPlayerId]) {
    state.playerId = storedPlayerId;
    const currentPlayer = room.players[storedPlayerId];
    state.joinDraft.name = currentPlayer.name || state.joinDraft.name;
    if (currentPlayer.color) {
      state.joinDraft.color = currentPlayer.color;
    }
    state.joinDraft.role = currentPlayer.role || state.joinDraft.role;
    return;
  }

  state.playerId = "";
}

async function joinCurrentRoom() {
  const room = state.room;
  if (!room) {
    return;
  }

  const trimmedName = state.joinDraft.name.trim();
  if (!trimmedName) {
    showToast("اكتب اسمك أولاً.");
    return;
  }

  const players = getPlayers(room);
  const gameStarted = room.game?.status && room.game.status !== "lobby";
  const forceSpectator = gameStarted || players.length >= 4;
  let role = forceSpectator ? "spectator" : state.joinDraft.role;
  const availableColors = getAvailableColors();
  let chosenColor = role === "player" ? state.joinDraft.color : "";

  if (role === "player" && !availableColors.find((color) => color.value === chosenColor)) {
    chosenColor = availableColors[0]?.value || "";
  }

  if (role === "player" && !chosenColor) {
    role = "spectator";
  }

  const playerId = state.playerId || `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    id: playerId,
    name: trimmedName,
    role,
    color: role === "player" ? chosenColor : "",
    score: room.players?.[playerId]?.score || 0,
    joinedAt: room.players?.[playerId]?.joinedAt || Date.now(),
    clientId: state.clientId,
    uid: state.authUid || "",
  };

  setBusy(true);
  try {
    await runTransaction(ref(db, `rooms/${room.code}/players`), (currentPlayers) => {
      const nextPlayers = currentPlayers || {};
      const playerEntries = Object.values(nextPlayers).filter(Boolean);
      const currentRoomPlayers = playerEntries.filter((player) => player.role === "player" && player.id !== playerId);

      if (payload.role === "player" && currentRoomPlayers.length >= 4) {
        payload.role = "spectator";
        payload.color = "";
      }

      if (payload.role === "player") {
        const usedColors = new Set(currentRoomPlayers.map((player) => player.color));
        if (usedColors.has(payload.color)) {
          const fallback = PLAYER_COLORS.find((color) => !usedColors.has(color.value));
          if (!fallback) {
            payload.role = "spectator";
            payload.color = "";
          } else {
            payload.color = fallback.value;
          }
        }
      }

      nextPlayers[playerId] = payload;
      return nextPlayers;
    });

    state.playerId = playerId;
    localStorage.setItem(getPlayerStorageKey(room.code), playerId);
    state.joinDraft.role = payload.role;
    if (payload.color) {
      state.joinDraft.color = payload.color;
    }
    await sendSystemChatMessage(`${trimmedName} انضم إلى الغرفة ${payload.role === "player" ? "كلاعب" : "كمتفرج"}.`, false);
  } finally {
    setBusy(false);
  }
}

async function startMatch() {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  const allCategories = getCategories(room);
  const allIds = allCategories.map((category) => category.id);
  const selectedIds = allCategories.length === 6 ? allIds : [];
  const updates = {
    [`rooms/${room.code}/game/status`]: "category-select",
    [`rooms/${room.code}/game/selectedCategoryIds`]: selectedIds,
    [`rooms/${room.code}/game/board`]: {},
    [`rooms/${room.code}/game/currentQuestion`]: null,
    [`rooms/${room.code}/game/lastResult`]: null,
    [`rooms/${room.code}/game/winner`]: null,
    [`rooms/${room.code}/game/turnPlayerId`]: "",
  };

  getPlayers(room).forEach((player) => {
    updates[`rooms/${room.code}/players/${player.id}/score`] = 0;
  });

  await writeUpdates(updates);
}

async function toggleCategory(categoryId) {
  const room = state.room;
  if (!room || !isHost() || getCategories(room).length === 6) {
    return;
  }

  const selectedIds = [...(room.game?.selectedCategoryIds || [])];
  const index = selectedIds.indexOf(categoryId);
  if (index >= 0) {
    selectedIds.splice(index, 1);
  } else if (selectedIds.length < 6) {
    selectedIds.push(categoryId);
  }

  await writeUpdates({
    [`rooms/${room.code}/game/selectedCategoryIds`]: selectedIds,
  });
}

async function confirmCategories() {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  const selectedIds = room.game?.selectedCategoryIds || [];
  if (selectedIds.length !== 6) {
    showToast("يجب اختيار ٦ تصنيفات بالضبط.");
    return;
  }

  const board = buildBoard(selectedIds);
  await writeUpdates({
    [`rooms/${room.code}/game/status`]: "board",
    [`rooms/${room.code}/game/board`]: board,
    [`rooms/${room.code}/game/turnPlayerId`]: "",
    [`rooms/${room.code}/game/currentQuestion`]: null,
    [`rooms/${room.code}/game/lastResult`]: null,
    [`rooms/${room.code}/game/winner`]: null,
  });
}

async function setTurnPlayer(playerId) {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  if (!room.players?.[playerId] || room.players[playerId].role !== "player") {
    return;
  }

  await writeUpdates({
    [`rooms/${room.code}/game/turnPlayerId`]: playerId,
  });
}

async function openQuestion(categoryId, point) {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  const currentTurnId = room.game?.turnPlayerId || "";
  if (!currentTurnId) {
    showToast("حدد صاحب الدور أولاً.");
    return;
  }

  const category = getCategories(room).find((item) => item.id === categoryId);
  const cell = room.game?.board?.[categoryId]?.[String(point)];
  if (!category || cell?.state === "used" || cell?.state === "pending") {
    return;
  }

  const pool = category.questionsByPoint?.[String(point)] || category.questionsByPoint?.[point] || [];
  if (!pool.length) {
    showToast("لا يوجد سؤال متاح لهذا الزر.");
    return;
  }

  const selectedQuestion = pool[Math.floor(Math.random() * pool.length)];
  const currentQuestion = {
    ...selectedQuestion,
    categoryId,
    categoryName: category.name,
    point,
    boardKey: `${categoryId}:${point}`,
  };

  await writeUpdates({
    [`rooms/${room.code}/game/status`]: "question",
    [`rooms/${room.code}/game/currentQuestion`]: currentQuestion,
    [`rooms/${room.code}/game/board/${categoryId}/${point}`]: {
      state: "pending",
      point,
      playerName: "",
      color: "",
      questionId: selectedQuestion.id,
    },
  });
}

async function goToAnswerSelection() {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  state.pendingResponderId = "none";
  await writeUpdates({
    [`rooms/${room.code}/game/status`]: "answer-select",
  });
}

async function commitAnswer(responderId) {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  const question = room.game?.currentQuestion;
  if (!question) {
    return;
  }

  const categoryId = question.categoryId;
  const point = Number(question.point);
  const winnerPlayer = responderId && responderId !== "none" ? room.players?.[responderId] : null;
  const nextTurnId = getNextTurnPlayerId(room, room.game?.turnPlayerId);
  const updates = {
    [`rooms/${room.code}/game/status`]: "answer-result",
    [`rooms/${room.code}/game/currentQuestion`]: null,
    [`rooms/${room.code}/game/turnPlayerId`]: nextTurnId,
  };

  if (winnerPlayer) {
    const nextScore = Number(winnerPlayer.score || 0) + point;
    updates[`rooms/${room.code}/players/${winnerPlayer.id}/score`] = nextScore;
    updates[`rooms/${room.code}/game/board/${categoryId}/${point}`] = {
      state: "used",
      point,
      playerId: winnerPlayer.id,
      playerName: winnerPlayer.name,
      color: winnerPlayer.color,
      questionId: question.id,
    };
    updates[`rooms/${room.code}/game/lastResult`] = {
      success: true,
      playerId: winnerPlayer.id,
      playerName: winnerPlayer.name,
      point,
      answer: question.answer,
      categoryName: question.categoryName,
    };
  } else {
    updates[`rooms/${room.code}/game/board/${categoryId}/${point}`] = {
      state: "used",
      point,
      playerId: "",
      playerName: "لا أحد",
      color: "#ff6b6b",
      questionId: question.id,
    };
    updates[`rooms/${room.code}/game/lastResult`] = {
      success: false,
      playerId: "",
      playerName: "لا أحد",
      point,
      answer: question.answer,
      categoryName: question.categoryName,
    };
  }

  await writeUpdates(updates);
}

async function advanceFromResult() {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  if (isBoardComplete(room.game?.board || {})) {
    const winner = calculateWinner(room);
    await writeUpdates({
      [`rooms/${room.code}/game/status`]: "finished",
      [`rooms/${room.code}/game/winner`]: winner,
    });
    return;
  }

  await writeUpdates({
    [`rooms/${room.code}/game/status`]: "board",
  });
}

async function resetGameWithSameFile() {
  const room = state.room;
  if (!room || !isHost()) {
    return;
  }

  const allCategories = getCategories(room);
  const selectedIds = allCategories.length === 6 ? allCategories.map((category) => category.id) : [];
  const updates = {
    [`rooms/${room.code}/game/status`]: "category-select",
    [`rooms/${room.code}/game/selectedCategoryIds`]: selectedIds,
    [`rooms/${room.code}/game/board`]: {},
    [`rooms/${room.code}/game/currentQuestion`]: null,
    [`rooms/${room.code}/game/lastResult`]: null,
    [`rooms/${room.code}/game/winner`]: null,
    [`rooms/${room.code}/game/turnPlayerId`]: "",
  };

  getPlayers(room).forEach((player) => {
    updates[`rooms/${room.code}/players/${player.id}/score`] = 0;
  });

  await writeUpdates(updates);
}

async function writeUpdates(updates) {
  setBusy(true);
  try {
    await update(ref(db), updates);
  } finally {
    setBusy(false);
  }
}

async function sendChatMessage() {
  const text = elements.chatInput.value.trim();
  if (!text || !canUseChat()) {
    return;
  }

  elements.chatInput.value = "";
  elements.chatSendBtn.disabled = true;
  await pushChatMessage({
    type: "user",
    text,
    senderName: getCurrentPlayer()?.name || "لاعب",
    playerId: state.playerId,
    createdAt: Date.now(),
  });
}

async function sendSystemChatMessage(text, toast = true) {
  if (!state.roomCode || !state.room) {
    return;
  }

  await pushChatMessage({
    type: "system",
    text,
    senderName: "النظام",
    createdAt: Date.now(),
  });

  if (toast) {
    showToast("تم إرسال الرسالة إلى الدردشة.");
  }
}

async function pushChatMessage(message) {
  const roomCode = state.room?.code || state.roomCode;
  if (!roomCode) {
    return;
  }

  const messageRef = push(ref(db, `rooms/${roomCode}/chat`));
  await set(messageRef, {
    id: messageRef.key,
    ...message,
  });
}

async function copyRoomLink() {
  const link = buildShareLink(state.room?.code || state.roomCode || "");
  if (!link) {
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    showToast("تم نسخ رابط الغرفة.");
  } catch (error) {
    console.error(error);
    showToast(link);
  }
}

function goHome(resetFile) {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }

  state.room = null;
  state.roomCode = "";
  state.roomMissing = false;
  state.playerId = "";
  state.pendingResponderId = "none";
  updateUrl("");

  if (resetFile) {
    state.localFileData = null;
    state.uploadProgress = 0;
    state.uploadStats = { categories: 0, questions: 0, sheetName: "", fileName: "" };
  }

  render();
}

function setBusy(value) {
  state.actionBusy = value;
  render();
}

function canUseChat() {
  return Boolean(state.room && getCurrentPlayer());
}

function getPlayers(room = state.room) {
  return Object.values(room?.players || {})
    .filter((player) => player.role === "player")
    .sort((first, second) => Number(first.joinedAt || 0) - Number(second.joinedAt || 0));
}

function getSpectators(room = state.room) {
  return Object.values(room?.players || {})
    .filter((player) => player.role !== "player")
    .sort((first, second) => Number(first.joinedAt || 0) - Number(second.joinedAt || 0));
}

function getCategories(room = state.room) {
  return Array.isArray(room?.dataset?.categories) ? room.dataset.categories : [];
}

function getSelectedCategories(room = state.room) {
  const selectedIds = room?.game?.selectedCategoryIds || [];
  const categoryMap = new Map(getCategories(room).map((category) => [category.id, category]));
  return selectedIds.map((id) => categoryMap.get(id)).filter(Boolean);
}

function getCurrentPlayer() {
  return state.room?.players?.[state.playerId] || null;
}

function getPlayerName(playerId) {
  return state.room?.players?.[playerId]?.name || "لاعب";
}

function getAvailableColors() {
  const usedColors = new Set(
    getPlayers().filter((player) => player.id !== state.playerId).map((player) => player.color),
  );
  return PLAYER_COLORS.filter((color) => !usedColors.has(color.value));
}

function getChatMessages(room = state.room) {
  return Object.values(room?.chat || {})
    .filter(Boolean)
    .sort((first, second) => Number(first.createdAt || 0) - Number(second.createdAt || 0))
    .slice(-40);
}

function getQuestionsCount(category, point) {
  return category?.questionsByPoint?.[String(point)]?.length || category?.questionsByPoint?.[point]?.length || 0;
}

function normalizePoint(value) {
  const numeric = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function splitOptions(optionText) {
  const cleaned = String(optionText || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const normalized = cleaned.replace(/([A-Za-z\u0600-\u06FF]\))/g, "\n$1");
  return normalized
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildBoard(selectedIds) {
  return selectedIds.reduce((board, categoryId) => {
    board[categoryId] = {
      200: { state: "available", point: 200, playerName: "", color: "" },
      400: { state: "available", point: 400, playerName: "", color: "" },
      600: { state: "available", point: 600, playerName: "", color: "" },
    };
    return board;
  }, {});
}

function isBoardComplete(board) {
  const cells = Object.values(board || {}).flatMap((categoryBoard) => Object.values(categoryBoard || {}));
  return cells.length > 0 && cells.every((cell) => cell.state === "used");
}

function calculateWinner(room) {
  const rankings = getPlayers(room)
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: Number(player.score || 0),
      color: player.color,
    }))
    .sort((first, second) => second.score - first.score);

  return {
    ...(rankings[0] || { id: "", name: "لا يوجد فائز", score: 0, color: "" }),
    rankings,
  };
}

function getNextTurnPlayerId(room, currentTurnId) {
  const players = getPlayers(room);
  if (!players.length) {
    return "";
  }

  const currentIndex = players.findIndex((player) => player.id === currentTurnId);
  if (currentIndex < 0) {
    return players[0].id;
  }

  return players[(currentIndex + 1) % players.length].id;
}

function syncDraftColor() {
  const availableColors = getAvailableColors();
  if (!availableColors.length) {
    state.joinDraft.color = "";
    return;
  }

  if (!availableColors.some((color) => color.value === state.joinDraft.color)) {
    state.joinDraft.color = availableColors[0].value;
  }
}

function buildShareLink(code) {
  if (!code) {
    return "";
  }

  const base = window.location.hostname.includes("github.io")
    ? `${window.location.origin}${window.location.pathname}`
    : SHARE_ROOT;

  return `${base.replace(/\?.*$/, "")}?room=${encodeURIComponent(code)}`;
}

function updateUrl(roomCode) {
  const url = new URL(window.location.href);
  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState({}, "", url.toString());
}

function getRoomCodeFromUrl() {
  const url = new URL(window.location.href);
  return (url.searchParams.get("room") || "").trim().toUpperCase();
}

function isHost() {
  const room = state.room;
  if (!room) {
    return false;
  }
  return room.ownerClientId === state.clientId || (state.authUid && room.ownerUid === state.authUid);
}

function getOrCreateClientId() {
  const stored = localStorage.getItem(STORAGE_CLIENT_ID);
  if (stored) {
    return stored;
  }

  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(STORAGE_CLIENT_ID, clientId);
  return clientId;
}

function getPlayerStorageKey(roomCode) {
  return `${STORAGE_PLAYER_PREFIX}${roomCode}`;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.hidden = false;
  elements.toast.textContent = message;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function syncViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
}

function mixColor(primary, secondary, amount) {
  const first = hexToRgb(primary);
  const second = hexToRgb(secondary);
  const mix = {
    r: Math.round(first.r + (second.r - first.r) * amount),
    g: Math.round(first.g + (second.g - first.g) * amount),
    b: Math.round(first.b + (second.b - first.b) * amount),
  };
  return `rgb(${mix.r}, ${mix.g}, ${mix.b})`;
}

function hexToRgb(value) {
  const hex = value.replace("#", "");
  const normalized = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  const int = Number.parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

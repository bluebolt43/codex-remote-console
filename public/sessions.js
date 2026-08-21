const list = document.querySelector("#session-list");
const count = document.querySelector("#session-count");
const error = document.querySelector("#manager-error");
const newSession = document.querySelector("#new-session");
const settings = document.querySelector("#settings");
const settingsDialog = document.querySelector("#settings-dialog");
const language = document.querySelector("#language");
const customPrompt = document.querySelector("#custom-prompt");
const saveSettings = document.querySelector("#save-settings");
const refresh = document.querySelector("#refresh");
const picker = document.querySelector("#folder-picker");
const folderPath = document.querySelector("#folder-path");
const folderList = document.querySelector("#folder-list");
const folderUp = document.querySelector("#folder-up");
const newFolderName = document.querySelector("#new-folder-name");
const createFolder = document.querySelector("#create-folder");
const createSession = document.querySelector("#create-session");
let parentPath = null;
const settingsKey = "codex-remote-console-settings";
const translations = {
  en: { managerSubtitle: "session manager", settings: "Settings", newSession: "＋ New", sessions: "Sessions", refresh: "Refresh", chooseWorkspace: "Choose workspace", newFolderName: "New folder name", newFolder: "＋ Folder", cancel: "Cancel", createSession: "Create session", language: "Language", workspaceRoot: "Workspace root", workspaceTodo: "This setting is not supported yet", customButtonText: "Custom button text", save: "Save", noActivity: "No activity yet", newSessionTitle: "New session", delete: "Delete", stopBeforeDelete: "Stop this session before deleting it", deleteTitle: "Permanently delete this session", deleteConfirm: (title) => `Permanently delete “${title}”?\n\nThis cannot be undone.`, deleteFailed: "Delete failed", empty: "No sessions yet", saveFailed: "Could not save settings" },
  "zh-Hant": { managerSubtitle: "Session 管理", settings: "設定", newSession: "＋ 新增", sessions: "Sessions", refresh: "重新整理", chooseWorkspace: "選擇工作目錄", newFolderName: "新資料夾名稱", newFolder: "＋ 資料夾", cancel: "取消", createSession: "建立 Session", language: "語言", workspaceRoot: "Workspace 根目錄", workspaceTodo: "此設定目前暫不支援", customButtonText: "自訂按鈕文字", save: "儲存", noActivity: "尚無活動", newSessionTitle: "新 Session", delete: "刪除", stopBeforeDelete: "請先中斷此 Session", deleteTitle: "永久刪除此 Session", deleteConfirm: (title) => `永久刪除「${title}」？\n\n此動作無法復原。`, deleteFailed: "刪除失敗", empty: "尚未建立 Session", saveFailed: "設定儲存失敗" },
};

function readSettings() {
  try {
    return { language: "zh-Hant", customPrompt: "continue", ...JSON.parse(localStorage.getItem(settingsKey)) };
  } catch {
    return { language: "zh-Hant", customPrompt: "continue" };
  }
}

const activeLanguage = readSettings().language;
const t = translations[activeLanguage] || translations["zh-Hant"];
document.documentElement.lang = activeLanguage;
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t[element.dataset.i18n];
for (const element of document.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = t[element.dataset.i18nPlaceholder];

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatTime(value) {
  if (!value) return t.noActivity;
  return new Intl.DateTimeFormat(activeLanguage === "en" ? "en" : "zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(value * 1000));
}

function renderThread(thread) {
  const resumable = thread.historyMode !== "paginated";
  const card = document.createElement("article");
  card.className = "session-card";
  const link = document.createElement(resumable ? "a" : "div");
  link.className = "session-main";
  if (resumable) link.href = `/session.html?threadId=${encodeURIComponent(thread.id)}`;
  else card.classList.add("unavailable");
  const status = resumable ? (thread.status?.type || "notLoaded") : "read-only";
  const title = thread.name || thread.preview || t.newSessionTitle;
  const preview = thread.preview && thread.preview !== title ? thread.preview : thread.id;
  link.innerHTML = `<div class="session-title"><strong></strong><span class="thread-status ${status}"><i></i>${status}</span></div><p></p><time></time>`;
  link.querySelector("strong").textContent = title;
  link.querySelector("p").textContent = preview;
  link.querySelector("time").textContent = formatTime(thread.updatedAt || thread.createdAt);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-session";
  remove.textContent = t.delete;
  remove.disabled = status === "active";
  remove.title = remove.disabled ? t.stopBeforeDelete : t.deleteTitle;
  remove.addEventListener("click", async () => {
    if (!confirm(t.deleteConfirm(title))) return;
    remove.disabled = true;
    try {
      await api("/api/threads", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id }),
      });
      await load();
    } catch (cause) {
      error.textContent = cause.message;
      error.classList.remove("hidden");
      alert(`${t.deleteFailed}: ${cause.message}`);
      remove.disabled = false;
    }
  });
  card.append(link, remove);
  return card;
}

async function load() {
  try {
    const result = await api("/api/threads");
    count.textContent = result.data.length;
    list.replaceChildren(...result.data.map(renderThread));
    if (!result.data.length) list.innerHTML = `<div class="manager-empty">${t.empty}</div>`;
    error.classList.add("hidden");
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
  }
}

async function browse(path = "") {
  try {
    const result = await api(`/api/directories?path=${encodeURIComponent(path)}`);
    folderPath.value = result.path;
    parentPath = result.parent;
    folderUp.disabled = result.path === "/";
    folderList.replaceChildren(...result.directories.map((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `▸ ${name}`;
      button.addEventListener("click", () => browse(result.path === "/" ? `/${name}` : `${result.path}/${name}`));
      return button;
    }));
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
  }
}

newSession.addEventListener("click", () => {
  picker.showModal();
  browse("/");
});

settings.addEventListener("click", () => {
  const saved = readSettings();
  language.value = saved.language;
  customPrompt.value = saved.customPrompt;
  settingsDialog.showModal();
});

saveSettings.addEventListener("click", async () => {
  const text = customPrompt.value.trim() || "continue";
  saveSettings.disabled = true;
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ language: language.value, customPrompt: text }));
    settingsDialog.close();
    error.classList.add("hidden");
    location.reload();
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
    alert(`${t.saveFailed}: ${cause.message}`);
  } finally {
    saveSettings.disabled = false;
  }
});

folderUp.addEventListener("click", () => browse(parentPath));
folderPath.addEventListener("change", () => browse(folderPath.value));
createFolder.addEventListener("click", async () => {
  const name = newFolderName.value.trim();
  if (!name) {
    newFolderName.focus();
    return;
  }
  createFolder.disabled = true;
  try {
    const result = await api("/api/directories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent: folderPath.value, name }),
    });
    newFolderName.value = "";
    await browse(result.path);
    error.classList.add("hidden");
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
  } finally {
    createFolder.disabled = false;
  }
});
newFolderName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createFolder.click();
  }
});
createSession.addEventListener("click", async () => {
  createSession.disabled = true;
  try {
    const result = await api("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: folderPath.value }),
    });
    location.href = `/session.html?threadId=${encodeURIComponent(result.thread.id)}`;
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
    createSession.disabled = false;
  }
});

refresh.addEventListener("click", load);
load();
setInterval(load, 3000);

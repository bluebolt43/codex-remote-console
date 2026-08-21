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
const logout = document.querySelector("#logout");
const lastLogin = document.querySelector("#last-login");
const lastLoginSetting = document.querySelector("#last-login-setting");
const securityActivity = document.querySelector("#security-activity");
const securityEvents = document.querySelector("#security-events");
const deviceManagement = document.querySelector("#device-management");
const pairedDevices = document.querySelector("#paired-devices");
const sessionManagement = document.querySelector("#session-management");
const activeSessions = document.querySelector("#active-sessions");
let parentPath = null;
const settingsKey = "codex-remote-console-settings";
const translations = {
  en: { managerSubtitle: "session manager", logout: "Logout", settings: "Settings", newSession: "＋ New", sessions: "Sessions", refresh: "Refresh", chooseWorkspace: "Choose workspace", newFolderName: "New folder name", newFolder: "＋ Folder", cancel: "Cancel", createSession: "Create session", language: "Language", workspaceRoot: "Workspace root", workspaceTodo: "This setting is not supported yet", customButtonText: "Custom button text", lastLogin: "Last successful login", pairedDevices: "Paired devices", activeSessions: "Active login sessions", recentLogins: "Recent login activity", current: "Current", revoke: "Revoke", save: "Save", noActivity: "No activity yet", newSessionTitle: "New session", delete: "Delete", stopBeforeDelete: "Stop this session before deleting it", deleteTitle: "Permanently delete this session", deleteConfirm: (title) => `Permanently delete “${title}”?\n\nThis cannot be undone.`, deleteFailed: "Delete failed", empty: "No sessions yet", saveFailed: "Could not save settings" },
  "zh-Hant": { managerSubtitle: "Session 管理", logout: "登出", settings: "設定", newSession: "＋ 新增", sessions: "Sessions", refresh: "重新整理", chooseWorkspace: "選擇工作目錄", newFolderName: "新資料夾名稱", newFolder: "＋ 資料夾", cancel: "取消", createSession: "建立 Session", language: "語言", workspaceRoot: "Workspace 根目錄", workspaceTodo: "此設定目前暫不支援", customButtonText: "自訂按鈕文字", lastLogin: "最後一次成功登入", pairedDevices: "已配對裝置", activeSessions: "登入中的 Sessions", recentLogins: "最近登入活動", current: "目前使用中", revoke: "撤銷", save: "儲存", noActivity: "尚無活動", newSessionTitle: "新 Session", delete: "刪除", stopBeforeDelete: "請先中斷此 Session", deleteTitle: "永久刪除此 Session", deleteConfirm: (title) => `永久刪除「${title}」？\n\n此動作無法復原。`, deleteFailed: "刪除失敗", empty: "尚未建立 Session", saveFailed: "設定儲存失敗" },
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

function describeBrowser(userAgent) {
  const value = String(userAgent || "");
  const browser = value.match(/Edg\/(\d+)/) ? `Edge ${value.match(/Edg\/(\d+)/)[1]}`
    : value.match(/Chrome\/(\d+)/) ? `Chrome ${value.match(/Chrome\/(\d+)/)[1]}`
      : value.match(/Firefox\/(\d+)/) ? `Firefox ${value.match(/Firefox\/(\d+)/)[1]}`
        : value.match(/Version\/(\d+).*Safari/) ? `Safari ${value.match(/Version\/(\d+).*Safari/)[1]}`
          : (activeLanguage === "en" ? "Unknown browser" : "未知瀏覽器");
  const platform = /Android/.test(value) ? "Android"
    : /Windows/.test(value) ? "Windows"
      : /iPhone|iPad/.test(value) ? "iOS"
        : /Macintosh/.test(value) ? "macOS"
          : /Linux/.test(value) ? "Linux"
            : (activeLanguage === "en" ? "Unknown OS" : "未知系統");
  return `${browser} · ${platform}`;
}

function describeAddress(address) {
  const value = String(address || "unknown");
  const privateAddress = /^(10\.|192\.168\.|127\.|169\.254\.)/.test(value)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(value)
    || value === "::1" || /^f[cd][0-9a-f]{2}:/i.test(value);
  if (!privateAddress) return value;
  return activeLanguage === "en" ? `LAN via router (${value})` : `經由區網路由器 (${value})`;
}

function securityItem(title, detail, current, revoke) {
  const row = document.createElement("div");
  row.className = "security-item";
  const text = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${title}${current ? ` · ${t.current}` : ""}`;
  const small = document.createElement("small");
  small.textContent = detail;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t.revoke;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await revoke();
      if (result.current) return location.replace("/login.html");
      row.remove();
    } catch (cause) {
      error.textContent = cause.message;
      error.classList.remove("hidden");
      button.disabled = false;
    }
  });
  text.append(strong, small);
  row.append(text, button);
  return row;
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

settings.addEventListener("click", async () => {
  const saved = readSettings();
  language.value = saved.language;
  customPrompt.value = saved.customPrompt;
  const authStatus = await api("/api/auth/status");
  lastLoginSetting.classList.toggle("hidden", !authStatus.enabled);
  securityActivity.classList.toggle("hidden", !authStatus.enabled);
  deviceManagement.classList.toggle("hidden", !authStatus.enabled);
  sessionManagement.classList.toggle("hidden", !authStatus.enabled);
  lastLogin.textContent = authStatus.lastLoginAt
    ? new Intl.DateTimeFormat(activeLanguage === "en" ? "en" : "zh-TW", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(authStatus.lastLoginAt))
    : t.noActivity;
  const [activity, devices, sessions] = authStatus.enabled
    ? await Promise.all([api("/api/auth/security-events"), api("/api/auth/devices"), api("/api/auth/sessions")])
    : [{ events: [] }, { devices: [] }, { sessions: [] }];
  pairedDevices.replaceChildren(...devices.devices.map((device) => securityItem(
    device.name,
    `${device.sessionCount} session · ${device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString() : t.noActivity}`,
    device.current,
    () => api("/api/auth/devices", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: device.id }) }),
  )));
  activeSessions.replaceChildren(...sessions.sessions.map((session) => securityItem(
    describeBrowser(session.userAgent),
    `${describeAddress(session.ip)} · ${new Date(session.lastSeenAt).toLocaleString()}`,
    session.current,
    () => api("/api/auth/sessions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) }),
  )));
  securityEvents.replaceChildren(...activity.events.map((event) => {
    const row = document.createElement("div");
    row.className = `security-event ${event.success ? "success" : "failure"}${event.alert ? " alert" : ""}`;
    const labels = activeLanguage === "en"
      ? { pairing: "Device paired", login: "Login", "login-new-address": "Login from new address", "login-blocked": "Login address blocked", "device-revoked": "Device revoked", "session-revoked": "Session revoked" }
      : { pairing: "裝置配對", login: "登入", "login-new-address": "從新 IP 登入", "login-blocked": "登入 IP 已封鎖", "device-revoked": "裝置已撤銷", "session-revoked": "登入 Session 已撤銷" };
    const status = `${labels[event.type] || event.type} · ${event.success ? (activeLanguage === "en" ? "Success" : "成功") : (activeLanguage === "en" ? "Failed" : "失敗")}`;
    const time = new Intl.DateTimeFormat(activeLanguage === "en" ? "en" : "zh-TW", { dateStyle: "short", timeStyle: "medium" }).format(new Date(event.timestamp));
    row.innerHTML = `<strong></strong><span></span><small></small>`;
    row.querySelector("strong").textContent = status;
    row.querySelector("span").textContent = `${time} · ${describeAddress(event.ip)}`;
    row.querySelector("small").textContent = describeBrowser(event.userAgent);
    return row;
  }));
  if (!activity.events.length) securityEvents.textContent = t.noActivity;
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
logout.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/login.html");
});
api("/api/auth/status").then((status) => logout.classList.toggle("hidden", !status.enabled));
load();
setInterval(load, 3000);

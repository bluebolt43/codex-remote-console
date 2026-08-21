const messages = document.querySelector("#messages");
const status = document.querySelector("#status");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const model = document.querySelector("#model");
const effort = document.querySelector("#effort");
const quickPrompt = document.querySelector("#quick-prompt");
const attach = document.querySelector("#attach");
const imageInput = document.querySelector("#image-input");
const attachmentPreview = document.querySelector("#attachment-preview");
const approval = document.querySelector("#approval");
const empty = document.querySelector("#empty");
const weekly = document.querySelector("#weekly");
const threadId = new URLSearchParams(location.search).get("threadId");
const rendered = new Set();
const streaming = new Map();
let localMessageId = 0;
let attachments = [];
const savedSettings = (() => {
  try {
    return { language: "zh-Hant", customPrompt: "continue", ...JSON.parse(localStorage.getItem("codex-remote-console-settings")) };
  } catch {
    return { language: "zh-Hant", customPrompt: "continue" };
  }
})();
const translations = {
  en: { remoteSession: "remote session", readyInstructions: "Ready for instructions", emptyHint: "Enter a task and Codex will work in the current project.", stop: "Stop", send: "Send ↑", working: "working", ready: "ready", you: "YOU", activity: "ACTIVITY", image: "[image]", images: (count) => `[${count} images]`, approvalRequired: "Approval required", approvalFallback: "Codex requests approval", yes: "Yes", yesHint: "Allow once", alwaysYes: "Yes, never ask again", alwaysYesHint: "Do not ask again in this session", no: "No", noHint: "Decline", removeImage: "Remove image", imageAlt: (index) => `Image ${index}`, generatedImage: "Generated image", imageLoadFailed: "Image could not be loaded", viewPrompt: "View prompt", default: "Default", addImage: "Add image" },
  "zh-Hant": { remoteSession: "遠端 Session", readyInstructions: "等待指令", emptyHint: "輸入工作內容，Codex 會在目前專案中執行。", stop: "中斷", send: "送出 ↑", working: "執行中", ready: "就緒", you: "你", activity: "活動", image: "[圖片]", images: (count) => `[${count} 張圖片]`, approvalRequired: "需要授權", approvalFallback: "Codex 要求授權", yes: "是", yesHint: "僅允許這一次", alwaysYes: "是，不再詢問", alwaysYesHint: "目前 Session 不再詢問", no: "否", noHint: "拒絕", removeImage: "移除圖片", imageAlt: (index) => `圖片 ${index}`, generatedImage: "生成圖片", imageLoadFailed: "圖片無法載入", viewPrompt: "查看 Prompt", default: "預設", addImage: "新增圖片" },
};
const t = translations[savedSettings.language] || translations["zh-Hant"];
document.documentElement.lang = savedSettings.language;
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t[element.dataset.i18n];
model.options[0].textContent = t.default;
effort.options[0].textContent = t.default;
attach.title = t.addImage;
attach.ariaLabel = t.addImage;
const savedCustomPrompt = savedSettings.customPrompt;
quickPrompt.dataset.prompt = savedCustomPrompt;
quickPrompt.textContent = savedCustomPrompt;
quickPrompt.title = savedCustomPrompt;

function nextLocalId() {
  localMessageId += 1;
  return `local-${Date.now()}-${localMessageId}`;
}

function createWorkspaceImage(path, label) {
  const link = document.createElement("a");
  link.className = "workspace-image";
  link.href = `/api/generated-image?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(path)}`;
  link.target = "_blank";
  link.rel = "noopener";
  const image = document.createElement("img");
  image.src = link.href;
  image.alt = label || t.generatedImage;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    link.replaceChildren();
    const error = document.createElement("span");
    error.className = "image-error";
    error.textContent = t.imageLoadFailed;
    link.append(error);
  }, { once: true });
  link.append(image);
  return link;
}

function renderAssistantText(content, text) {
  const imageLink = /!?\[([^\]]+)\]\((\/[^)\n]+\.(?:png|jpe?g|webp|gif|avif))\)/gi;
  let cursor = 0;
  for (const match of text.matchAll(imageLink)) {
    content.append(document.createTextNode(text.slice(cursor, match.index)));
    const figure = document.createElement("figure");
    figure.className = "assistant-image";
    figure.append(createWorkspaceImage(match[2], match[1]));
    const caption = document.createElement("figcaption");
    caption.textContent = match[1];
    figure.append(caption);
    content.append(figure);
    cursor = match.index + match[0].length;
  }
  content.append(document.createTextNode(text.slice(cursor)));
}

function addMessage(kind, text, id = nextLocalId(), title) {
  if (rendered.has(id)) return;
  rendered.add(id);
  empty?.remove();
  const element = document.createElement("article");
  element.className = `message ${kind}`;
  element.dataset.id = id;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = title || (kind === "user" ? t.you : kind === "assistant" ? "CODEX" : t.activity);
  const content = document.createElement("span");
  if (kind === "assistant") renderAssistantText(content, text);
  else content.textContent = text;
  element.append(label, content);
  messages.append(element);
  messages.scrollTop = messages.scrollHeight;
}

function addGeneratedImage(item) {
  if (rendered.has(item.id)) return;
  if (!item.savedPath) {
    if (item.failure) addMessage("tool", item.failure.message || item.result || "Image generation failed", item.id, "IMAGE");
    return;
  }
  rendered.add(item.id);
  empty?.remove();
  const element = document.createElement("article");
  element.className = "message assistant generated-image";
  element.dataset.id = item.id;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = "CODEX · IMAGE";
  const link = createWorkspaceImage(item.savedPath, t.generatedImage);
  const image = link.querySelector("img");
  image.title = item.revisedPrompt || item.result || "";
  element.append(label, link);
  const promptText = item.revisedPrompt || item.result;
  if (promptText) {
    const details = document.createElement("details");
    details.className = "image-prompt";
    const summary = document.createElement("summary");
    summary.textContent = t.viewPrompt;
    const text = document.createElement("p");
    text.textContent = promptText;
    details.append(summary, text);
    element.append(details);
  }
  messages.append(element);
  messages.scrollTop = messages.scrollHeight;
}

function renderItem(item) {
  if (item.type === "userMessage") {
    addMessage("user", item.content.map((part) => part.text || (part.type === "image" || part.type === "localImage" ? t.image : "")).join("\n"), item.clientId || item.id);
  } else if (item.type === "agentMessage") {
    addMessage("assistant", item.text, item.id);
  } else if (item.type === "commandExecution") {
    addMessage("tool", `$ ${item.command}\n${item.aggregatedOutput || ""}`, item.id, "COMMAND");
  } else if (item.type === "fileChange") {
    addMessage("tool", `File changes: ${item.status}`, item.id, "FILES");
  } else if (item.type === "imageGeneration") {
    addGeneratedImage(item);
  } else if (item.type === "imageView") {
    addGeneratedImage({ ...item, savedPath: item.path });
  }
}

function setState(state) {
  const running = Boolean(state.active);
  status.innerHTML = `<i></i> ${running ? t.working : t.ready}`;
  status.classList.toggle("active", running);
  stop.disabled = !running;
  send.disabled = running;
  quickPrompt.disabled = running;
}

function handleCodex(message) {
  const { method, params = {} } = message;
  if (method === "item/agentMessage/delta") {
    let element = streaming.get(params.itemId);
    if (!element) {
      element = document.createElement("article");
      element.className = "message assistant";
      element.dataset.id = params.itemId;
      const label = document.createElement("span");
      label.className = "message-label";
      label.textContent = "CODEX";
      const content = document.createElement("span");
      content.className = "stream-content";
      element.append(label, content);
      empty?.remove();
      messages.append(element);
      streaming.set(params.itemId, element);
    }
    element.querySelector(".stream-content").textContent += params.delta;
    messages.scrollTop = messages.scrollHeight;
  } else if (method === "item/completed") {
    const existing = streaming.get(params.item?.id);
    if (existing) {
      existing.remove();
      streaming.delete(params.item.id);
      renderItem(params.item);
    } else if (params.item) renderItem(params.item);
  } else if (method === "error") {
    addMessage("tool", `Error: ${params.error?.message || params.message || "Unknown error"}`);
  }
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function load() {
  if (!threadId) {
    location.replace("/");
    return;
  }
  await api("/api/threads/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId }),
  });
  const [session, models] = await Promise.all([api(`/api/session?threadId=${encodeURIComponent(threadId)}`), api("/api/models")]);
  setState(session);
  for (const turn of session.thread.turns || []) for (const item of turn.items || []) renderItem(item);
  for (const entry of models.data || []) {
    const option = document.createElement("option");
    option.value = entry.model;
    option.textContent = entry.displayName;
    if (entry.isDefault) option.selected = true;
    model.append(option);
  }
  try {
    const usage = await api("/api/rate-limits");
    const limits = usage.rateLimits || {};
    const weeklyWindow = [limits.primary, limits.secondary]
      .filter(Boolean)
      .find((window) => (window.windowDurationMins || 0) >= 24 * 60);
    if (weeklyWindow) {
      const remainingPercent = 100 - Math.min(100, Math.max(0, weeklyWindow.usedPercent));
      weekly.textContent = `${Math.round(remainingPercent)}%`;
    }
  } catch {
    weekly.textContent = "--";
  }
}

const events = new EventSource(`/api/events?threadId=${encodeURIComponent(threadId)}`);
events.addEventListener("status", (event) => setState(JSON.parse(event.data)));
events.addEventListener("codex", (event) => handleCodex(JSON.parse(event.data)));
events.addEventListener("approval", (event) => {
  const request = JSON.parse(event.data);
  const detail = request.params.command || request.params.reason || t.approvalFallback;
  approval.classList.remove("hidden");
  approval.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t.approvalRequired;
  const pre = document.createElement("pre");
  pre.textContent = detail;
  const options = document.createElement("div");
  options.className = "approval-options";
  approval.append(title, pre, options);
  for (const [key, label, hint, decision] of [
    ["1", t.yes, t.yesHint, "accept"],
    ["2", t.alwaysYes, t.alwaysYesHint, "acceptForSession"],
    ["3", t.no, t.noHint, "decline"],
  ]) {
    const button = document.createElement("button");
    button.className = "approval-choice";
    button.dataset.decision = decision;
    button.dataset.requestId = request.requestId;
    button.dataset.threadId = threadId;
    const number = document.createElement("span");
    number.className = "approval-key";
    number.textContent = key;
    const text = document.createElement("span");
    text.className = "approval-text";
    const main = document.createElement("span");
    main.textContent = label;
    const description = document.createElement("small");
    description.textContent = hint;
    text.append(main, description);
    button.append(number, text);
    options.append(button);
  }
});
events.addEventListener("approval-resolved", () => approval.classList.add("hidden"));
events.addEventListener("fatal", (event) => addMessage("tool", event.data));

approval.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-decision]");
  if (!button) return;
  await api("/api/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(button.dataset),
  });
  approval.classList.add("hidden");
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text && !attachments.length) return;
  send.disabled = true;
  const clientUserMessageId = nextLocalId();
  try {
    const images = await Promise.all(attachments.map(async ({ file }) => {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      return api("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, type: file.type, data: dataUrl.split(",", 2)[1] }),
      });
    }));
    await api("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, text, images: images.map((image) => image.path), clientUserMessageId, model: model.value, effort: effort.value }),
    });
    addMessage("user", [text, attachments.length ? t.images(attachments.length) : ""].filter(Boolean).join("\n"), clientUserMessageId);
    prompt.value = "";
    attachments = [];
    renderAttachments();
  } catch (error) {
    addMessage("tool", error.message);
    send.disabled = false;
  }
});

function renderAttachments() {
  attachmentPreview.classList.toggle("hidden", !attachments.length);
  attachmentPreview.replaceChildren(...attachments.map((attachment, index) => {
    const item = document.createElement("div");
    const image = document.createElement("img");
    image.src = attachment.url;
    image.alt = attachment.file.name || t.imageAlt(index + 1);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.ariaLabel = t.removeImage;
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(attachment.url);
      attachments.splice(index, 1);
      renderAttachments();
    });
    item.append(image, remove);
    return item;
  }));
}

function addImages(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/") || file.size > 8_000_000 || attachments.length >= 4) continue;
    attachments.push({ file, url: URL.createObjectURL(file) });
  }
  renderAttachments();
}

attach.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => {
  addImages(imageInput.files);
  imageInput.value = "";
});
prompt.addEventListener("paste", (event) => {
  const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
  if (files.length) addImages(files);
});

stop.addEventListener("click", () => api("/api/interrupt", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ threadId }),
}).catch((error) => addMessage("tool", error.message)));

quickPrompt.addEventListener("click", () => {
  prompt.value = quickPrompt.dataset.prompt;
  composer.requestSubmit();
});

load().catch((error) => {
  status.textContent = "error";
  addMessage("tool", error.message);
});

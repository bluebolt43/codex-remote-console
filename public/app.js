import { appTranslations, readSettings, speechLocaleByLanguage } from "./i18n.js";
import {
  HISTORY_BUFFER_SIZE,
  HISTORY_MARGIN_SIZE,
  HistoryWindow,
  historyTriggerIndexes,
} from "./history-window.js";

const messages = document.querySelector("#messages");
const historyElement = document.querySelector("#history");
const liveMessages = document.querySelector("#live");
const status = document.querySelector("#status");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const model = document.querySelector("#model");
const effort = document.querySelector("#effort");
const quickPrompt = document.querySelector("#quick-prompt");
const attach = document.querySelector("#attach");
const voice = document.querySelector("#voice");
const imageInput = document.querySelector("#image-input");
const attachmentPreview = document.querySelector("#attachment-preview");
const approval = document.querySelector("#approval");
const empty = document.querySelector("#empty");
const weekly = document.querySelector("#weekly");
const browseFilesButton = document.querySelector("#browse-files");
const fileBrowser = document.querySelector("#file-browser");
const closeFiles = document.querySelector("#close-files");
const fileUp = document.querySelector("#file-up");
const filePath = document.querySelector("#file-path");
const fileList = document.querySelector("#file-list");
const fileError = document.querySelector("#file-error");
const filePreview = document.querySelector("#file-preview");
const threadId = new URLSearchParams(location.search).get("threadId");
const rendered = new Set();
const streaming = new Map();
const historyWindow = new HistoryWindow({ maxItems: HISTORY_BUFFER_SIZE, step: HISTORY_MARGIN_SIZE });
let historyCursor = null;
let historyLoading = false;
let historyObserver = null;
let localMessageId = 0;
let attachments = [];
let voiceActive = false;
let voicePrefix = "";
const savedSettings = readSettings();
const t = appTranslations[savedSettings.language] || appTranslations["zh-Hant"];
document.documentElement.lang = savedSettings.language;
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t[element.dataset.i18n];
model.options[0].textContent = t.default;
effort.options[0].textContent = t.default;
attach.title = t.addImage;
attach.ariaLabel = t.addImage;
voice.title = t.voiceInput;
voice.ariaLabel = t.voiceInput;
const savedCustomPrompt = savedSettings.customPrompt;
quickPrompt.dataset.prompt = savedCustomPrompt;
quickPrompt.textContent = savedCustomPrompt;
quickPrompt.title = savedCustomPrompt;

function nextLocalId() {
  localMessageId += 1;
  return `local-${Date.now()}-${localMessageId}`;
}

const workspaceImageObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const placeholder = entry.target;
    workspaceImageObserver.unobserve(placeholder);
    const link = placeholder.parentElement;
    const image = document.createElement("img");
    image.src = placeholder.dataset.src;
    image.alt = placeholder.dataset.alt;
    image.title = placeholder.dataset.title || "";
    image.addEventListener("error", () => {
      link.replaceChildren();
      const error = document.createElement("span");
      error.className = "image-error";
      error.textContent = t.imageLoadFailed;
      link.append(error);
    }, { once: true });
    link.replaceChildren(image);
  }
}, { root: messages, rootMargin: "600px 0px" });

function createWorkspaceImage(path, label, title = "") {
  const link = document.createElement("a");
  link.className = "workspace-image";
  link.href = `/api/generated-image?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(path)}`;
  link.target = "_blank";
  link.rel = "noopener";
  const placeholder = document.createElement("span");
  placeholder.className = "workspace-image-placeholder";
  placeholder.dataset.src = link.href;
  placeholder.dataset.alt = label || t.generatedImage;
  placeholder.dataset.title = title;
  placeholder.textContent = t.image;
  link.append(placeholder);
  workspaceImageObserver.observe(placeholder);
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

function createMessageElement(kind, text, id, title) {
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
  return element;
}

function createGeneratedImageElement(item) {
  if (!item.savedPath) {
    return item.failure ? createMessageElement("tool", item.failure.message || item.result || "Image generation failed", item.id, "IMAGE") : null;
  }
  const element = document.createElement("article");
  element.className = "message assistant generated-image";
  element.dataset.id = item.id;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = "CODEX · IMAGE";
  const promptText = item.revisedPrompt || (item.result?.length < 20_000 ? item.result : "") || "";
  const link = createWorkspaceImage(item.savedPath, t.generatedImage, promptText);
  element.append(label, link);
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
  return element;
}

function createItemElement(item) {
  if (item.type === "userMessage") {
    return createMessageElement("user", (item.content || []).map((part) => part.text || (part.type === "image" || part.type === "localImage" ? t.image : "")).join("\n"), item.clientId || item.id);
  } else if (item.type === "agentMessage") {
    return createMessageElement("assistant", item.text, item.id);
  } else if (item.type === "commandExecution") {
    return createMessageElement("tool", `$ ${item.command}\n${item.aggregatedOutput || ""}`, item.id, "COMMAND");
  } else if (item.type === "fileChange") {
    return createMessageElement("tool", `File changes: ${item.status}`, item.id, "FILES");
  } else if (item.type === "imageGeneration") {
    return createGeneratedImageElement(item);
  } else if (item.type === "imageView") {
    return createGeneratedImageElement({ ...item, savedPath: item.path });
  }
  return null;
}

function nearBottom() {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function renderItem(item) {
  const id = item.clientId || item.id;
  if (rendered.has(id)) return;
  const element = createItemElement(item);
  if (!element) return;
  const pinned = nearBottom();
  rendered.add(id);
  empty?.remove();
  liveMessages.append(element);
  if (pinned) requestAnimationFrame(scrollToBottom);
}

function addMessage(kind, text, id = nextLocalId(), title) {
  if (rendered.has(id)) return;
  const pinned = nearBottom();
  rendered.add(id);
  empty?.remove();
  liveMessages.append(createMessageElement(kind, text, id, title));
  if (pinned) requestAnimationFrame(scrollToBottom);
}

function pageItems(descendingTurns) {
  const supported = new Set(["userMessage", "agentMessage", "commandExecution", "fileChange", "imageGeneration", "imageView"]);
  return [...descendingTurns].reverse().flatMap((turn) => (turn.items || [])
    .map((item, index) => ({ key: `${turn.id}:${item.id || index}`, item }))
    .filter((entry) => supported.has(entry.item.type)));
}

function armHistoryMargins() {
  historyObserver?.disconnect();
  const entries = [...historyElement.children];
  if (!entries.length) return;
  const triggers = historyTriggerIndexes(entries.length);
  const upperTrigger = entries[triggers.upper];
  const lowerTrigger = entries[triggers.lower];
  historyObserver = new IntersectionObserver((observations) => {
    for (const observation of observations) {
      if (!observation.isIntersecting) continue;
      if (observation.target === upperTrigger) showOlderHistory().catch((error) => addMessage("tool", error.message));
      if (observation.target === lowerTrigger) showNewerHistory();
    }
  }, { root: messages });
  historyObserver.observe(upperTrigger);
  if (lowerTrigger !== upperTrigger) historyObserver.observe(lowerTrigger);
}

function renderHistory(anchorKey = null) {
  const oldAnchor = anchorKey
    ? [...historyElement.children].find((element) => element.dataset.historyKey === anchorKey)
    : null;
  const oldTop = oldAnchor?.offsetTop;
  const fragment = document.createDocumentFragment();
  for (const entry of historyWindow.visibleItems()) {
    const element = createItemElement(entry.item);
    if (!element) continue;
    element.dataset.historyKey = entry.key;
    fragment.append(element);
  }
  for (const placeholder of historyElement.querySelectorAll(".workspace-image-placeholder")) {
    workspaceImageObserver.unobserve(placeholder);
  }
  historyElement.replaceChildren(fragment);
  if (historyElement.childElementCount) empty?.remove();
  if (anchorKey && oldTop !== undefined) {
    const newAnchor = [...historyElement.children].find((element) => element.dataset.historyKey === anchorKey);
    if (newAnchor) messages.scrollTop += newAnchor.offsetTop - oldTop;
  }
  armHistoryMargins();
}

function setState(state) {
  const running = Boolean(state.active);
  status.innerHTML = `<i></i> ${running ? t.working : t.ready}`;
  status.classList.toggle("active", running);
  stop.disabled = !running;
  send.disabled = running;
  quickPrompt.disabled = running;
  voice.disabled = running;
}

function handleCodex(message) {
  const { method, params = {} } = message;
  if (method === "item/agentMessage/delta") {
    let stream = streaming.get(params.itemId);
    if (!stream) {
      const element = document.createElement("article");
      element.className = "message assistant";
      element.dataset.id = params.itemId;
      const label = document.createElement("span");
      label.className = "message-label";
      label.textContent = "CODEX";
      const content = document.createElement("span");
      content.className = "stream-content";
      element.append(label, content);
      empty?.remove();
      liveMessages.append(element);
      stream = { element, content, text: "", frame: null };
      streaming.set(params.itemId, stream);
    }
    stream.text += params.delta;
    if (!stream.frame) {
      const pinned = nearBottom();
      stream.frame = requestAnimationFrame(() => {
        stream.content.textContent = stream.text;
        stream.frame = null;
        if (pinned) scrollToBottom();
      });
    }
  } else if (method === "item/completed") {
    const existing = streaming.get(params.item?.id);
    if (existing) {
      if (existing.frame) cancelAnimationFrame(existing.frame);
      existing.element.remove();
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

function childPath(parent, name) {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function browseFiles(path = "/") {
  fileError.classList.add("hidden");
  filePreview.classList.add("hidden");
  try {
    const result = await api(`/api/files?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(path)}`);
    filePath.textContent = result.path;
    fileUp.disabled = !result.parent;
    fileUp.dataset.path = result.parent || "/";
    const rows = result.entries.map((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `file-row ${entry.type}`;
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = entry.type === "directory" ? "▸" : entry.image ? "▧" : "·";
      const name = document.createElement("strong");
      name.textContent = entry.name;
      const detail = document.createElement("small");
      detail.textContent = entry.type === "directory" ? "" : formatBytes(entry.size);
      row.append(icon, name, detail);
      const entryPath = childPath(result.path, entry.name);
      if (entry.type === "directory") row.addEventListener("click", () => browseFiles(entryPath));
      else if (entry.image) row.addEventListener("click", () => {
        const image = filePreview.querySelector("img");
        image.src = `/api/generated-image?threadId=${encodeURIComponent(threadId)}&file=${encodeURIComponent(entryPath)}`;
        image.alt = entry.name;
        filePreview.querySelector("figcaption").textContent = entry.name;
        filePreview.classList.remove("hidden");
        filePreview.scrollIntoView({ block: "nearest" });
      });
      else row.disabled = true;
      return row;
    });
    if (!rows.length) {
      const emptyFolder = document.createElement("p");
      emptyFolder.className = "file-list-empty";
      emptyFolder.textContent = t.emptyFolder;
      rows.push(emptyFolder);
    }
    fileList.replaceChildren(...rows);
  } catch (error) {
    fileError.textContent = `${t.folderLoadFailed}: ${error.message}`;
    fileError.classList.remove("hidden");
  }
}

browseFilesButton.addEventListener("click", () => {
  fileBrowser.showModal();
  browseFiles();
});
closeFiles.addEventListener("click", () => fileBrowser.close());
fileUp.addEventListener("click", () => browseFiles(fileUp.dataset.path));
fileBrowser.addEventListener("click", (event) => {
  if (event.target === fileBrowser) fileBrowser.close();
});

async function loadInitialHistory() {
  let cursor = null;
  let items = [];
  do {
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page = await api(`/api/turns?threadId=${encodeURIComponent(threadId)}&limit=18${cursorQuery}`);
    items = [...pageItems(page.data || []), ...items];
    cursor = page.nextCursor || null;
  } while (items.length < HISTORY_BUFFER_SIZE && cursor);
  return { items, cursor };
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
  const [session, models, initialHistory] = await Promise.all([
    api(`/api/session?threadId=${encodeURIComponent(threadId)}`),
    api("/api/models"),
    loadInitialHistory(),
  ]);
  setState(session);
  historyWindow.reset(initialHistory.items);
  historyCursor = initialHistory.cursor;
  renderHistory();
  requestAnimationFrame(scrollToBottom);
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

async function showOlderHistory() {
  if (historyLoading) return;
  const anchor = historyWindow.visibleItems()[0]?.key;
  if (historyWindow.moveOlder()) {
    renderHistory(anchor);
    return;
  }
  if (!historyCursor) return;
  historyLoading = true;
  try {
    const page = await api(`/api/turns?threadId=${encodeURIComponent(threadId)}&cursor=${encodeURIComponent(historyCursor)}&limit=12`);
    historyCursor = page.nextCursor || null;
    historyWindow.prepend(pageItems(page.data || []));
    renderHistory(anchor);
  } finally {
    historyLoading = false;
  }
}

function showNewerHistory() {
  const visible = historyWindow.visibleItems();
  const anchor = visible[visible.length - 1]?.key;
  if (historyWindow.moveNewer()) renderHistory(anchor);
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
  const choices = [["1", t.yes, t.yesHint, "accept"]];
  if (request.allowPersistent) choices.push(["2", t.alwaysYes, t.alwaysYesHint, "acceptForSession"]);
  choices.push([request.allowPersistent ? "3" : "2", t.no, t.noHint, "decline"]);
  for (const [key, label, hint, decision] of choices) {
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

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = speechLocaleByLanguage[savedSettings.language] || navigator.language;
  recognition.interimResults = true;
  recognition.continuous = false;
  voice.classList.remove("hidden");
  voice.addEventListener("click", () => {
    if (voiceActive) {
      recognition.stop();
      return;
    }
    voicePrefix = prompt.value.trimEnd();
    recognition.start();
  });
  recognition.addEventListener("start", () => {
    voiceActive = true;
    voice.classList.add("recording");
    voice.title = t.stopListening;
    voice.ariaLabel = t.stopListening;
  });
  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results, (result) => result[0].transcript).join("");
    prompt.value = `${voicePrefix}${voicePrefix && transcript ? " " : ""}${transcript}`;
  });
  recognition.addEventListener("error", (event) => {
    if (event.error !== "aborted") addMessage("tool", `${t.voiceError}: ${event.error}`);
  });
  recognition.addEventListener("end", () => {
    voiceActive = false;
    voice.classList.remove("recording");
    voice.title = t.voiceInput;
    voice.ariaLabel = t.voiceInput;
    prompt.focus();
  });
}

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

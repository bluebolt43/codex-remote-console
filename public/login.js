import { getPasskey } from "./passkey-client.js";

const button = document.querySelector("#login-button");
const instruction = document.querySelector("#login-instruction");
const pairLink = document.querySelector("#pair-link");
const error = document.querySelector("#login-error");
const savedLanguage = (() => {
  try {
    return JSON.parse(localStorage.getItem("codex-remote-console-settings"))?.language;
  } catch {
    return null;
  }
})();
const language = savedLanguage || (navigator.language.toLowerCase().startsWith("zh") ? "zh-Hant" : "en");
const translations = {
  en: { title: "Sign in", instruction: "Sign in with a paired Passkey.", login: "Sign in with Passkey", pair: "Create a new Passkey" },
  "zh-Hant": { title: "登入", instruction: "使用已配對的 Passkey 登入。", login: "使用 Passkey 登入", pair: "建立新的 Passkey" },
};
const text = translations[language] || translations.en;
document.documentElement.lang = language;
document.title = `${text.title} · Codex Remote Console`;
instruction.textContent = text.instruction;
button.textContent = text.login;
pairLink.textContent = text.pair;

button.addEventListener("click", async () => {
  button.disabled = true;
  error.classList.add("hidden");
  try {
    const optionsResponse = await fetch("/api/auth/login/options", { method: "POST" });
    const optionsData = await optionsResponse.json();
    if (!optionsResponse.ok) throw new Error(optionsData.error || `HTTP ${optionsResponse.status}`);
    const assertion = await getPasskey(optionsData.options);
    const response = await fetch("/api/auth/login/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authenticationId: optionsData.authenticationId, response: assertion }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const next = new URLSearchParams(location.search).get("next");
    location.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
    button.disabled = false;
  }
});

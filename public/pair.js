import { createPasskey } from "./passkey-client.js";
import { authPageLanguage, pairTranslations } from "./i18n.js";

const form = document.querySelector("#pair-form");
const code = document.querySelector("#pair-code");
const codeLabel = document.querySelector("#pair-code-label");
const button = document.querySelector("#pair-button");
const error = document.querySelector("#pair-error");
const language = authPageLanguage();
const text = pairTranslations[language] || pairTranslations.en;
document.documentElement.lang = language;
document.title = `${text.title} · Codex Remote Console`;
codeLabel.textContent = text.code;
button.textContent = text.create;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.classList.add("hidden");
  try {
    const optionsResponse = await fetch("/api/auth/register/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.value }),
    });
    const optionsData = await optionsResponse.json();
    if (!optionsResponse.ok) throw new Error(optionsData.error || `HTTP ${optionsResponse.status}`);
    const credential = await createPasskey(optionsData.options);
    const verifyResponse = await fetch("/api/auth/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ registrationId: optionsData.registrationId, response: credential }),
    });
    const verifyData = await verifyResponse.json();
    if (!verifyResponse.ok) throw new Error(verifyData.error || `HTTP ${verifyResponse.status}`);
    location.replace("/");
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
    button.disabled = false;
  }
});

import { getPasskey } from "./passkey-client.js";
import { authPageLanguage, loginTranslations } from "./i18n.js";

const button = document.querySelector("#login-button");
const instruction = document.querySelector("#login-instruction");
const pairLink = document.querySelector("#pair-link");
const error = document.querySelector("#login-error");
const language = authPageLanguage();
const text = loginTranslations[language] || loginTranslations.en;
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

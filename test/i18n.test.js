import test from "node:test";
import assert from "node:assert/strict";

import {
  appTranslations,
  localeByLanguage,
  loginTranslations,
  pairTranslations,
  sessionTranslations,
  speechLocaleByLanguage,
} from "../public/i18n.js";

const languages = ["en", "zh-Hant", "ja", "ko"];

function assertMatchingKeys(translations, name) {
  const expected = Object.keys(translations.en).sort();
  for (const language of languages) {
    assert.deepEqual(Object.keys(translations[language]).sort(), expected, `${name}.${language} keys`);
  }
}

test("every supported language has complete translations", () => {
  assertMatchingKeys(appTranslations, "appTranslations");
  assertMatchingKeys(sessionTranslations, "sessionTranslations");
  assertMatchingKeys(loginTranslations, "loginTranslations");
  assertMatchingKeys(pairTranslations, "pairTranslations");

  const expectedEventLabels = Object.keys(sessionTranslations.en.eventLabels).sort();
  for (const language of languages) {
    assert.deepEqual(
      Object.keys(sessionTranslations[language].eventLabels).sort(),
      expectedEventLabels,
      `sessionTranslations.${language}.eventLabels keys`,
    );
  }
});

test("every supported language has display and speech locales", () => {
  assert.deepEqual(Object.keys(localeByLanguage).sort(), [...languages].sort());
  assert.deepEqual(Object.keys(speechLocaleByLanguage).sort(), [...languages].sort());
});

/** Career-Ops produces English prose. Legacy profile language settings are ignored. */
export function describeOutputLanguage(_profileYaml) {
  return { language: 'en', source: 'default' };
}

export function parseOutputLanguage(_profileYaml) {
  return 'en';
}

export function outputLanguageInstruction() {
  return "Write all human-facing output in English, including the full A–G evaluation and the machine-readable summary's free-text fields, regardless of the language of these instructions or the job description. Preserve proper names and quoted source material; explain market-specific terms in English when needed. Legacy language.output, language.primary and language.modes_dir settings are unsupported and have no effect.";
}

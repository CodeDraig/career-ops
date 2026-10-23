// The web owns the shared CLI launch boundary; expose it to the core worker too.
export {
  automationEnvironment,
  checkCodexLogin,
  mailSecretNames,
  runAutomationCodex,
  spawnAutomationCli,
} from "../../web/src/lib/automation/execution.mjs";

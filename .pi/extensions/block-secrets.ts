import {
  type ExtensionAPI,
  isToolCallEventType,
} from "@earendil-works/pi-coding-agent";

// Paths that must never be read: SOPS-encrypted files and age key material.
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)age\.agekey$/,
  /\.agekey$/,
  /(^|\/)clusterenv\.ya?ml$/,
  /\.secret\.ya?ml$/,
  /(^|\/)talsecret\.ya?ml$/,
];

// Commands that decrypt secrets or dump key/secret material.
const SENSITIVE_COMMAND_PATTERNS: RegExp[] = [
  // sops / clustertool decryption (also `sops --set` rewrites ciphertext)
  /sops\s+(-d|--decrypt|decrypt|--set)/,
  /clustertool\s+decrypt/,
  // touching age key material
  /\.agekey\b/,
  // kubectl secret dumps
  /kubectl\s+[^\n]*(get|describe)\s+secret[^\n]*(yaml|json|jsonpath)/i,
  // resolved HelmRelease values (contain Flux-substituted secrets)
  /kubectl\s+[^\n]*helmrelease[^\n]*\.spec\.values/,
  // reading secret files inside pods
  /kubectl\s+[^\n]*exec[^\n]*(cat|grep|head|tail|xxd|base64)[^\n]*secret/i,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("read", event)) {
      const path = event.input.path ?? "";
      if (SENSITIVE_PATH_PATTERNS.some((re) => re.test(path))) {
        return {
          block: true,
          reason: `Reading ${path} is blocked: it is SOPS-encrypted or contains age key material. Ask the operator to handle it.`,
        };
      }
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command ?? "";
      if (SENSITIVE_COMMAND_PATTERNS.some((re) => re.test(command))) {
        return {
          block: true,
          reason:
            "Blocked a command that decrypts or dumps secrets. Never run sops/clustertool decrypt, read age keys, or dump Kubernetes secrets or resolved HelmRelease values.",
        };
      }
    }

    return undefined;
  });
}

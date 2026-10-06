import { describe, expect, it } from "vitest"
import { parseConfig } from "./config"

describe("parseConfig", () => {
  const base = { playerApiUrl: "https://v2.api.wingobingo.tv" }

  it("needs an https Player API URL", () => {
    expect(parseConfig(undefined)).toBeNull()
    expect(parseConfig({})).toBeNull()
    expect(parseConfig({ playerApiUrl: "http://v2.api.wingobingo.tv" })).toBeNull()
    expect(parseConfig({ playerApiUrl: "javascript:alert(1)" })).toBeNull()
    expect(parseConfig({ playerApiUrl: "https://evil.example/\"><script>" })).toBeNull()
  })

  it("applies safe defaults", () => {
    expect(parseConfig(base)).toEqual({
      playerApiUrl: "https://v2.api.wingobingo.tv",
      siteUrl: "https://wingobingo.tv",
      botUsername: "",
      miniAppShortName: "",
      defaultLang: "en",
      debugTelemetryUrl: "",
      debugTelemetryKey: "",
      recaptchaSiteKey: "",
      livekitUrl: "",
    })
  })

  it("reads the keys written by deploy/nginx/05-runtime-config.envsh", () => {
    const c = parseConfig({
      playerApiUrl: "https://v2.api.wingobingo.tv/",
      siteUrl: "https://wingobingo.tv/",
      botUsername: "WingoBingoBot",
      miniAppShortName: "play",
      defaultLang: "fa",
      debugTelemetryUrl: "https://api.wingobingo.tv/debug-telemetry/ingest",
      debugTelemetryKey: "abcdef123456",
      recaptchaSiteKey: "6LcTestSiteKeyForUnitTests_0123456789ab",
      livekitUrl: "wss://quiz4win-918o76rk.livekit.cloud/",
    })
    expect(c).toEqual({
      playerApiUrl: "https://v2.api.wingobingo.tv",
      siteUrl: "https://wingobingo.tv",
      botUsername: "WingoBingoBot",
      miniAppShortName: "play",
      defaultLang: "fa",
      debugTelemetryUrl: "https://api.wingobingo.tv/debug-telemetry/ingest",
      debugTelemetryKey: "abcdef123456",
      recaptchaSiteKey: "6LcTestSiteKeyForUnitTests_0123456789ab",
      livekitUrl: "wss://quiz4win-918o76rk.livekit.cloud",
    })
  })

  it("rejects bad optional values instead of using them", () => {
    const c = parseConfig({
      ...base,
      botUsername: "@bad name",
      miniAppShortName: "x",
      defaultLang: "de",
      recaptchaSiteKey: "short\"><script>",
      livekitUrl: "ws://insecure.example",
    })
    expect(c?.livekitUrl).toBe("")
    expect(parseConfig({ ...base, livekitUrl: "wss://x.example/path" })?.livekitUrl).toBe("")
    expect(c?.recaptchaSiteKey).toBe("")
    expect(c?.botUsername).toBe("")
    expect(c?.miniAppShortName).toBe("")
    expect(c?.defaultLang).toBe("en")
  })

  it("turns telemetry off unless both URL and key are set", () => {
    expect(parseConfig({ ...base, debugTelemetryUrl: "https://x.example/ingest" })?.debugTelemetryUrl).toBe("")
    expect(parseConfig({ ...base, debugTelemetryKey: "k" })?.debugTelemetryKey).toBe("")
  })
})

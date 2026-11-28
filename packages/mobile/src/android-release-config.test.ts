import { describe, expect, it } from "vitest";

const { applyReleaseSigning } = require("../plugins/with-android-release-signing");
const { applyAndroidShareIntent } = require("../plugins/with-android-share-intent");
const {
  parseMobileReleaseTag,
  validateMobileManifestConsistency,
} = require("../scripts/mobile-release-metadata");

const generatedBuildGradle = `
android {
    defaultConfig {
        applicationId 'com.aichat.mobile'
        versionCode 2
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

describe("双端构建与发布配置", () => {
  it("Android release 支持外部 keystore 且在无秘密时平滑回退免密签名", () => {
    const result = applyReleaseSigning(generatedBuildGradle);

    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PATH")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PASSWORD")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_ALIAS")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_PASSWORD")');
    expect(result).toContain("initWith debug");
    expect(result).toMatch(/release\s*\{\s*signingConfig signingConfigs\.release\s*minifyEnabled false/);
  });

  it("Android Share Intent 插件幂等注入 ACTION_SEND text/plain", () => {
    const baseManifest = {
      manifest: {
        application: [
          {
            activity: [
              {
                "intent-filter": [
                  {
                    action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const once = applyAndroidShareIntent(baseManifest);
    const twice = applyAndroidShareIntent(once);
    const filters = twice.manifest.application[0].activity[0]["intent-filter"];
    expect(filters).toHaveLength(2);
    expect(filters[1].action[0].$["android:name"]).toBe("android.intent.action.SEND");
    expect(filters[1].data[0].$["android:mimeType"]).toBe("text/plain");
  });

  it("校验 mobile-vX.Y.Z Tag 与 app.json / package.json 版本一致", () => {
    expect(parseMobileReleaseTag("refs/tags/mobile-v1.0.0", "1.0.0")).toEqual({
      tag: "mobile-v1.0.0",
      versionName: "1.0.0",
    });
    expect(() => parseMobileReleaseTag("refs/tags/mobile-v1.0.1", "1.0.0")).toThrow(
      "Tag 版本 1.0.1 与移动端版本 1.0.0 不一致",
    );
    expect(() => parseMobileReleaseTag("refs/tags/v1.0.0", "1.0.0")).toThrow(
      "Tag 必须使用 mobile-v<major.minor.patch> 格式",
    );

    const meta = validateMobileManifestConsistency(
      {
        expo: {
          version: "1.0.0",
          android: { package: "com.aichat.mobile", versionCode: 2 },
          ios: { bundleIdentifier: "com.aichat.mobile", buildNumber: "2" },
        },
      },
      { version: "1.0.0" },
    );
    expect(meta).toEqual({
      version: "1.0.0",
      androidPackage: "com.aichat.mobile",
      androidVersionCode: 2,
      iosBundleIdentifier: "com.aichat.mobile",
      iosBuildNumber: "2",
    });
  });
});

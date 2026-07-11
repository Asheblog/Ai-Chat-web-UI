import { describe, expect, it } from "vitest";

const { applyReleaseSigning } = require("../plugins/with-android-release-signing");
const { parseMobileReleaseTag } = require("../scripts/mobile-release-metadata");

const generatedBuildGradle = `
android {
    defaultConfig {
        applicationId 'com.aichat.mobile'
        versionCode 1
        versionName "0.1.0"
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

describe("Android 正式发布配置", () => {
  it("release 构建只从外部环境读取独立签名，不回退 debug keystore", () => {
    const result = applyReleaseSigning(generatedBuildGradle);

    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PATH")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEYSTORE_PASSWORD")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_ALIAS")');
    expect(result).toContain('System.getenv("AICHAT_ANDROID_KEY_PASSWORD")');
    expect(result).toContain("gradle.startParameter.taskNames");
    expect(result).toContain("releaseSigningRequested");
    expect(result).toContain("throw new GradleException");
    expect(result).toMatch(/buildTypes\s*\{\s*debug\s*\{\s*signingConfig signingConfigs\.debug/);
    expect(result).toMatch(/release\s*\{\s*signingConfig signingConfigs\.release\s*minifyEnabled false/);
  });

  it("移动端 Tag 必须与 app.json 的正式版本一致", () => {
    expect(parseMobileReleaseTag("refs/tags/mobile-v0.1.0", "0.1.0")).toEqual({
      tag: "mobile-v0.1.0",
      versionName: "0.1.0",
    });
    expect(() => parseMobileReleaseTag("refs/tags/mobile-v0.2.0", "0.1.0")).toThrow(
      "Tag 版本 0.2.0 与移动端版本 0.1.0 不一致",
    );
    expect(() => parseMobileReleaseTag("refs/tags/v0.1.0", "0.1.0")).toThrow(
      "Tag 必须使用 mobile-v<versionName> 格式",
    );
  });
});

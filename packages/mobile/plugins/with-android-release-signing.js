const { withAppBuildGradle } = require("@expo/config-plugins");

const SIGNING_ENV = [
  "AICHAT_ANDROID_KEYSTORE_PATH",
  "AICHAT_ANDROID_KEYSTORE_PASSWORD",
  "AICHAT_ANDROID_KEY_ALIAS",
  "AICHAT_ANDROID_KEY_PASSWORD",
];

function applyReleaseSigning(contents) {
  const signingStart = contents.indexOf("    signingConfigs {");
  const buildTypesStart = contents.indexOf("    buildTypes {", signingStart);
  if (signingStart === -1 || buildTypesStart === -1) {
    throw new Error("无法定位 Expo 生成的 Android signingConfigs/buildTypes 配置");
  }

  const signingBlock = contents.slice(signingStart, buildTypesStart);
  const signingClose = signingBlock.lastIndexOf("    }");
  if (signingClose === -1) {
    throw new Error("无法定位 Expo 生成的 Android signingConfigs 结束位置");
  }
  const existingReleaseStart = signingBlock.indexOf("        release {");
  const signingPrefix =
    existingReleaseStart === -1 ? signingBlock.slice(0, signingClose) : signingBlock.slice(0, existingReleaseStart);
  const releaseSigning = `        release {
            def requiredSigningEnvironment = ${JSON.stringify(SIGNING_ENV)}
            def missingSigningEnvironment = requiredSigningEnvironment.findAll { !System.getenv(it) }
            def releaseSigningRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains("release") }
            if (releaseSigningRequested && !missingSigningEnvironment.isEmpty()) {
                throw new GradleException("正式 APK 缺少签名环境变量: " + missingSigningEnvironment.join(", "))
            }
            if (missingSigningEnvironment.isEmpty()) {
                storeFile file(System.getenv("AICHAT_ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("AICHAT_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("AICHAT_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("AICHAT_ANDROID_KEY_PASSWORD")
            }
        }
`;
  const nextSigningBlock = signingPrefix + releaseSigning + signingBlock.slice(signingClose);
  const withSigningConfig =
    contents.slice(0, signingStart) + nextSigningBlock + contents.slice(buildTypesStart);

  const nextBuildTypesStart = withSigningConfig.indexOf("    buildTypes {", signingStart);
  const packagingStart = withSigningConfig.indexOf("    packagingOptions {", nextBuildTypesStart);
  const buildTypesEnd = packagingStart === -1 ? withSigningConfig.lastIndexOf("\n}") : packagingStart;
  if (buildTypesEnd === -1) {
    throw new Error("无法定位 Expo 生成的 Android buildTypes 结束位置");
  }
  const buildTypes = withSigningConfig
    .slice(nextBuildTypesStart, buildTypesEnd)
    .replace(
      /(debug\s*\{[\s\S]*?signingConfig signingConfigs\.)\w+/,
      "$1debug",
    )
    .replace(
      /(release\s*\{[\s\S]*?signingConfig signingConfigs\.)\w+/,
      "$1release",
    );

  return (
    withSigningConfig.slice(0, nextBuildTypesStart) +
    buildTypes +
    withSigningConfig.slice(buildTypesEnd)
  );
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Android release signing plugin 仅支持 Groovy build.gradle");
    }
    gradleConfig.modResults.contents = applyReleaseSigning(gradleConfig.modResults.contents);
    return gradleConfig;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.SIGNING_ENV = SIGNING_ENV;

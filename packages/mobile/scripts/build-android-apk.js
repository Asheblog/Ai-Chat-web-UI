const fs = require("node:fs");
const path = require("node:path");
const {
  androidDir,
  findAndroidSdk,
  findJavaHome,
  mobileDir,
  run,
  writeLocalProperties,
} = require("./android-build-tools");

const mode = process.argv[2] ?? "release";
if (!new Set(["release", "debug"]).has(mode)) {
  throw new Error("构建模式只能是 release 或 debug");
}

const signingEnvironment = [
  "AICHAT_ANDROID_KEYSTORE_PATH",
  "AICHAT_ANDROID_KEYSTORE_PASSWORD",
  "AICHAT_ANDROID_KEY_ALIAS",
  "AICHAT_ANDROID_KEY_PASSWORD",
];
const buildEnvironment = {
  ...process.env,
  NODE_ENV: mode === "release" ? "production" : process.env.NODE_ENV ?? "development",
};
if (mode === "release") {
  const missing = signingEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`正式 APK 缺少签名环境变量: ${missing.join(", ")}`);
  }
  if (!fs.existsSync(path.resolve(process.env.AICHAT_ANDROID_KEYSTORE_PATH))) {
    throw new Error("AICHAT_ANDROID_KEYSTORE_PATH 指向的 keystore 不存在");
  }
}

run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "expo", "prebuild", "--platform", "android"], {
  env: buildEnvironment,
});

const wrapperProperties = path.join(androidDir, "gradle", "wrapper", "gradle-wrapper.properties");
const wrapperContents = fs.readFileSync(wrapperProperties, "utf8");
fs.writeFileSync(
  wrapperProperties,
  wrapperContents.replace(
    /^distributionUrl=.*$/m,
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip",
  ),
  "utf8",
);

const androidSdk = findAndroidSdk();
const javaHome = findJavaHome();
writeLocalProperties(androidSdk);

const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const task = mode === "release" ? ":app:assembleRelease" : ":app:assembleDebug";
run(gradle, ["--no-daemon", "--no-watch-fs", task], {
  cwd: androidDir,
  env: {
    ...buildEnvironment,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  },
});

const apk = path.join(
  androidDir,
  "app",
  "build",
  "outputs",
  "apk",
  mode,
  `app-${mode}.apk`,
);
if (mode === "release") {
  run(process.execPath, [path.join(mobileDir, "scripts", "verify-android-apk.js"), apk]);
}
console.log(`\nInstallable APK:\n${apk}`);

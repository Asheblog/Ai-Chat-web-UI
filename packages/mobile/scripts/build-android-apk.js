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

const SIGNING_ENV = [
  "AICHAT_ANDROID_KEYSTORE_PATH",
  "AICHAT_ANDROID_KEYSTORE_PASSWORD",
  "AICHAT_ANDROID_KEY_ALIAS",
  "AICHAT_ANDROID_KEY_PASSWORD",
];

function ensureFreeReleaseKeystore(env, javaHome) {
  const hasAllExternal = SIGNING_ENV.every((name) => Boolean(env[name]));
  if (hasAllExternal) {
    const resolved = path.resolve(env.AICHAT_ANDROID_KEYSTORE_PATH);
    if (!fs.existsSync(resolved)) {
      throw new Error("AICHAT_ANDROID_KEYSTORE_PATH 指向的 keystore 不存在");
    }
    return { ...env, AICHAT_ANDROID_KEYSTORE_PATH: resolved };
  }

  // 无付费证书 / 无 Secrets 时，使用 keytool 自动生成本地自签名 keystore，产出可直接安装的 Release APK。
  const cacheDir = path.join(mobileDir, ".build-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const freeKeystore = path.join(cacheDir, "free-release.keystore");
  if (!fs.existsSync(freeKeystore)) {
    const keytoolBin = javaHome
      ? path.join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
      : "keytool";
    run(
      keytoolBin,
      [
        "-genkeypair",
        "-v",
        "-keystore",
        freeKeystore,
        "-alias",
        "aichat-free",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
        "-storepass",
        "aichatfree",
        "-keypass",
        "aichatfree",
        "-dname",
        "CN=AIChat Mobile, OU=Community, O=AIChat, L=Local, ST=Local, C=CN",
      ],
      { cwd: cacheDir },
    );
  }

  return {
    ...env,
    AICHAT_ANDROID_KEYSTORE_PATH: freeKeystore,
    AICHAT_ANDROID_KEYSTORE_PASSWORD: "aichatfree",
    AICHAT_ANDROID_KEY_ALIAS: "aichat-free",
    AICHAT_ANDROID_KEY_PASSWORD: "aichatfree",
  };
}

const javaHome = findJavaHome();
let buildEnvironment = {
  ...process.env,
  NODE_ENV: mode === "release" ? "production" : (process.env.NODE_ENV ?? "development"),
};

if (mode === "release") {
  buildEnvironment = ensureFreeReleaseKeystore(buildEnvironment, javaHome);
}

run(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "expo", "prebuild", "--platform", "android", "--clean"],
  { env: buildEnvironment },
);

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
  run(process.execPath, [path.join(mobileDir, "scripts", "verify-android-apk.js"), apk], {
    env: buildEnvironment,
  });
}
console.log(`\nInstallable APK:\n${apk}`);

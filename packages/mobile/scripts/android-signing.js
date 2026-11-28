const fs = require("node:fs");
const path = require("node:path");
const { mobileDir, run } = require("./android-build-tools");

const SIGNING_ENV = [
  "AICHAT_ANDROID_KEYSTORE_PATH",
  "AICHAT_ANDROID_KEYSTORE_PASSWORD",
  "AICHAT_ANDROID_KEY_ALIAS",
  "AICHAT_ANDROID_KEY_PASSWORD",
];

const FREE_KEYSTORE_ALIAS = "aichat-free";
const FREE_KEYSTORE_PASSWORD = "aichatfree";

/**
 * 判定 release APK 的签名来源：
 * - 四个变量齐全：使用外部 keystore（正式签名身份，需与 app.json 指纹一致）。
 * - 四个变量全空：使用本地生成的免密自签名 keystore。
 * - 只配置一部分：直接失败，避免静默产出签名身份错误的 release 包。
 */
function resolveReleaseSigningMode(env) {
  const missing = SIGNING_ENV.filter((name) => !env[name]);
  if (missing.length === 0) {
    return "external";
  }
  if (missing.length === SIGNING_ENV.length) {
    return "free";
  }
  throw new Error(
    `Android 签名环境变量不完整，缺少: ${missing.join(", ")}；请补齐全部四个 AICHAT_ANDROID_* 变量，或全部留空以构建免密自签名 APK`,
  );
}

function ensureReleaseSigningEnvironment(env, javaHome, options = {}) {
  const runCommand = options.runCommand ?? run;
  if (resolveReleaseSigningMode(env) === "external") {
    const resolved = path.resolve(env.AICHAT_ANDROID_KEYSTORE_PATH);
    if (!fs.existsSync(resolved)) {
      throw new Error("AICHAT_ANDROID_KEYSTORE_PATH 指向的 keystore 不存在");
    }
    return { ...env, AICHAT_ANDROID_KEYSTORE_PATH: resolved };
  }

  // 无付费证书 / 无 Secrets 时，使用 keytool 自动生成本地自签名 keystore，产出可直接安装的 Release APK。
  const cacheDir = options.cacheDir ?? path.join(mobileDir, ".build-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const freeKeystore = path.join(cacheDir, "free-release.keystore");
  if (!fs.existsSync(freeKeystore)) {
    const keytoolBin = javaHome
      ? path.join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
      : "keytool";
    runCommand(
      keytoolBin,
      [
        "-genkeypair",
        "-v",
        "-keystore",
        freeKeystore,
        "-alias",
        FREE_KEYSTORE_ALIAS,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
        "-storepass",
        FREE_KEYSTORE_PASSWORD,
        "-keypass",
        FREE_KEYSTORE_PASSWORD,
        "-dname",
        "CN=AIChat Mobile, OU=Community, O=AIChat, L=Local, ST=Local, C=CN",
      ],
      { cwd: cacheDir },
    );
  }

  return {
    ...env,
    AICHAT_ANDROID_KEYSTORE_PATH: freeKeystore,
    AICHAT_ANDROID_KEYSTORE_PASSWORD: FREE_KEYSTORE_PASSWORD,
    AICHAT_ANDROID_KEY_ALIAS: FREE_KEYSTORE_ALIAS,
    AICHAT_ANDROID_KEY_PASSWORD: FREE_KEYSTORE_PASSWORD,
  };
}

module.exports = {
  FREE_KEYSTORE_ALIAS,
  FREE_KEYSTORE_PASSWORD,
  SIGNING_ENV,
  ensureReleaseSigningEnvironment,
  resolveReleaseSigningMode,
};

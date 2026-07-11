const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("./android-build-tools");

const outputDir = path.resolve(
  process.argv[2] ?? path.join(os.homedir(), ".config", "aichat-mobile", "signing"),
);
const keystorePath = path.join(outputDir, "release.keystore");
const shellEnvPath = path.join(outputDir, "signing.env");
const cmdEnvPath = path.join(outputDir, "signing.cmd");
if ([keystorePath, shellEnvPath, cmdEnvPath].some((file) => fs.existsSync(file))) {
  throw new Error(`签名目录已有文件，拒绝覆盖: ${outputDir}`);
}

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const storePassword = crypto.randomBytes(32).toString("base64url");
const keyPassword = crypto.randomBytes(32).toString("base64url");
const keyAlias = "aichat-release";
run("keytool", [
  "-genkeypair",
  "-v",
  "-storetype", "JKS",
  "-keystore", keystorePath,
  "-storepass", storePassword,
  "-keypass", keyPassword,
  "-alias", keyAlias,
  "-keyalg", "RSA",
  "-keysize", "4096",
  "-validity", "10000",
  "-dname", "CN=AIChat Mobile Release, OU=Mobile, O=AIChat, L=Unknown, ST=Unknown, C=CN",
]);

const shellEnv = [
  `export AICHAT_ANDROID_KEYSTORE_PATH='${keystorePath.replace(/'/g, "'\\''")}'`,
  `export AICHAT_ANDROID_KEYSTORE_PASSWORD='${storePassword}'`,
  `export AICHAT_ANDROID_KEY_ALIAS='${keyAlias}'`,
  `export AICHAT_ANDROID_KEY_PASSWORD='${keyPassword}'`,
  "",
].join("\n");
const cmdEnv = [
  `@set "AICHAT_ANDROID_KEYSTORE_PATH=${keystorePath}"`,
  `@set "AICHAT_ANDROID_KEYSTORE_PASSWORD=${storePassword}"`,
  `@set "AICHAT_ANDROID_KEY_ALIAS=${keyAlias}"`,
  `@set "AICHAT_ANDROID_KEY_PASSWORD=${keyPassword}"`,
  "",
].join("\r\n");
fs.writeFileSync(shellEnvPath, shellEnv, { encoding: "utf8", mode: 0o600 });
fs.writeFileSync(cmdEnvPath, cmdEnv, { encoding: "utf8", mode: 0o600 });
if (process.platform !== "win32") {
  fs.chmodSync(outputDir, 0o700);
  fs.chmodSync(keystorePath, 0o600);
  fs.chmodSync(shellEnvPath, 0o600);
  fs.chmodSync(cmdEnvPath, 0o600);
}

console.log(`已生成 Android release signing material: ${outputDir}`);
console.log("密码未输出；请离线备份整个目录，且不得提交到仓库。");

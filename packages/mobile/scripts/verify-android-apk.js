const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const appConfig = require("../app.json");
const { findAndroidSdk, findBuildTool, run } = require("./android-build-tools");

const apk = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"));
if (!fs.existsSync(apk)) throw new Error(`APK 不存在: ${apk}`);

const sdk = findAndroidSdk();
const apksigner = findBuildTool(sdk, "apksigner");
const aapt = findBuildTool(sdk, "aapt");
const signature = run(apksigner, ["verify", "--verbose", "--print-certs", apk], { capture: true });
if (/Android Debug/i.test(signature)) {
  throw new Error("release APK 仍使用 Android debug 证书签名");
}
const certificateMatch = signature.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i);
if (!certificateMatch) throw new Error("无法从 APK 读取签名证书 SHA-256");
const certificateSha256 = certificateMatch[1].replace(/:/g, "").toLowerCase();
const expectedCertificateSha256 = String(
  appConfig.expo.extra?.androidReleaseCertificateSha256 ?? "",
).replace(/:/g, "").toLowerCase();
if (!expectedCertificateSha256 || certificateSha256 !== expectedCertificateSha256) {
  throw new Error(
    `APK 签名证书不匹配：得到 ${certificateSha256 || "未知"}，预期 ${expectedCertificateSha256 || "未配置"}`,
  );
}

const badging = run(aapt, ["dump", "badging", apk], { capture: true });
const packageLine = badging.split(/\r?\n/).find((line) => line.startsWith("package: "));
const match = packageLine?.match(/name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
if (!match) throw new Error("无法从 APK 读取包名和版本");

const [, applicationId, versionCode, versionName] = match;
const expectedApplicationId = appConfig.expo.android.package;
const expectedVersionCode = String(appConfig.expo.android.versionCode);
const expectedVersionName = appConfig.expo.version;
if (applicationId !== expectedApplicationId || versionCode !== expectedVersionCode || versionName !== expectedVersionName) {
  throw new Error(
    `APK 元数据不匹配：得到 ${applicationId} ${versionName} (${versionCode})，预期 ${expectedApplicationId} ${expectedVersionName} (${expectedVersionCode})`,
  );
}

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
fs.writeFileSync(`${apk}.sha256`, `${sha256}  ${path.basename(apk)}\n`, "utf8");
const size = fs.statSync(apk).size;

console.log(signature.trim());
console.log(`Package: ${applicationId}`);
console.log(`Version: ${versionName} (${versionCode})`);
console.log(`Release certificate SHA-256: ${certificateSha256}`);
console.log(`Size: ${size} bytes`);
console.log(`SHA-256: ${sha256}`);

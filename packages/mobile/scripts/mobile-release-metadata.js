function parseMobileReleaseTag(ref, versionName) {
  const tag = ref.replace(/^refs\/tags\//, "");
  const match = /^mobile-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error("Tag 必须使用 mobile-v<major.minor.patch> 格式");
  }
  if (match[1] !== versionName) {
    throw new Error(`Tag 版本 ${match[1]} 与移动端版本 ${versionName} 不一致`);
  }
  return { tag, versionName };
}

function validateMobileManifestConsistency(appConfig, packageJson) {
  const appVersion = appConfig?.expo?.version;
  const pkgVersion = packageJson?.version;
  if (!appVersion || appVersion !== pkgVersion) {
    throw new Error(`app.json 版本 (${appVersion}) 与 package.json 版本 (${pkgVersion}) 不一致`);
  }

  const androidPkg = appConfig?.expo?.android?.package;
  const iosBundle = appConfig?.expo?.ios?.bundleIdentifier;
  if (!androidPkg || !iosBundle) {
    throw new Error("app.json 缺少 android.package 或 ios.bundleIdentifier");
  }

  return {
    version: appVersion,
    androidPackage: androidPkg,
    androidVersionCode: appConfig.expo.android.versionCode,
    iosBundleIdentifier: iosBundle,
    iosBuildNumber: appConfig.expo.ios.buildNumber,
  };
}

module.exports = {
  parseMobileReleaseTag,
  validateMobileManifestConsistency,
};

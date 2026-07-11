const appConfig = require("../app.json");
const { parseMobileReleaseTag } = require("./mobile-release-metadata");

const result = parseMobileReleaseTag(process.argv[2] ?? process.env.GITHUB_REF ?? "", appConfig.expo.version);
console.log(JSON.stringify({
  ...result,
  applicationId: appConfig.expo.android.package,
  versionCode: appConfig.expo.android.versionCode,
}));

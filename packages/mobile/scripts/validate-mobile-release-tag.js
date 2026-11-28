const appConfig = require("../app.json");
const packageJson = require("../package.json");
const {
  parseMobileReleaseTag,
  validateMobileManifestConsistency,
} = require("./mobile-release-metadata");

const metadata = validateMobileManifestConsistency(appConfig, packageJson);
const result = parseMobileReleaseTag(
  process.argv[2] ?? process.env.GITHUB_REF ?? "",
  metadata.version,
);

console.log(
  JSON.stringify({
    ...result,
    ...metadata,
  }),
);

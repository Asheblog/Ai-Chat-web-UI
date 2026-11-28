const { withInfoPlist } = require("@expo/config-plugins");

/**
 * 允许 iOS 客户端连接局域网自托管的 HTTP 服务端（如 http://192.168.x.x:3001）。
 */
function withIosAtsHttp(config) {
  return withInfoPlist(config, (plistConfig) => {
    const existingAts =
      plistConfig.modResults.NSAppTransportSecurity &&
      typeof plistConfig.modResults.NSAppTransportSecurity === "object"
        ? plistConfig.modResults.NSAppTransportSecurity
        : {};

    plistConfig.modResults.NSAppTransportSecurity = {
      ...existingAts,
      NSAllowsArbitraryLoads: true,
    };

    return plistConfig;
  });
}

module.exports = withIosAtsHttp;

(function setAppVersion(global) {
  const APP_VERSION = "1.00";
  global.APP_VERSION = APP_VERSION;
})(typeof self !== "undefined" ? self : globalThis);

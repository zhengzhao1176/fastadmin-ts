// Stub controller JS for /index/index — the home page has no controller-
// specific behaviour. Mirrors PHP behaviour where the file simply doesn't
// exist; we add the stub here to silence the 404 + MIME warnings in browsers
// that fire `script error` events for missing assets.
define([], function () {
  var Controller = {
    index: function () {}
  };
  return Controller;
});

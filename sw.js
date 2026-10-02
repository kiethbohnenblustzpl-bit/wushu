/* Service Worker：把整个网站（含骨架模型）缓存到手机本地。
 *
 * 目的：手机第一次通过网站在线打开并「添加到主屏幕」之后，
 * 以后点桌面图标就能直接用——电脑关机、隧道失效、甚至完全离线都没问题。
 *
 * 策略：
 *   - 安装时预缓存页面骨架（html/css/js/图标）；
 *   - 其余请求（尤其是 9 MB 的骨架模型和 11 MB 的 wasm）第一次用过后自动进缓存；
 *   - 统一「缓存优先，没有再走网络」，避免考核时因网络抖动失败。
 *
 * 改了网站内容记得把 VERSION 加一，否则手机会一直用旧缓存。
 */

var VERSION = "wushu-v2";

var SHELL = [
  "./",
  "./index.html",
  "./qr.html",
  "./manifest.webmanifest",
  "./assets/styles.css",
  "./assets/data.js",
  "./assets/app.js",
  "./assets/video.js",
  "./assets/video-run.js",
  "./assets/qrcode.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png"
];

// 视频考核要用的骨架模型和 WASM 运行时（约 20 MB）。
// 首次访问时在后台一起缓存好，之后手机断网、电脑关机也能做视频考核。
var HEAVY = [
  "./assets/pose/pose_landmarker_full.task",
  "./assets/pose/vision_bundle.mjs",
  "./assets/pose/vision_wasm_internal.js",
  "./assets/pose/vision_wasm_internal.wasm"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // 逐个添加：任何一个 404 都不该让整个安装失败
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

// 大文件（骨架模型 / WASM）不在 install 阶段下载：那会拖住 Service Worker 激活，
// 用户中途关掉页面就可能什么都没缓存上。改成激活后由页面发消息触发，
// 还没缓存过的才下载，已经有的直接跳过——所以每次打开都是幂等的。
function warmHeavy() {
  return caches.open(VERSION).then(function (cache) {
    return Promise.all(HEAVY.map(function (url) {
      return cache.match(url).then(function (hit) {
        if (hit) return null;
        return cache.add(new Request(url, { cache: "reload" })).catch(function () { });
      });
    }));
  });
}

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "warm") {
    e.waitUntil(warmHeavy());
  }
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && (res.type === "basic" || res.type === "default")) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () { });
        }
        return res;
      }).catch(function () {
        // 离线兜底：页面请求回首页
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "offline" });
      });
    })
  );
});

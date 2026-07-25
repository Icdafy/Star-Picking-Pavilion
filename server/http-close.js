'use strict';

// 退出时关 HTTP 服务，不把控制权交给客户端。
//
// server.close() 只做两件事：停止监听、等既有连接自己结束。渲染层与本地服务之间
// 全是 keep-alive 长连接（页面脚本、字体分片、实时轮询），退出那一瞬间只要还有
// 一条连接不空闲，关闭就会一直悬着；Electron 那侧 5 秒的强杀兜底最终会收场，
// 但用户看到的是「关了窗，进程赖着不走」。closeIdleConnections() 只能收掉调用
// 那一刻就空闲的连接，晚一步进来的请求照样能把关闭拖住。
//
// 所以：先收空闲连接，再给在途请求一个很短的宽限期，到点无条件断开。
// 退出的时候，没有哪个请求值得让用户多等——真正要落盘的东西在这之前就写完了。
const DEFAULT_GRACE_MS = 500;

function closeHttpServerGracefully(server, { graceMs = DEFAULT_GRACE_MS } = {}) {
  if (!server || !server.listening) return Promise.resolve({ forced: false });

  return new Promise((resolve, reject) => {
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      server.closeAllConnections?.();
    }, graceMs);
    forceTimer.unref?.();

    server.close(error => {
      clearTimeout(forceTimer);
      if (error) reject(error);
      else resolve({ forced });
    });
    server.closeIdleConnections?.();
  });
}

module.exports = { DEFAULT_GRACE_MS, closeHttpServerGracefully };

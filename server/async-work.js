'use strict';

// 一个分支失败后仍等待其余分支结束，避免任务锁已释放而网络请求仍在落库。
async function settleAll(operations) {
  const results = await Promise.allSettled(operations);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

module.exports = { settleAll };

'use strict';

const STOPPED_MESSAGE = Object.freeze({ type: 'server:stopped' });

function getControlMessage(messageOrEvent) {
  return messageOrEvent?.data ?? messageOrEvent;
}

function createServerShutdownLifecycle({
  stopScheduler,
  closeHttpServer,
  waitForSchedulerIdle,
  closeDatabase,
  notifyStoppedAndExit,
  onError
}) {
  let shutdownPromise = null;

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;

    const operation = (async () => {
      stopScheduler();
      await Promise.all([closeHttpServer(), waitForSchedulerIdle()]);
      closeDatabase();
      notifyStoppedAndExit(STOPPED_MESSAGE);
    })();
    shutdownPromise = typeof onError === 'function' ? operation.catch(onError) : operation;
    return shutdownPromise;
  }

  function handleControlMessage(messageOrEvent) {
    const message = getControlMessage(messageOrEvent);
    if (message?.type === 'server:shutdown') return shutdown();
  }

  return Object.freeze({ shutdown, handleControlMessage });
}

module.exports = { createServerShutdownLifecycle };

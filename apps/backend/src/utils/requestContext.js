import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage();

export const runWithRequestContext = (context, fn) =>
  requestContextStorage.run(context, fn);

export const getRequestContext = () => requestContextStorage.getStore() || null;

export const getCurrentRequestId = () => getRequestContext()?.requestId || null;

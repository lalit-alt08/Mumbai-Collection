import test from "node:test";
import assert from "node:assert/strict";
import { UploadQueue } from "../src/utils/uploadQueue.js";

test("UploadQueue: initializes with default concurrency of 2", () => {
  const queue = new UploadQueue();
  const stats = queue.getStats();
  assert.equal(stats.concurrency, 2);
  assert.equal(stats.activeCount, 0);
  assert.equal(stats.queuedCount, 0);
});

test("UploadQueue: enforces bounded concurrency of at most 2 simultaneous tasks", async () => {
  const queue = new UploadQueue(2);
  let activeWorkers = 0;
  let maxObservedConcurrency = 0;

  const createTask = (delayMs, id) => () =>
    new Promise((resolve) => {
      activeWorkers++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeWorkers);
      setTimeout(() => {
        activeWorkers--;
        resolve(id);
      }, delayMs);
    });

  // Launch 5 tasks concurrently
  const promises = [
    queue.add(createTask(50, 1)),
    queue.add(createTask(50, 2)),
    queue.add(createTask(50, 3)),
    queue.add(createTask(50, 4)),
    queue.add(createTask(50, 5)),
  ];

  // At the moment of queuing, at most 2 should be active and 3 queued
  assert.equal(queue.getStats().activeCount, 2);
  assert.equal(queue.getStats().queuedCount, 3);

  const results = await Promise.all(promises);

  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(maxObservedConcurrency, 2, "Concurrency must never exceed 2");
  assert.equal(queue.getStats().activeCount, 0);
  assert.equal(queue.getStats().queuedCount, 0);
});

test("UploadQueue: pre-aborted task is rejected without running", async () => {
  const queue = new UploadQueue(2);
  const controller = new AbortController();
  controller.abort();

  let taskRan = false;
  const task = () => {
    taskRan = true;
    return Promise.resolve("done");
  };

  await assert.rejects(
    () => queue.add(task, { signal: controller.signal }),
    (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );

  assert.equal(taskRan, false, "Pre-aborted task must not run");
});

test("UploadQueue: task aborted while queued does not execute and queue advances", async () => {
  const queue = new UploadQueue(1);
  const controller = new AbortController();

  let task1Finished = false;
  let task2Ran = false;
  let task3Ran = false;

  const task1 = () =>
    new Promise((resolve) =>
      setTimeout(() => {
        task1Finished = true;
        resolve("task1");
      }, 50)
    );

  const task2 = () =>
    new Promise((resolve) => {
      task2Ran = true;
      resolve("task2");
    });

  const task3 = () =>
    new Promise((resolve) => {
      task3Ran = true;
      resolve("task3");
    });

  // Enqueue task1 (runs immediately)
  const p1 = queue.add(task1);

  // Enqueue task2 with signal (waits in queue)
  const p2 = queue.add(task2, { signal: controller.signal });

  // Enqueue task3 (waits in queue behind task2)
  const p3 = queue.add(task3);

  // Abort task2 before task1 finishes
  controller.abort();

  const r1 = await p1;
  assert.equal(r1, "task1");

  await assert.rejects(
    () => p2,
    (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );
  assert.equal(task2Ran, false, "Aborted queued task must not run");

  const r3 = await p3;
  assert.equal(r3, "task3");
  assert.equal(task3Ran, true, "Subsequent queued task must run after previous was aborted");
});

test("UploadQueue: error isolation ensures failing task does not block or fail others", async () => {
  const queue = new UploadQueue(2);

  const successTask = (val) => () => Promise.resolve(val);
  const failTask = () => () => Promise.reject(new Error("Network timeout"));

  const p1 = queue.add(successTask("first"));
  const p2 = queue.add(failTask());
  const p3 = queue.add(successTask("third"));

  const r1 = await p1;
  assert.equal(r1, "first");

  await assert.rejects(
    () => p2,
    (err) => {
      assert.equal(err.message, "Network timeout");
      return true;
    }
  );

  const r3 = await p3;
  assert.equal(r3, "third");
  assert.equal(queue.getStats().activeCount, 0);
  assert.equal(queue.getStats().queuedCount, 0);
});

test("UploadQueue: clear() aborts all waiting tasks and empties the queue", async () => {
  const queue = new UploadQueue(1);

  const slowTask = () => new Promise((resolve) => setTimeout(resolve, 60));
  const queuedTask = () => Promise.resolve("should not run");

  const p1 = queue.add(slowTask);
  const p2 = queue.add(queuedTask);
  const p3 = queue.add(queuedTask);

  assert.equal(queue.getStats().queuedCount, 2);

  queue.clear();
  assert.equal(queue.getStats().queuedCount, 0);

  await assert.rejects(
    () => p2,
    (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );

  await assert.rejects(
    () => p3,
    (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );

  await p1; // active task finishes normally
  assert.equal(queue.getStats().activeCount, 0);
});

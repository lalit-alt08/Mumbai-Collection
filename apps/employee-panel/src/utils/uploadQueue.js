/**
 * Concurrency-controlled async execution queue.
 * Ensures at most `concurrency` (default 2) tasks run simultaneously.
 */
export class UploadQueue {
  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, concurrency);
    this.activeCount = 0;
    this.queue = [];
  }

  /**
   * Add an async task function to the queue.
   *
   * @param {() => Promise<any>} taskFn
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<any>}
   */
  add(taskFn, options = {}) {
    return new Promise((resolve, reject) => {
      const item = {
        taskFn,
        resolve,
        reject,
        signal: options.signal,
      };

      if (options.signal?.aborted) {
        const err = new Error("Upload aborted before start");
        err.name = "AbortError";
        return reject(err);
      }

      this.queue.push(item);
      this.processNext();
    });
  }

  /**
   * Process the next task in the queue if a concurrency slot is available.
   */
  processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    if (item.signal?.aborted) {
      const err = new Error("Upload aborted before start");
      err.name = "AbortError";
      item.reject(err);
      // Immediately check for the next task
      this.processNext();
      return;
    }

    this.activeCount++;

    Promise.resolve()
      .then(() => item.taskFn())
      .then(
        (result) => {
          this.activeCount--;
          this.processNext();
          item.resolve(result);
        },
        (error) => {
          this.activeCount--;
          this.processNext();
          item.reject(error);
        }
      );
  }

  /**
   * Clear all pending items in the queue
   */
  clear() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const err = new Error("Queue cleared");
      err.name = "AbortError";
      item?.reject(err);
    }
  }

  /**
   * Get current queue depth and active worker count
   */
  getStats() {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      concurrency: this.concurrency,
    };
  }
}

export default UploadQueue;

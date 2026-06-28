// 每个 worker 只有等当前任务完整终态后才取下一项，因此活动 Promise 数永远不超过 limit。
export async function runSlidingWindow<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
) {
  let cursor = 0;
  async function runWorker() {
    while (!shouldStop()) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
}

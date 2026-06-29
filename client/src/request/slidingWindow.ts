// 动态滑动窗口：调大后立即补充任务；调小时不打断在途请求，
// 等活动任务自然完成并降到新上限后，才继续派发新任务。
export async function runSlidingWindow<T>(
  items: T[],
  getLimit: () => number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
) {
  let cursor = 0;
  let active = 0;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: number | undefined;

    function finish(error?: unknown) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearInterval(timer);
      if (error) reject(error);
      else resolve();
    }

    function schedule() {
      if (settled) return;
      if ((cursor >= items.length || shouldStop()) && active === 0) {
        finish();
        return;
      }

      // 每次调度都读取最新上限，因此运行过程中也能扩容或缩容。
      const limit = Math.max(1, Math.floor(getLimit()));
      while (!shouldStop() && cursor < items.length && active < limit) {
        const item = items[cursor];
        cursor += 1;
        active += 1;

        void worker(item).then(
          () => {
            active -= 1;
            schedule();
          },
          (error) => {
            active -= 1;
            finish(error);
          },
        );
      }
    }

    // 定时唤醒负责响应“调大窗口”；任务完成时也会立即触发下一次调度。
    timer = window.setInterval(schedule, 100);
    schedule();
  });
}

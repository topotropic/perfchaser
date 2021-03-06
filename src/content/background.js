const NS_PER_MS = 1000 * 1000;

// TODO: read from settings
const INTERVAL_PROCESS_UPDATE = 5; // seconds

class TaskManager extends Object {
  constructor() {
    super();

    // TODO: Set enabled status based on global setting and selected sidebar
    // process pane.
    this.includeThreads = true;
    this.includeWindows = true;

    this.interval_process_update = INTERVAL_PROCESS_UPDATE;

    this.lastSnapshotTime;
    this.processes = [];

    browser.alarms.onAlarm.addListener(this.refreshProcesses.bind(this));
    browser.runtime.onMessage.addListener(this.handleMessage.bind(this));

    this.createProcessInfoAlarm();
  }

  createProcessInfoAlarm() {
    if (browser.alarms.get("get-process-info")) {
      browser.alarms.clear("get-process-info");
    }
    browser.alarms.create("get-process-info", {
      when: Date.now(),
      periodInMinutes: this.interval_process_update / 60,
    });
  }

  async handleMessage(request) {
    switch (request.name) {
      case "get-process-list":
        return this.refreshProcesses();
      case "get-process-details":
        return this.getProcessDetails(request.pid);
      case "get-page-list":
        return this.getPageInfo(request.pid);
      case "get-thread-list":
        return this.getThreadInfo(request.pid);
      case "set-update-interval":
        this.interval_process_update = request.interval;
        this.createProcessInfoAlarm();
    }
  }

  async refreshProcesses() {
    const { timeStamp, processes } = await browser.processes.getProcessInfo(
      this.includeThreads,
      this.includeWindows
    );

    const timeDelta = (timeStamp - this.lastSnapshotTime) * NS_PER_MS;

    this.lastSnapshotTime = timeStamp;

    this.processes = processes.map(process => {
      const previousProcess = this.processes.find(p => p.pid == process.pid);

      if (previousProcess) {
        process.currentCpuKernel =
          (process.cpuKernel - previousProcess.cpuKernel) / timeDelta;
        process.currentCpuUser =
          (process.cpuUser - previousProcess.cpuUser) / timeDelta;
        process.currentCpu = process.currentCpuKernel + process.currentCpuUser;
      } else {
        process.currentCpuKernel = 0;
        process.currentCpuUser = 0;
        process.currentCpu = 0;
      }

      process.threads = process.threads.map(thread => {
        const previousThread =
          previousProcess?.threads.find(t => t.tid == thread.tid);

        if (previousThread) {
          thread.currentCpuKernel =
            (thread.cpuKernel - previousThread.cpuKernel) / timeDelta;
          thread.currentCpuUser =
            (thread.cpuUser - previousThread.cpuUser) / timeDelta;
          thread.currentCpu = thread.currentCpuKernel + thread.currentCpuUser;
        } else {
          thread.currentCpuKernel = 0;
          thread.currentCpuUser = 0;
          thread.currentCpu = 0;
        }

        return thread;
      });

      return process;
    });

    return browser.runtime.sendMessage({
      name: "process-list",
      processes: this.processes.map(process => {
        return {
          type: process.type,
          pid: process.pid,
          isParent: process.isParent,
          currentCpu: process.currentCpu,
          residentMemory: process.residentMemory,
        }
      }),
    });
  }

  async getProcessDetails(pid) {
    const process = this.processes.find(process => process.pid == pid);
    if (!process) {
      return;
    }

    return browser.runtime.sendMessage({
      name: "process-details",
      details: {
        name: process.filename,
        threadCount: process.threadCount,
      },
    });
  }

  async getPageInfo(pid) {
    const process = this.processes.find(process => process.pid == pid);
    if (!process) {
      return;
    }

    return browser.runtime.sendMessage({
      name: "page-list",
      pages: process.windows,
    });
  }

  async getThreadInfo(pid) {
    const process = this.processes.find(process => process.pid == pid);
    if (!process) {
      return;
    }

    return browser.runtime.sendMessage({
      name: "thread-list",
      threads: process.threads,
    });
  }
}

const taskManager = new TaskManager();

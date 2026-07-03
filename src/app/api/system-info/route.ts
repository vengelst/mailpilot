import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import os from "os";
import { execSync } from "child_process";

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 5000, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getCpuInfo() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  return {
    model: cpus[0]?.model ?? "Unknown",
    cores: cpus.length,
    loadAvg1m: loadAvg[0],
    loadAvg5m: loadAvg[1],
    loadAvg15m: loadAvg[2],
    usagePercent: Math.round((loadAvg[0] / cpus.length) * 100),
  };
}

function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalGB: +(total / 1073741824).toFixed(2),
    usedGB: +(used / 1073741824).toFixed(2),
    freeGB: +(free / 1073741824).toFixed(2),
    usagePercent: Math.round((used / total) * 100),
  };
}

function getDiskInfo() {
  const raw = safeExec("df -h / | tail -1");
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  return {
    filesystem: parts[0] ?? "",
    size: parts[1] ?? "",
    used: parts[2] ?? "",
    available: parts[3] ?? "",
    usagePercent: parseInt(parts[4] ?? "0", 10),
  };
}

function getTopProcesses(): Array<{ pid: string; cpu: string; mem: string; command: string }> {
  const raw = safeExec("ps aux --sort=-%cpu | head -11");
  if (!raw) return [];
  const lines = raw.split("\n").slice(1);
  return lines.map((line) => {
    const parts = line.split(/\s+/);
    return {
      pid: parts[1] ?? "",
      cpu: parts[2] ?? "0",
      mem: parts[3] ?? "0",
      command: parts.slice(10).join(" ").slice(0, 80),
    };
  });
}

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const result: Array<{ name: string; address: string; family: string }> = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        result.push({ name, address: addr.address, family: addr.family });
      }
    }
  }

  const netStats = safeExec("cat /proc/net/dev 2>/dev/null | grep -v lo | tail -n +3");
  const ifStats: Array<{ name: string; rxMB: number; txMB: number }> = [];
  if (netStats) {
    for (const line of netStats.split("\n")) {
      const match = line.match(/^\s*(\w+):\s+(\d+)\s+.*?\s+(\d+)/);
      if (match) {
        ifStats.push({
          name: match[1],
          rxMB: +(parseInt(match[2], 10) / 1048576).toFixed(1),
          txMB: +(parseInt(match[3], 10) / 1048576).toFixed(1),
        });
      }
    }
  }

  return { interfaces: result, stats: ifStats };
}

function getUptime() {
  const uptimeSec = os.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  return { seconds: uptimeSec, formatted: `${days}d ${hours}h ${minutes}m` };
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const [emailCount, accountCount, userCount, users, folderStats] = await Promise.all([
    prisma.emailIndex.count(),
    prisma.mailAccount.count(),
    prisma.user.count(),
    prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 15,
    }),
  ]);

  return ok({
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: getUptime(),
    },
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
    disk: getDiskInfo(),
    network: getNetworkInfo(),
    topProcesses: getTopProcesses(),
    database: {
      emailCount,
      accountCount,
      userCount,
      users,
      topFolders: folderStats.map((f) => ({
        folder: f.folderPath,
        count: f._count.id,
      })),
    },
  });
}

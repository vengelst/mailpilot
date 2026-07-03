"use client";

import { useEffect, useState, useCallback } from "react";

type SystemInfo = {
  server: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    uptime: { seconds: number; formatted: string };
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    usagePercent: number;
  };
  memory: {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
  };
  disk: {
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usagePercent: number;
  } | null;
  network: {
    interfaces: Array<{ name: string; address: string; family: string }>;
    stats: Array<{ name: string; rxMB: number; txMB: number }>;
  };
  topProcesses: Array<{ pid: string; cpu: string; mem: string; command: string }>;
  database: {
    emailCount: number;
    accountCount: number;
    userCount: number;
    users: Array<{ id: string; email: string; role: string; createdAt: string }>;
    topFolders: Array<{ folder: string; count: number }>;
  };
};

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-3 rounded-full bg-white/20 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5 rounded-2xl">
      <h3 className="text-sm font-semibold glass-text-primary mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function SystemInfoPage() {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/system-info");
      if (!res.ok) throw new Error("Fehler beim Laden");
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
      setError("");
    } catch {
      setError("System-Informationen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-5xl">
          <p className="text-red-500">{error}</p>
        </div>
      </main>
    );
  }

  const cpuColor = data.cpu.usagePercent > 80 ? "bg-red-500" : data.cpu.usagePercent > 50 ? "bg-yellow-500" : "bg-green-500";
  const memColor = data.memory.usagePercent > 85 ? "bg-red-500" : data.memory.usagePercent > 60 ? "bg-yellow-500" : "bg-green-500";
  const diskColor = data.disk && data.disk.usagePercent > 85 ? "bg-red-500" : data.disk && data.disk.usagePercent > 60 ? "bg-yellow-500" : "bg-green-500";

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/settings" className="text-sm glass-text-secondary hover:underline">
            ← Einstellungen
          </a>
        </div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold glass-text-primary">Systeminformationen</h1>
            <p className="mt-1 text-sm glass-text-secondary">
              Server-Performance und Ressourcenauslastung
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs glass-text-tertiary">
                Aktualisiert: {lastUpdate.toLocaleTimeString("de-DE")}
              </span>
            )}
            <button
              onClick={() => void loadData()}
              className="glass-btn px-3 py-1.5 rounded-lg text-xs"
            >
              ↻ Aktualisieren
            </button>
          </div>
        </div>

        {/* Server Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="glass-card p-4 rounded-xl text-center">
            <p className="text-2xl font-bold glass-text-primary">{data.database.emailCount.toLocaleString("de-DE")}</p>
            <p className="text-xs glass-text-secondary mt-1">E-Mails gesamt</p>
          </div>
          <div className="glass-card p-4 rounded-xl text-center">
            <p className="text-2xl font-bold glass-text-primary">{data.database.accountCount}</p>
            <p className="text-xs glass-text-secondary mt-1">IMAP-Konten</p>
          </div>
          <div className="glass-card p-4 rounded-xl text-center">
            <p className="text-2xl font-bold glass-text-primary">{data.database.userCount}</p>
            <p className="text-xs glass-text-secondary mt-1">Benutzer</p>
          </div>
          <div className="glass-card p-4 rounded-xl text-center">
            <p className="text-2xl font-bold glass-text-primary">{data.server.uptime.formatted}</p>
            <p className="text-xs glass-text-secondary mt-1">Uptime</p>
          </div>
        </div>

        {/* CPU + Memory + Disk */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard title="CPU-Auslastung">
            <div className="space-y-2">
              <div className="flex justify-between text-xs glass-text-secondary">
                <span>Last (1m / 5m / 15m)</span>
                <span className="font-mono">{data.cpu.loadAvg1m.toFixed(2)} / {data.cpu.loadAvg5m.toFixed(2)} / {data.cpu.loadAvg15m.toFixed(2)}</span>
              </div>
              <ProgressBar percent={data.cpu.usagePercent} color={cpuColor} />
              <div className="flex justify-between text-xs">
                <span className="glass-text-tertiary">{data.cpu.cores} Kerne</span>
                <span className="font-semibold glass-text-primary">{data.cpu.usagePercent}%</span>
              </div>
              <p className="text-[10px] glass-text-tertiary truncate">{data.cpu.model}</p>
            </div>
          </StatCard>

          <StatCard title="Arbeitsspeicher (RAM)">
            <div className="space-y-2">
              <div className="flex justify-between text-xs glass-text-secondary">
                <span>{data.memory.usedGB} GB / {data.memory.totalGB} GB</span>
                <span>{data.memory.freeGB} GB frei</span>
              </div>
              <ProgressBar percent={data.memory.usagePercent} color={memColor} />
              <div className="flex justify-end text-xs">
                <span className="font-semibold glass-text-primary">{data.memory.usagePercent}%</span>
              </div>
            </div>
          </StatCard>

          <StatCard title="Festplatte">
            {data.disk ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs glass-text-secondary">
                  <span>{data.disk.used} / {data.disk.size}</span>
                  <span>{data.disk.available} frei</span>
                </div>
                <ProgressBar percent={data.disk.usagePercent} color={diskColor} />
                <div className="flex justify-between text-xs">
                  <span className="glass-text-tertiary">{data.disk.filesystem}</span>
                  <span className="font-semibold glass-text-primary">{data.disk.usagePercent}%</span>
                </div>
              </div>
            ) : (
              <p className="text-xs glass-text-tertiary">Nicht verfügbar</p>
            )}
          </StatCard>
        </div>

        {/* Network + Server Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <StatCard title="Netzwerk">
            <div className="space-y-3">
              {data.network.interfaces.map((iface, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="glass-text-secondary font-mono">{iface.name}</span>
                  <span className="glass-text-primary">{iface.address}</span>
                </div>
              ))}
              {data.network.stats.length > 0 && (
                <div className="border-t border-white/10 pt-2 mt-2">
                  <p className="text-[10px] glass-text-tertiary mb-1">Traffic (seit Boot)</p>
                  {data.network.stats.map((s, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="glass-text-secondary font-mono">{s.name}</span>
                      <span className="glass-text-primary">↓ {s.rxMB} MB / ↑ {s.txMB} MB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </StatCard>

          <StatCard title="Server-Details">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="glass-text-secondary">Hostname</span>
                <span className="glass-text-primary font-mono">{data.server.hostname}</span>
              </div>
              <div className="flex justify-between">
                <span className="glass-text-secondary">Plattform</span>
                <span className="glass-text-primary">{data.server.platform} ({data.server.arch})</span>
              </div>
              <div className="flex justify-between">
                <span className="glass-text-secondary">Node.js</span>
                <span className="glass-text-primary font-mono">{data.server.nodeVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="glass-text-secondary">Uptime</span>
                <span className="glass-text-primary">{data.server.uptime.formatted}</span>
              </div>
            </div>
          </StatCard>
        </div>

        {/* Top Processes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <StatCard title="Top 10 Prozesse (CPU)">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="glass-text-tertiary">
                    <th className="text-left py-1">PID</th>
                    <th className="text-right py-1">CPU%</th>
                    <th className="text-right py-1">MEM%</th>
                    <th className="text-left py-1 pl-3">Befehl</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProcesses.map((p, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-1 font-mono glass-text-secondary">{p.pid}</td>
                      <td className="text-right py-1 font-mono glass-text-primary">{p.cpu}</td>
                      <td className="text-right py-1 font-mono glass-text-primary">{p.mem}</td>
                      <td className="py-1 pl-3 glass-text-secondary truncate max-w-[200px]">{p.command}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StatCard>

          {/* Top Folders */}
          <StatCard title="Top 15 Ordner (E-Mail-Anzahl)">
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {data.database.topFolders.map((f, i) => (
                <div key={i} className="flex justify-between text-xs gap-2">
                  <span className="glass-text-secondary truncate">{f.folder}</span>
                  <span className="glass-text-primary font-mono whitespace-nowrap">{f.count.toLocaleString("de-DE")}</span>
                </div>
              ))}
            </div>
          </StatCard>
        </div>

        {/* Registered Users */}
        <StatCard title="Registrierte Benutzer">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="glass-text-tertiary">
                  <th className="text-left py-1">E-Mail</th>
                  <th className="text-left py-1">Rolle</th>
                  <th className="text-left py-1">Registriert</th>
                </tr>
              </thead>
              <tbody>
                {data.database.users.map((u) => (
                  <tr key={u.id} className="border-t border-white/5">
                    <td className="py-1.5 glass-text-primary">{u.email}</td>
                    <td className="py-1.5 glass-text-secondary">{u.role}</td>
                    <td className="py-1.5 glass-text-secondary">
                      {new Date(u.createdAt).toLocaleDateString("de-DE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StatCard>

        <p className="mt-4 text-[10px] glass-text-tertiary text-center">
          Daten werden alle 30 Sekunden automatisch aktualisiert.
        </p>
      </div>
    </main>
  );
}

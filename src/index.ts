import { file } from "bun";
import { spawn } from "bun";
import { addTorrent, getTorrentStatus, getHashFromMagnet } from "./qbittorrent";

const PORT = process.env.PORT || 3000;
const COMPOSE_FILE = process.env.COMPOSE_FILE || "/docker-compose/docker-compose.yml";
const COMPOSE_DIR = COMPOSE_FILE.substring(0, COMPOSE_FILE.lastIndexOf('/'));
const LOG_LOOKER_SERVICE_NAME = process.env.LOG_LOOKER_SERVICE_NAME;
const ERROR_TRIGGER = "[torbox-webdav] Failed to stream with initial link";
const LOG_RESTART_ONLY = process.env.LOG_RESTART_ONLY
  ? process.env.LOG_RESTART_ONLY.split(',').map(s => s.trim()).filter(s => s.length > 0)
  : [];
const CRITICAL_SERVICES = process.env.CRITICAL_SERVICES
  ? process.env.CRITICAL_SERVICES.split(',').map(s => s.trim()).filter(s => s.length > 0)
  : [];

// Helper to determine docker command prefix
function getDockerCmd(args: string[]): string[] {
    return ["docker", ...args];
}

let isRestarting = false;

async function startLogMonitor() {
  if (!LOG_LOOKER_SERVICE_NAME) {
    console.log("LOG_LOOKER_SERVICE_NAME not set. Log monitoring disabled.");
    return;
  }

  console.log(`Starting log monitor for service: ${LOG_LOOKER_SERVICE_NAME}`);

  let lastRestartTime = 0;
  const RESTART_COOLDOWN = 60000; // 1 minute cooldown

  while (true) {
    try {
      console.log(`Spawning docker logs for ${LOG_LOOKER_SERVICE_NAME}...`);
      const proc = spawn(getDockerCmd(["compose", "-f", COMPOSE_FILE, "logs", "-f", "--tail", "0", "--no-log-prefix", LOG_LOOKER_SERVICE_NAME]), {
        stdout: "pipe",
        stderr: "pipe", // Capture stderr too just in case, or ignore
        cwd: COMPOSE_DIR,
        env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
      });

      const decoder = new TextDecoder();
      // Read from stdout
      for await (const chunk of proc.stdout) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n');
        
        for (const line of lines) {
          console.log(`[Monitor] Line: "${line.trim()}"`);
            if (line.includes(ERROR_TRIGGER)) {
                const now = Date.now();
                if (isRestarting || (now - lastRestartTime < RESTART_COOLDOWN)) {
                    continue;
                }
                
                console.log(`[Monitor] Trigger detected in ${LOG_LOOKER_SERVICE_NAME}: "${line.trim()}"`);
                console.log("[Monitor] Initiating restart...");
                
                isRestarting = true;
                // Don't await here to keep monitoring? 
                // Actually if we restart, the log stream might die if the service is restarted.
                // If we restart *all* services or the monitored service, this stream will end.
                // We should handle that.
                
                restartDockerCompose(LOG_RESTART_ONLY).then(() => {
                   lastRestartTime = Date.now();
                   isRestarting = false;
                }).catch(err => {
                   console.error("[Monitor] Restart failed:", err);
                   isRestarting = false;
                });
            }
        }
      }

      await proc.exited;
      console.log("Log monitor process exited. Restarting monitor in 5 seconds...");
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      console.error(`Error in log monitor:`, error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function restartDockerCompose(targetServices: string[] = []): Promise<{ success: boolean; error?: string; logs?: string[] }> {
  const logs: string[] = [];

  try {
    console.log(`Restarting Docker Compose services from: ${COMPOSE_FILE}`);
    logs.push("Starting restart process...");

    // If specific services are targeted (e.g. from LOG_RESTART_ONLY), restart only those
    if (targetServices.length > 0) {
      logs.push(`Restarting specific services: ${targetServices.join(', ')}`);
      console.log(`Restarting specific services: ${targetServices.join(', ')}`);

      for (const service of targetServices) {
        logs.push(`Restarting ${service}...`);
        const restartProc = spawn(getDockerCmd(["compose", "-f", COMPOSE_FILE, "restart", service]), {
          stdout: "pipe",
          stderr: "pipe",
          cwd: COMPOSE_DIR,
          env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
        });

        const restartError = await new Response(restartProc.stderr).text();
        await restartProc.exited;

        if (restartProc.exitCode !== 0) {
          const errorMsg = `Failed to restart ${service}: ${restartError}`;
          console.error(errorMsg);
          logs.push(errorMsg);
          return { success: false, error: errorMsg, logs };
        }
        logs.push(`${service} restarted successfully`);
        console.log(`${service} restarted successfully`);
      }
      
      return { success: true, logs };
    }

    // If critical services are defined, restart them first
    if (CRITICAL_SERVICES.length > 0) {
      logs.push(`Restarting critical services first: ${CRITICAL_SERVICES.join(', ')}`);
      console.log(`Restarting critical services: ${CRITICAL_SERVICES.join(', ')}`);

      // Restart critical services first
      for (const service of CRITICAL_SERVICES) {
        logs.push(`Restarting ${service}...`);
        const restartProc = spawn(getDockerCmd(["compose", "-f", COMPOSE_FILE, "restart", service]), {
          stdout: "pipe",
          stderr: "pipe",
          cwd: COMPOSE_DIR,
          env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
        });

        const restartError = await new Response(restartProc.stderr).text();
        await restartProc.exited;

        if (restartProc.exitCode !== 0) {
          const errorMsg = `Failed to restart ${service}: ${restartError}`;
          console.error(errorMsg);
          logs.push(errorMsg);
          return { success: false, error: errorMsg, logs };
        }
        logs.push(`${service} restarted successfully`);
        console.log(`${service} restarted successfully`);
      }

      logs.push("All critical services restarted, waiting for stabilization...");
      // Wait a bit for critical services to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Now restart all remaining services
    logs.push("Restarting all services...");
    console.log("Restarting all services...");

    const restartAllProc = spawn(getDockerCmd(["compose", "-f", COMPOSE_FILE, "restart"]), {
      stdout: "pipe",
      stderr: "pipe",
      cwd: COMPOSE_DIR,
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });

    const restartAllError = await new Response(restartAllProc.stderr).text();
    await restartAllProc.exited;

    if (restartAllProc.exitCode !== 0) {
      const errorMsg = `Failed to restart all services: ${restartAllError}`;
      console.error(errorMsg);
      logs.push(errorMsg);
      return { success: false, error: errorMsg, logs };
    }

    logs.push("All services restarted successfully!");
    console.log("Docker compose services restarted successfully");
    return { success: true, logs };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error restarting Docker Compose:", error);
    logs.push(`Error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      logs
    };
  }
}

async function checkDockerComposeStatus(): Promise<{ status: string }> {
  try {
    // Check if docker compose services are running
    const proc = spawn(getDockerCmd(["compose", "-f", COMPOSE_FILE, "ps", "-q"]), {
      stdout: "pipe",
      stderr: "pipe",
      cwd: COMPOSE_DIR,
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // If we have container IDs, services are running
    const hasRunningContainers = output.trim().length > 0;

    return { status: hasRunningContainers ? "online" : "offline" };
  } catch (error) {
    console.error("Error checking Docker Compose status:", error);
    return { status: "offline" };
  }
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120, // 120 seconds to allow for Docker operations
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(file("src/public/index.html"));
    }

    // API endpoints
    if (url.pathname === "/api/status") {
      const status = await checkDockerComposeStatus();
      return Response.json(status);
    }

    if (url.pathname === "/api/restart" && req.method === "POST") {
      const result = await restartDockerCompose();

      if (result.success) {
        return Response.json({
          success: true,
          message: "Containers restarted",
          logs: result.logs
        });
      } else {
        return Response.json(
          { success: false, error: result.error, logs: result.logs },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/torrent/add" && req.method === "POST") {
      try {
        const body = await req.json();
        const { magnet, type, name } = body;
        
        if (!magnet || !type || !name) {
            return Response.json({ error: "Missing required fields" }, { status: 400 });
        }

        await addTorrent(magnet, type, name);
        const hash = getHashFromMagnet(magnet);
        
        return Response.json({ success: true, hash });
      } catch (e: any) {
        console.error("Error adding torrent:", e);
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/torrent/check" && req.method === "GET") {
       const hash = url.searchParams.get("hash");
       const type = url.searchParams.get("type");
       if (!hash) {
           return Response.json({ error: "Missing hash" }, { status: 400 });
       }
       
       try {
           const status = await getTorrentStatus(hash, type || undefined);
           return Response.json(status || { found: false });
       } catch (e: any) {
           console.error("Error checking torrent:", e);
           return Response.json({ error: e.message }, { status: 500 });
       }
    }

    // 404
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
console.log(`Monitoring docker-compose file: ${COMPOSE_FILE}`);
if (CRITICAL_SERVICES.length > 0) {
  console.log(`Critical services (stop first): ${CRITICAL_SERVICES.join(', ')}`);
}
if (LOG_RESTART_ONLY.length > 0) {
    console.log(`Log monitor will only restart: ${LOG_RESTART_ONLY.join(', ')}`);
}

startLogMonitor();

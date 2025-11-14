import { file } from "bun";
import { spawn } from "bun";

const PORT = process.env.PORT || 3000;
const COMPOSE_FILE = process.env.COMPOSE_FILE || "/docker-compose/docker-compose.yml";
const COMPOSE_DIR = COMPOSE_FILE.substring(0, COMPOSE_FILE.lastIndexOf('/'));
const CRITICAL_SERVICES = process.env.CRITICAL_SERVICES
  ? process.env.CRITICAL_SERVICES.split(',').map(s => s.trim()).filter(s => s.length > 0)
  : [];

async function restartDockerCompose(): Promise<{ success: boolean; error?: string; logs?: string[] }> {
  const logs: string[] = [];

  try {
    console.log(`Restarting Docker Compose services from: ${COMPOSE_FILE}`);
    logs.push("Starting restart process...");

    // If critical services are defined, stop them first
    if (CRITICAL_SERVICES.length > 0) {
      logs.push(`Stopping critical services first: ${CRITICAL_SERVICES.join(', ')}`);
      console.log(`Stopping critical services: ${CRITICAL_SERVICES.join(', ')}`);

      // Stop critical services (Docker will auto-restart them due to restart: always)
      for (const service of CRITICAL_SERVICES) {
        logs.push(`Stopping ${service}...`);
        const stopProc = spawn(["docker", "compose", "-f", COMPOSE_FILE, "stop", service], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: COMPOSE_DIR,
          env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
        });

        const stopError = await new Response(stopProc.stderr).text();
        await stopProc.exited;

        if (stopProc.exitCode !== 0) {
          const errorMsg = `Failed to stop ${service}: ${stopError}`;
          console.error(errorMsg);
          logs.push(errorMsg);
          return { success: false, error: errorMsg, logs };
        }
        logs.push(`${service} stopped (will auto-restart)`);
        console.log(`${service} stopped successfully`);
      }

      logs.push("All critical services stopped, waiting for graceful shutdown...");
      // Wait a bit for critical services to fully stop and restart
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Now stop all remaining services (Docker will auto-restart them due to restart: always)
    logs.push("Stopping all services...");
    console.log("Stopping all services...");

    const stopAllProc = spawn(["docker", "compose", "-f", COMPOSE_FILE, "stop"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: COMPOSE_DIR,
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });

    const stopAllError = await new Response(stopAllProc.stderr).text();
    await stopAllProc.exited;

    if (stopAllProc.exitCode !== 0) {
      const errorMsg = `Failed to stop all services: ${stopAllError}`;
      console.error(errorMsg);
      logs.push(errorMsg);
      return { success: false, error: errorMsg, logs };
    }

    logs.push("All services stopped successfully! Docker will auto-restart them.");
    console.log("Docker compose services stopped - Docker daemon will auto-restart them");
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
    const proc = spawn(["docker", "compose", "-f", COMPOSE_FILE, "ps", "-q"], {
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

    // 404
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
console.log(`Monitoring docker-compose file: ${COMPOSE_FILE}`);
if (CRITICAL_SERVICES.length > 0) {
  console.log(`Critical services (stop first): ${CRITICAL_SERVICES.join(', ')}`);
}

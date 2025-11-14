import { file } from "bun";
import { spawn } from "bun";

const PORT = process.env.PORT || 3000;
const COMPOSE_FILE = process.env.COMPOSE_FILE || "/docker-compose/docker-compose.yml";

async function restartDockerCompose(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Restarting Docker Compose services from: ${COMPOSE_FILE}`);

    // Run docker compose restart command
    const proc = spawn({
      cmd: ["docker", "compose", "-f", COMPOSE_FILE, "restart"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    await proc.exited;

    if (proc.exitCode !== 0) {
      console.error("Docker compose restart failed:", error);
      return { success: false, error: error || "Failed to restart containers" };
    }

    console.log("Docker compose restart successful:", output);
    return { success: true };
  } catch (error) {
    console.error("Error restarting Docker Compose:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

async function checkDockerComposeStatus(): Promise<{ status: string }> {
  try {
    // Check if docker compose services are running
    const proc = spawn({
      cmd: ["docker", "compose", "-f", COMPOSE_FILE, "ps", "-q"],
      stdout: "pipe",
      stderr: "pipe",
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
        return Response.json({ success: true, message: "Containers restarted" });
      } else {
        return Response.json(
          { success: false, error: result.error },
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

/** Cloudflare Containers entrypoint: edge auth guard + proxies traffic to the singleton ragoss Node container. */
import { Container } from "@cloudflare/containers";

export class RagossContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "30m";
  pingEndpoint = "/health";

  onStart(): void {
    console.log("ragoss container started");
  }
  onError(error: Error): void {
    console.error("ragoss container error:", error);
  }
}

// minimal local typings so this file typechecks without workers-types globals
interface ContainerInstance {
  startAndWaitForPorts(opts?: { startOptions?: { envVars?: Record<string, string> } }): Promise<void>;
  fetch(req: Request): Promise<Response>;
}
interface Env {
  RAGOSS: { getByName(id: string): ContainerInstance };
  ADMIN_TOKEN?: string;
}

/** paths guarded by ADMIN_TOKEN at the edge (mirrors the in-container guard): panel + admin APIs */
function isProtected(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/api/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.ADMIN_TOKEN && isProtected(new URL(request.url).pathname)) {
      const provided =
        request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
        new URL(request.url).searchParams.get("token") ??
        "";
      if (provided !== env.ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    const container = env.RAGOSS.getByName("ragoss");
    await container.startAndWaitForPorts(
      env.ADMIN_TOKEN ? { startOptions: { envVars: { ADMIN_TOKEN: env.ADMIN_TOKEN } } } : undefined,
    );
    return container.fetch(request);
  },
};

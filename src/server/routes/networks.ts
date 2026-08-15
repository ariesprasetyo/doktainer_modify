import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { auditLog } from "../services/audit.service";
import * as ssh from "../services/ssh.service";

const NetworkSchema = z.object({
  name: z.string().min(1).max(120),
  driver: z.string().min(1).max(40).default("bridge"),
  scope: z.string().min(1).max(40).default("local"),
  subnet: z.string().max(80).optional(),
  gateway: z.string().max(80).optional(),
  containers: z.number().int().min(0).default(0),
  serverId: z.string().min(1),
});

export async function networkRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authenticate] }, async (req, reply) => {
    const { serverId } = req.query as { serverId?: string };

    const networks = await prisma.network.findMany({
      where: {
        ...(serverId ? { serverId } : {}),
        server: { organizationId: req.organizationId! },
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        server: {
          select: { id: true, name: true, ip: true, organizationId: true },
        },
      },
    });

    return reply.send({ success: true, data: networks });
  });

  app.get("/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const network = await prisma.network.findUnique({
      where: { id },
      include: { server: true },
    });

    if (!network || network.server.organizationId !== req.organizationId) {
      return reply
        .status(404)
        .send({ success: false, error: "Network not found" });
    }

    try {
      const detail = await ssh.dockerNetworkInspect(
        network.server,
        network.name,
      );

      return reply.send({
        success: true,
        data: {
          network: {
            id: network.id,
            name: network.name,
            driver: network.driver,
            scope: network.scope,
            subnet: network.subnet,
            gateway: network.gateway,
            containers: network.containers,
            serverId: network.serverId,
            createdAt: network.createdAt,
            updatedAt: network.updatedAt,
          },
          server: {
            id: network.server.id,
            name: network.server.name,
            ip: network.server.ip,
          },
          detail,
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load network details",
      });
    }
  });

  app.post(
    "/",
    { preHandler: [requireRole("DEVELOPER")] },
    async (req, reply) => {
      const body = NetworkSchema.safeParse(req.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ success: false, error: body.error.flatten() });
      }

      const server = await prisma.server.findUnique({
        where: { id: body.data.serverId },
      });

      if (!server || server.organizationId !== req.organizationId) {
        return reply
          .status(404)
          .send({ success: false, error: "Server not found" });
      }

      const existing = await prisma.network.findFirst({
        where: { serverId: body.data.serverId, name: body.data.name },
        select: { id: true },
      });

      if (existing) {
        return reply.status(409).send({
          success: false,
          error: "Network already exists on this server",
        });
      }

      const dockerStatus = await ssh.getDockerRuntimeStatus(server);
      if (!dockerStatus.available) {
        return reply.status(400).send({
          success: false,
          error:
            dockerStatus.reason ||
            "Docker is not available on the selected server",
        });
      }

      try {
        await ssh.createDockerNetwork(server, {
          name: body.data.name,
          driver: body.data.driver,
          subnet: body.data.subnet,
          gateway: body.data.gateway,
        });
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error:
            error instanceof Error
              ? `Failed to create Docker network on ${server.name}: ${error.message}`
              : `Failed to create Docker network on ${server.name}`,
        });
      }

      const network = await prisma.network.create({
        data: {
          ...body.data,
          subnet: body.data.subnet?.trim() || null,
          gateway: body.data.gateway?.trim() || null,
        },
        include: {
          server: {
            select: { id: true, name: true, ip: true, organizationId: true },
          },
        },
      });

      await auditLog({
        userId: req.userId,
        organizationId: req.organizationId,
        serverId: server.id,
        action: "NETWORK_ADD",
        category: "SYSTEM",
        level: "SUCCESS",
        message: `Network "${network.name}" created on server "${server.name}"`,
      });

      return reply.status(201).send({ success: true, data: network });
    },
  );

  app.post(
    "/sync",
    { preHandler: [requireRole("DEVELOPER")] },
    async (req, reply) => {
      const body = z
        .object({ serverId: z.string().optional() })
        .safeParse(req.body ?? {});

      if (!body.success) {
        return reply
          .status(400)
          .send({ success: false, error: body.error.flatten() });
      }

      const servers = await prisma.server.findMany({
        where: {
          ...(body.data.serverId ? { id: body.data.serverId } : {}),
          organizationId: req.organizationId!,
        },
        orderBy: { name: "asc" },
      });

      if (servers.length === 0) {
        return reply
          .status(404)
          .send({ success: false, error: "Server not found" });
      }

      const summary: Array<{
        serverId: string;
        serverName: string;
        synced: number;
      }> = [];

      for (const server of servers) {
        let actualNetworks;
        try {
          actualNetworks = await ssh.listDockerNetworks(server);
        } catch (error) {
          return reply.status(400).send({
            success: false,
            error:
              error instanceof Error
                ? `Failed to sync Docker networks from ${server.name}: ${error.message}`
                : `Failed to sync Docker networks from ${server.name}`,
          });
        }

        const networkNames = actualNetworks.map((network) => network.name);

        await prisma.$transaction(async (tx) => {
          for (const network of actualNetworks) {
            await tx.network.upsert({
              where: {
                serverId_name: {
                  serverId: server.id,
                  name: network.name,
                },
              },
              update: {
                driver: network.driver,
                scope: network.scope,
                subnet: network.subnet ?? null,
                gateway: network.gateway ?? null,
                containers: network.containers,
              },
              create: {
                serverId: server.id,
                name: network.name,
                driver: network.driver,
                scope: network.scope,
                subnet: network.subnet ?? null,
                gateway: network.gateway ?? null,
                containers: network.containers,
              },
            });
          }

          await tx.network.deleteMany({
            where: {
              serverId: server.id,
              ...(networkNames.length > 0
                ? { name: { notIn: networkNames } }
                : {}),
            },
          });
        });

        await auditLog({
          userId: req.userId,
          organizationId: req.organizationId,
          serverId: server.id,
          action: "NETWORK_SYNC",
          category: "SYSTEM",
          level: "INFO",
          message: `Synced ${actualNetworks.length} Docker networks from server "${server.name}"`,
        });

        summary.push({
          serverId: server.id,
          serverName: server.name,
          synced: actualNetworks.length,
        });
      }

      const networks = await prisma.network.findMany({
        where: {
          ...(body.data.serverId ? { serverId: body.data.serverId } : {}),
          server: { organizationId: req.organizationId! },
        },
        orderBy: [{ createdAt: "desc" }],
        include: {
          server: {
            select: { id: true, name: true, ip: true, organizationId: true },
          },
        },
      });

      return reply.send({ success: true, data: networks, meta: { summary } });
    },
  );

  app.delete(
    "/:id",
    { preHandler: [requireRole("DEVELOPER")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const network = await prisma.network.findUnique({
        where: { id },
        include: { server: true },
      });

      if (!network || network.server.organizationId !== req.organizationId) {
        return reply
          .status(404)
          .send({ success: false, error: "Network not found" });
      }

      // Answered before contacting the server: Docker owns these and will
      // never remove them, so reaching out would only turn a known answer
      // into a command failure.
      if (ssh.isPredefinedDockerNetwork(network.name)) {
        return reply.status(400).send({
          success: false,
          error: `"${network.name}" is a built-in Docker network and cannot be removed`,
        });
      }

      const dockerStatus = await ssh.getDockerRuntimeStatus(network.server);
      if (!dockerStatus.available) {
        return reply.status(400).send({
          success: false,
          error:
            dockerStatus.reason ||
            "Docker is not available on the selected server",
        });
      }

      try {
        await ssh.removeDockerNetwork(network.server, network.name);
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error:
            error instanceof Error
              ? `Failed to delete Docker network from ${network.server.name}: ${error.message}`
              : `Failed to delete Docker network from ${network.server.name}`,
        });
      }

      await prisma.network.delete({ where: { id } });

      await auditLog({
        userId: req.userId,
        organizationId: req.organizationId,
        serverId: network.serverId,
        action: "NETWORK_DELETE",
        category: "SYSTEM",
        level: "WARNING",
        message: `Network "${network.name}" deleted from server "${network.server.name}"`,
      });

      return reply.send({ success: true, message: "Network deleted" });
    },
  );
}

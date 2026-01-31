import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  AWS_REGION: z.string().default("us-east-1"),
});

const env = envSchema.parse(process.env);

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
  }),
);

const ce = new CostExplorerClient({
  region: env.AWS_REGION,
});

// Tiny in-memory cache (good enough for dev)
const cache = new Map(); // key -> { expiresAt, value }
const CACHE_TTL_MS = 60_000;
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

const costsQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["DAILY", "MONTHLY"]).default("DAILY"),
  groupBy: z.enum(["SERVICE", "NONE"]).default("SERVICE"),
});

function isoDate(d) {
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/costs", async (req, res) => {
  const parsed = costsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  const q = parsed.data;

  // Default: last 30 days (end is exclusive for Cost Explorer)
  const now = new Date();
  const end = q.end ?? isoDate(now);
  const start =
    q.start ??
    isoDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

  const cacheKey = JSON.stringify({ start, end, granularity: q.granularity, groupBy: q.groupBy });
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const groupBy =
      q.groupBy === "SERVICE"
        ? [
          {
            Type: "DIMENSION",
            Key: "SERVICE",
          },
        ]
        : undefined;

    const cmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: q.granularity,
      Metrics: [
        "UnblendedCost",
        "AmortizedCost",
        "BlendedCost",
        "UsageQuantity",
        "NetUnblendedCost",
        "NetAmortizedCost"
      ],
      GroupBy: groupBy,
      Filter: {
        Not: {
          Dimensions: {
            Key: "RECORD_TYPE",
            Values: ["Credit", "Refund"]
          }
        }
      },
    });

    // Parallel request: Fetch breakdown by RECORD_TYPE (Credits, Tax, Usage, etc.)
    const summaryCmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: "MONTHLY", // Monthly is enough for summary
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "RECORD_TYPE" }],
    });

    const [out, summaryOut] = await Promise.all([
      ce.send(cmd),
      ce.send(summaryCmd)
    ]);

    // Debug: Log the first result to server console to see what we are getting
    if (out.ResultsByTime?.[0]) {
      console.log("Debug - First Result Row:", JSON.stringify(out.ResultsByTime[0], null, 2));
    }

    const results = (out.ResultsByTime ?? []).map((r) => {
      const getMetric = (m, key) => {
        const obj = m?.[key];
        return { amount: Number(obj?.Amount ?? 0), unit: obj?.Unit ?? "USD" };
      };

      const total = r.Total;
      const groups = (r.Groups ?? []).map((g) => ({
        keys: g.Keys ?? [],
        metrics: {
          unblended: getMetric(g.Metrics, "UnblendedCost"),
          amortized: getMetric(g.Metrics, "AmortizedCost"),
          blended: getMetric(g.Metrics, "BlendedCost"),
          usage: getMetric(g.Metrics, "UsageQuantity"),
          netUnblended: getMetric(g.Metrics, "NetUnblendedCost"),
          netAmortized: getMetric(g.Metrics, "NetAmortizedCost"),
        }
      }));

      return {
        start: r.TimePeriod?.Start,
        end: r.TimePeriod?.End,
        total: {
          unblended: getMetric(total, "UnblendedCost"),
          amortized: getMetric(total, "AmortizedCost"),
          blended: getMetric(total, "BlendedCost"),
          usage: getMetric(total, "UsageQuantity"),
          netUnblended: getMetric(total, "NetUnblendedCost"),
          netAmortized: getMetric(total, "NetAmortizedCost"),
        },
        groups,
      };
    });

    // Process summary
    const summary = {
      usage: 0,
      credit: 0,
      tax: 0,
      refund: 0,
      other: 0,
      total: 0
    };

    (summaryOut.ResultsByTime ?? []).forEach(r => {
      (r.Groups ?? []).forEach(g => {
        const type = g.Keys?.[0]; // e.g. "Usage", "Credit", "Tax"
        const amount = parseFloat(g.Metrics?.UnblendedCost?.Amount || "0");

        summary.total += amount;

        if (type === "Credit") summary.credit += amount;
        else if (type === "Tax") summary.tax += amount;
        else if (type === "Refund") summary.refund += amount;
        else if (type === "Usage") summary.usage += amount;
        else summary.other += amount;
      });
    });

    const payload = {
      start,
      end,
      granularity: q.granularity,
      groupBy: q.groupBy,
      results,
      summary, // Send summary back to frontend
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    // Common issues: Cost Explorer not enabled; missing IAM permission; invalid time period
    const msg = err?.name ? `${err.name}: ${err.message ?? ""}` : "Unknown error";
    res.status(500).json({
      error: "Failed to fetch costs from AWS Cost Explorer",
      message: msg,
    });
  }
});

app.get("/api/credits", async (_req, res) => {
  try {
    const end = isoDate(new Date());
    const start = isoDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)); // Last 12 months

    const cmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      Filter: {
        Dimensions: {
          Key: "RECORD_TYPE",
          Values: ["Credit"]
        }
      },
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }]
    });

    const out = await ce.send(cmd);

    let totalUsed = 0;
    const serviceMap = new Map();

    (out.ResultsByTime ?? []).forEach(r => {
      (r.Groups ?? []).forEach(g => {
        const service = g.Keys?.[0] || "Unknown";
        const amount = parseFloat(g.Metrics?.UnblendedCost?.Amount || "0");
        totalUsed += amount;
        serviceMap.set(service, (serviceMap.get(service) || 0) + amount);
      });
    });

    const by_service = [...serviceMap.entries()]
      .map(([service, amount]) => ({ service, amount: Math.abs(amount) }))
      .sort((a, b) => b.amount - a.amount);

    res.json({
      total_used: Math.abs(totalUsed),
      by_service
    });
  } catch (err) {
    console.error("Credits API Error", err);
    res.json({ total_used: 0, by_service: [] }); // Fallback
  }
});

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
});

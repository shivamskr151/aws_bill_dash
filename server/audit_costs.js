import 'dotenv/config';
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const config = {
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
};

const ce = new CostExplorerClient(config);
const sts = new STSClient(config);

async function audit() {
    console.log("=== AWS BILLING AUDIT ===");

    // 1. Check Identity
    try {
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        console.log(`Identity: ${identity.Arn}`);
        console.log(`Account:  ${identity.Account}`);
    } catch (e) {
        console.error("CRITICAL: Authentication failed.", e.message);
        return;
    }

    // 2. Check Costs for specific ranges
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const endOfToday = new Date().toISOString().slice(0, 10);

    // Go back 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const startPast = threeMonthsAgo.toISOString().slice(0, 10);

    console.log(`\nChecking costs from ${startPast} to ${endOfToday}...`);

    const cmd = new GetCostAndUsageCommand({
        TimePeriod: { Start: startPast, End: endOfToday },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost", "AmortizedCost", "UsageQuantity"],
        GroupBy: [
            { Type: "DIMENSION", Key: "SERVICE" },
            { Type: "DIMENSION", Key: "REGION" }
        ]
    });

    try {
        const data = await ce.send(cmd);

        let totalFound = 0;

        data.ResultsByTime.forEach(period => {
            console.log(`\nPeriod: ${period.TimePeriod.Start} -> ${period.TimePeriod.End}`);
            let periodTotal = 0;

            period.Groups.forEach(g => {
                const cost = parseFloat(g.Metrics.UnblendedCost.Amount);
                const usage = parseFloat(g.Metrics.UsageQuantity.Amount);

                if (cost > 0.000001 || usage > 1.0) {
                    const keys = g.Keys.join(" - ");
                    console.log(`  - ${keys}: $${cost.toFixed(6)} (Usage: ${usage.toFixed(2)})`);
                    periodTotal += cost;
                }
            });

            console.log(`  > Period Total: $${periodTotal.toFixed(6)}`);
            totalFound += periodTotal;
        });

        console.log(`\n=== GRAND TOTAL FOUND: $${totalFound.toFixed(6)} ===`);

        if (totalFound < 0.01) {
            console.log("\nPossible reasons for $0 cost:");
            console.log("1. Free Tier usage (Usage > 0 but Cost = 0).");
            console.log("2. New resources created < 24 hours ago (Cost Explorer delay).");
            console.log("3. Credits covering the bill (check NetUnblendedCost).");
            console.log("4. Wrong AWS Account (Compare Account ID above with your AWS Console).");
        }

    } catch (e) {
        console.error("Cost Explorer Error:", e.name, e.message);
    }
}

audit();

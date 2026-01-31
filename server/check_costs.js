import 'dotenv/config';
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";

const client = new CostExplorerClient({
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

async function findTheMoney() {
    // Check last 6 months, monthly
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    start.setDate(1); // First day of 6 months ago

    const cmd = new GetCostAndUsageCommand({
        TimePeriod: {
            Start: start.toISOString().slice(0, 10),
            End: end.toISOString().slice(0, 10)
        },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost", "AmortizedCost", "BlendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }]
    });

    try {
        const data = await client.send(cmd);
        console.log("--- Monthly Summary ---");
        data.ResultsByTime.forEach(r => {
            const uCost = parseFloat(r.Total?.UnblendedCost?.Amount || 0);
            console.log(`Period: ${r.TimePeriod.Start} => ${r.TimePeriod.End} | Unblended: $${uCost.toFixed(2)}`);

            if (uCost > 1.0) {
                // If we found money, list top services
                const services = r.Groups.map(g => ({
                    service: g.Keys[0],
                    amount: parseFloat(g.Metrics.UnblendedCost.Amount)
                })).sort((a, b) => b.amount - a.amount).slice(0, 3);
                console.log("   Top Spenders:", services);
            }
        });
    } catch (e) {
        console.error("Error:", e);
    }
}

findTheMoney();

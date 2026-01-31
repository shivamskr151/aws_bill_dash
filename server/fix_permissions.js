import 'dotenv/config';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, AttachUserPolicyCommand } from "@aws-sdk/client-iam";

const env = process.env;

async function main() {
    console.log("Starting permission fix...");

    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
        console.error("Missing AWS credentials in environment.");
        return;
    }

    const config = {
        region: env.AWS_REGION || "us-east-1",
        credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        }
    };

    const sts = new STSClient(config);
    const iam = new IAMClient(config);

    try {
        // 1. Get Identity
        console.log("Checking identity...");
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        console.log("Identity ARN:", identity.Arn);

        if (!identity.Arn.includes(":user/")) {
            console.log("This identity does not appear to be an IAM User. It might be a Role or Root.");
            if (identity.Arn.includes(":root")) {
                console.log("You are using the Root account. You should have permissions automatically, but you need to enable IAM Access to Billing in Account Settings.");
                return;
            }
            return; // Can't attach user policy to a role easily with this script logic
        }

        // Extract username: arn:aws:iam::ACCOUNT:user/USERNAME
        const username = identity.Arn.split(":user/")[1];
        console.log("Identified IAM User:", username);

        // 2. Attach Policy
        const policyArn = "arn:aws:iam::aws:policy/job-function/Billing";
        console.log(`Attempting to attach policy: ${policyArn} to user ${username}...`);

        await iam.send(new AttachUserPolicyCommand({
            UserName: username,
            PolicyArn: policyArn
        }));

        console.log("✅ SUCCESS: Billing policy attached! The dashboard should work now.");

    } catch (err) {
        console.error("\n❌ FAILED to fix permissions via script.");
        console.error("Error:", err.name, err.message);

        if (err.name === 'AccessDenied' || err.message.includes('not authorized')) {
            console.log("\nREASON: The current credentials do not have permission to attach policies (IAM).");
        }
    }
}

main();

# AWS Billing Dashboard ☁️💰

A modern, full-stack dashboard to visualize your AWS costs and usage in real-time. Built with **React (Vite)** and **Node.js (Express)** using the official **AWS Cost Explorer API**.

![Dashboard Preview](https://via.placeholder.com/800x400?text=AWS+Billing+Dashboard+Preview)

## 🚀 Features

- **Real-Time Cost Visualization**: View your AWS spending with daily or monthly granularity.
- **Detailed Metrics**: Toggle between **Unblended Cost**, **Amortized Cost**, **Net Bill**, and **Usage Quantity**.
- **Bills & Credits Breakdown**: See exactly how much you owe vs. how much was covered by AWS Credits or Free Tier.
- **Top Services**: Identify your most expensive services at a glance.
- **Smart Date Presets**: Quickly jump to Yesterday, Last 7 Days, This Month, or Last Month.
- **High Precision**: Supports up to 6 decimal places for accurate tracking of micro-costs (perfect for Free Tier auditing).

## 🛠️ Tech Stack

- **Frontend**: React, Vite, Recharts (for analytics).
- **Backend**: Node.js, Express, AWS SDK v3 (Cost Explorer Client).

## ⚙️ Setup & Installation

### 1. Prerequisites
- Node.js (v18+)
- An AWS Account with an IAM User having `ce:GetCostAndUsage` permissions.

### 2. Backend Setup
Navigate to the server directory and install dependencies:

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory with your AWS credentials:

```env
PORT=8787
CORS_ORIGIN=http://localhost:5173
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

### 3. Frontend Setup
Navigate to the web directory and install dependencies:

```bash
cd web
npm install
```

## 🏃‍♂️ Running the Project

You need to run both the backend and frontend terminals.

**Terminal 1 (Backend):**
```bash
cd server
npm run dev
```
*Server runs on http://localhost:8787*

**Terminal 2 (Frontend):**
```bash
cd web
npm run dev
```
*Frontend runs on http://localhost:5173*

## 🔑 AWS Permissions Guide

If you see access errors, ensure your IAM User policies include:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ce:GetCostAndUsage"
            ],
            "Resource": "*"
        }
    ]
}
```

## 📝 License

This project is licensed under the ISC License.

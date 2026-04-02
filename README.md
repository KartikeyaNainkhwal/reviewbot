<div align="center">
  <h1>🤖 AXD Review Bot</h1>
  <p><b>An intelligent, automated AI-powered Code Reviewer for GitHub Pull Requests.</b></p>

  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
  [![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
  [![GitHub Apps](https://img.shields.io/badge/GitHub_Apps-181717?style=for-the-badge&logo=github&logoColor=white)](https://docs.github.com/en/apps)
</div>

---

## 📖 About The Project

**AXD** is an enterprise-grade GitHub App that acts as an automated Senior Developer. It watches your repositories and automatically reviews new Pull Requests using powerful Large Language Models (LLMs) like xAI Grok and Groq. 

Instead of waiting hours for a human to review code, AXD instantly parses the `git diff`, analyzes the new code for bugs, logic flaws, and security vulnerabilities, and seamlessly publishes in-line PR comments natively on GitHub.

### ✨ Key Features
* 🧠 **AI-Powered Analysis:** Identifies complex bugs, SQL injections, performance bottlenecks, and logic errors before they hit production.
* ⚡ **Diff-Based Reviews:** Smartly targets only newly modified lines of code, saving token costs and reducing review noise.
* 🔄 **Asynchronous Job Queue:** Handles high-volume PR events reliably using BullMQ and Redis.
* 🛡️ **Intelligent Deduplication:** Automatically ignores duplicate commits so you don't get spammed by re-triggered webhooks.
* 📊 **Usage Tracking:** Built-in PostgreSQL integration via Prisma to track token usage, processed files, and review histories per installation.

---

## 🏗️ Architecture Workflow

1. **Webhook Trigger:** A developer opens or syncs a Pull Request on GitHub.
2. **Payload Delivery:** GitHub sends a webhook payload (via a proxy like Smee.io for local development).
3. **Queue Ingestion:** The Express.js backend authenticates the payload and enqueues a job into Redis using BullMQ.
4. **LLM Processing:** A background worker fetches the PR diff from GitHub, chunks the code, and passes it to the AI for analysis.
5. **Nataive Feedback:** The worker formats the AI result into Markdown and posts a formal Review via the GitHub REST API.

---

## 🛠️ Technology Stack
* **Language:** TypeScript
* **Backend:** Node.js (v22), Express.js
* **Database & ORM:** PostgreSQL, Prisma
* **Job Queue:** Redis, BullMQ
* **API Integration:** Octokit (`@octokit/webhooks`, `@octokit/rest`)
* **Testing:** Jest
* **Containerization:** Docker & Docker Compose

---

## 🚀 Getting Started

Follow these instructions to set up AXD on your local machine for development and testing.

### Prerequisites
* [Node.js](https://nodejs.org/en/) (v18+)
* [Docker](https://www.docker.com/) (For running Postgres and Redis)
* A [GitHub App](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app) configured on your account.
* A free [Smee.io](https://smee.io/) channel for webhook forwarding.

### 1. Clone the repository
```bash
git clone https://github.com/KartikeyaNainkhwal/reviewbot.git
cd reviewbot
```

### 2. Install Dependencies
```bash
npm install --legacy-peer-deps
```

### 3. Spin up the Database & Redis
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### 4. Setup Environment Variables
Create a `.env` file in the root directory:
```env
# Server
PORT=3000
NODE_ENV=development

# Database & Queue
DATABASE_URL="postgresql://axd:axd_pass@localhost:5432/axd?schema=public&connection_limit=10"
REDIS_URL="redis://localhost:6379"

# GitHub App Credentials
GITHUB_APP_ID="your_app_id"
GITHUB_WEBHOOK_SECRET="your_webhook_secret"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# LLM Providers (Choose one)
XAI_API_KEY="your_api_key_here"
```

### 5. Generate Prisma Client & Migrate
```bash
npx prisma generate
npx prisma db push
```

### 6. Start the Webhook Proxy
In a separate terminal window, start forwarding GitHub webhooks to your local environment:
```bash
npx smee-client -U https://smee.io/YOUR_URL -t http://localhost:3000/api/webhooks
```

### 7. Run the Application
Start the development server and background worker:
```bash
npm run dev
```

---

## 🧪 Testing the Bot

To test if the bot works, simply create a new branch, add a deliberate bug (like a SQL injection or infinite loop), and open a Pull Request. 

If your environment is configured correctly, the AXD bot will instantly process the diff and drop a review on your PR within 5 seconds!

---

## 🪪 License

Distributed under the MIT License. See `LICENSE` for more information.

<div align="center">
  <i>Built with ❤️ by Kartikeya Nainkhwal</i>
</div>

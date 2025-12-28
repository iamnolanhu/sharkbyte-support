<h1 align="center">SharkByte Support</h1>

<p align="center">
  <img src="./public/sammy/transparent/sammy-animated-transparent.gif" alt="Sammy the Shark" width="200" />
</p>

<p align="center">
  <a href="https://devpost.com/software/sharkbyte-support">
    <img src="https://img.shields.io/badge/%F0%9F%8F%86_3rd_Place-MLH_x_DigitalOcean_Hackathon-0080FF?style=for-the-badge" alt="3rd Place - MLH x DigitalOcean Hackathon" />
  </a>
</p>

<p align="center">
  <strong>Smart support in every byte.</strong><br/>
  Transform any website into an AI-powered customer support agent in seconds.
</p>

---

## What is SharkByte?

SharkByte instantly creates an AI chatbot that can answer questions about any website. Just paste a URL, and we handle the rest - no FAQ writing, no training, no complex setup.

**How it works:**
1. Enter a website URL
2. We crawl and analyze the content
3. Your AI support agent is ready to chat

---

## Features

- **Instant Setup** - No configuration required
- **Website-Aware** - Answers based on actual site content
- **Streaming Responses** - Real-time chat experience
- **Theme Options** - Light, Dark, and Ocean modes
- **Mobile Friendly** - Works on all devices

---

## Screenshots

<p align="center">
  <img src="./public/images/SharkByte-Homepage.png" alt="SharkByte Homepage" width="600" />
</p>
<p align="center"><em>Homepage - Enter any URL to create an AI support agent</em></p>

<p align="center">
  <img src="./public/images/SharkByte-Agent-Config.png" alt="Agent Configuration" width="600" />
</p>
<p align="center"><em>Agent configuration with embed code</em></p>

<p align="center">
  <img src="./public/images/SharkByte-Agent-Chat.png" alt="Chat Interface" width="600" />
</p>
<p align="center"><em>AI chat powered by DigitalOcean Gradient</em></p>

---

## Tech Stack

- **Framework**: Next.js 16.0 (App Router + Turbopack)
- **UI Library**: React 19.2
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **AI**: DigitalOcean Gradient AI
- **Deployment**: Vercel

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- DigitalOcean account with Gradient AI enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/iamnolanhu/sharkbyte-support.git
cd sharkbyte-support

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your DigitalOcean API token

# Run development server
npm run dev
```

### Environment Variables

Create a `.env.local` file:

```env
# Required
DO_API_TOKEN=your_digitalocean_api_token      # https://cloud.digitalocean.com/account/api/tokens

# DigitalOcean Gradient AI
DO_REGION=tor1                                 # Only tor1 supports gen-ai agents
DO_EMBEDDING_MODEL_UUID=bb3ab4ee-d9b5-11f0-b074-4e013e2ddde4  # Qwen3 (default)
DO_LLM_MODEL_UUID=18bc9b8f-73c5-11f0-b074-4e013e2ddde4        # GPT-oss-120b (default)

# Optional (auto-discovered if not set)
DO_PROJECT_ID=your_project_id                 # Auto-creates "SharkByte Support" project if not set
DO_DATABASE_ID=your_database_id               # Reuse existing vector database
DO_MODEL_ACCESS_KEY_ID=your_key_id            # Prevents duplicate key creation
FIRECRAWL_API_KEY=your_firecrawl_api_key      # Fallback for SPAs (https://firecrawl.dev)

# Optional - Demo chat widget on landing page
NEXT_PUBLIC_DEMO_AGENT_ENDPOINT=https://your-demo-agent.agents.do-ai.run
NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY=your_demo_access_key
```

---

## Usage

1. Open [http://localhost:3000](http://localhost:3000)
2. Enter a website URL
3. Wait for the agent to be created
4. Start chatting!

---

## Embed on Your Website

Add the chat widget to any website with a single script tag:

```html
<script
  src="https://sharkbyte-support.vercel.app/widget.js"
  data-agent-id="your-agent-id"
  data-endpoint="https://your-agent.agents.do-ai.run"
  data-access-key="your-access-key"
  data-primary-color="#0080FF"
  data-position="bottom-right"
  async
></script>
```

**Options:**
- `data-primary-color` - Widget accent color (hex)
- `data-position` - `bottom-right` or `bottom-left`
- `data-welcome-message` - Custom greeting message

---

## Deployment

> **Cost Notice:** Running SharkByte requires a DigitalOcean account with Gradient AI enabled. Estimated costs: ~$20/month for the vector database + variable AI usage. [Get $200 in free credits](https://www.digitalocean.com/?refcode=732d9583cca9) to get started.

> **First-Time Setup:** Fresh DO accounts must [create one agent manually](https://cloud.digitalocean.com/gen-ai/agents/new) before API-based creation works.

Deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/iamnolanhu/sharkbyte-support)

Then add `DO_API_TOKEN` to your environment variables.

**See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete deployment guide**, including:
- Step-by-step setup instructions
- Post-deployment optimization (prevent duplicate resources)
- Troubleshooting common issues

Or deploy manually:

```bash
npm run build
vercel deploy --prod
```

---

## Project Structure

```
sharkbyte-support/
├── public/
│   ├── images/       # Screenshots & hackathon photos
│   ├── sammy/        # Sammy mascot assets
│   └── widget.js     # Embeddable chat widget
├── scripts/          # Dev utilities (cleanup, create-agent)
├── src/
│   ├── app/          # Next.js pages & API routes
│   ├── components/   # React components
│   ├── lib/          # DigitalOcean client, config, utils
│   ├── styles/       # Theme system
│   └── types/        # TypeScript interfaces
└── [config files]    # package.json, tsconfig, etc.
```

---

## Team

<p align="center">
  <img src="./public/images/hackathon-3rd-place.webp" alt="The Sharks - 3rd Place" height="220" />
  &nbsp;&nbsp;&nbsp;
  <img src="./public/images/3rd-place-prize.png" alt="3rd Place Prize" height="220" />
</p>

<p align="center"><strong>The Sharks</strong> 🦈 - <strong>3rd Place</strong> at MLH x DigitalOcean Hackathon 2025</p>

<p align="center">
  <a href="https://devpost.com/software/sharkbyte-support">View on Devpost</a> | <a href="https://sharkbyte-support.vercel.app/">Live Demo</a>
</p>

---

## Built With

- [DigitalOcean Gradient AI](https://docs.digitalocean.com/products/gradient-ai-platform/)
- [Next.js](https://nextjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Framer Motion](https://www.framer.com/motion/)
- [Vercel AI SDK](https://sdk.vercel.ai/)

---

## License

**Dual License** - Free for non-commercial and open source use. Commercial use requires a paid license. See [LICENSE](LICENSE) for details.

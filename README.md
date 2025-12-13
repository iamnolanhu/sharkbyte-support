# SharkByte Support

<p align="center">
  <img src="./public/sammy/transparent/sammy-animated-transparent.gif" alt="Sammy the Shark" width="200" />
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

## Tech Stack

- **Framework**: Next.js 16 (App Router + Turbopack)
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
DO_API_TOKEN=your_digitalocean_api_token
DO_REGION=nyc3
DO_EMBEDDING_MODEL=text-embedding-3-small
DO_LLM_MODEL=gpt-4o
```

---

## Usage

1. Open [http://localhost:3000](http://localhost:3000)
2. Enter a website URL
3. Wait for the agent to be created
4. Start chatting!

---

## Deployment

Deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/iamnolanhu/sharkbyte-support)

Or deploy manually:

```bash
npm run build
vercel deploy --prod
```

---

## Project Structure

```
sharkbyte-support/
├── src/
│   ├── app/          # Next.js pages and API routes
│   ├── components/   # React components
│   ├── lib/          # Utilities and API clients
│   └── types/        # TypeScript types
├── public/           # Static assets
└── README.md
```

---

## Team

**The Sharks** - MLH x DigitalOcean Hackathon 2025

---

## Built With

- [DigitalOcean Gradient AI](https://docs.digitalocean.com/products/gradient-ai-platform/)
- [Next.js](https://nextjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Vercel AI SDK](https://sdk.vercel.ai/)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

# SharkByte Support

What the demo Sammy on the SharkByte Support site knows about SharkByte Support itself. The site
is rendered in the browser, so a crawl reads almost nothing; this file fills that gap. Every
`## ` section becomes its own piece of what Sammy knows, so keep each section self-contained.
Public: no keys, ids or internal hostnames.

## What SharkByte Support is

SharkByte Support turns any website into an AI support assistant in about a minute. You paste a website address, SharkByte reads the site's public pages, and you get a chat assistant called Sammy that answers visitors' questions about that site: what it offers, how things work and where to find things. There is no FAQ to write and no training to set up, and it is free to use.

## How to use SharkByte Support

1. Paste the address of a website into the box on the home page and start.
2. SharkByte reads (crawls) the site's public pages. This usually takes a minute or two, and the page shows the progress.
3. When it is ready, you can chat with that site's Sammy right away to see how it answers.
4. To put Sammy on your own site, copy the embed snippet from the agent's page and paste it into your site's HTML.

Sammy only knows what is on the site's public pages, so sites that load their content with JavaScript, or that block crawlers, can give Sammy less to work with. If a crawl fails or the site changed, the owner can hit Repair to read the site again.

## Embedding Sammy on your website

Sammy goes on any website with one script tag, pasted before the closing body tag:

```html
<script
  src="https://sharkbyte-support.vercel.app/widget.js"
  data-agent-id="your-agent-id"
  data-primary-color="#0080FF"
  data-position="bottom-right"
  async
></script>
```

Replace your-agent-id with the id shown on your agent's page (the snippet there is already filled in). Optional settings: data-primary-color sets the accent color as a hex code, data-position is bottom-right or bottom-left, and data-welcome-message sets the greeting. The widget opens as a chat bubble in the corner of the page.

## History and owning an agent

There are no accounts. The browser that creates a Sammy keeps a private owner key for it, saved in that browser. With that key you can edit the agent's instructions, run Repair to read the site again, or delete the agent. Anyone can chat with an agent, but only the browser that made it can change it, so clearing that browser's storage loses the owner key. The History list shows the agents made in this browser along with the public showcase agents. Agents that nobody chats with for 14 days are removed to keep the free demo running, and failed ones are cleared after a day.

## Pricing

SharkByte Support is free. The hosted demo at sharkbyte-support.vercel.app costs nothing to use, within the limits listed under the free demo limits. There are no paid plans, no subscriptions and no sign-up, and it is not a free trial that turns into a paid plan. The code is open source, so anyone can also run their own copy for free.

## Free demo limits

The public demo runs on free services, so it has a few limits:
- Sammy reads up to 30 pages per website.
- Each visitor can create a few sites per hour (3 at the moment), and there is a daily cap on new sites across everyone.
- Chat has a daily usage cap across the whole demo; when it is reached, chat comes back the next day.
- Unused agents are removed after 14 days.

## Privacy

Chats with Sammy on the demo are logged so the demo can be improved, so please don't share passwords or personal details in the chat. Sammy only reads a site's public pages and never logs in anywhere.

## Who built SharkByte Support

SharkByte Support was built by Nolan Hu. It won 3rd place at the MLH × DigitalOcean hackathon in December 2025. Since then it has moved to its own stack of free services, which is why the demo is free to use. The mascot is Sammy the shark.

## Open source

SharkByte Support is open source. The code is on GitHub at github.com/iamnolanhu/sharkbyte-support, and anyone can run their own copy on the same free services; the README explains how.

## Custom or production agents

The demo is for trying SharkByte out. If you want a custom or production support assistant for your business, without the demo limits or tuned to your needs, ask Nolan Hu, who built SharkByte Support. You can reach him through his GitHub profile, github.com/iamnolanhu.

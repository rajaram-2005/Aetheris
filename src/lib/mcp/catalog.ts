/**
 * Cloud MCP connector catalog. `url` entries are remote Streamable-HTTP MCP servers.
 * `auth` describes what the user must supply; the value is sent as a header on every call
 * and only lives in the user's browser + the request.
 */
export type Category = "productivity" | "dev" | "payments" | "communication" | "design" | "data" | "web" | "crm" | "social" | "storage";

export interface Connector {
  id: string;
  name: string;
  category: Category;
  description: string;
  url: string;
  /** Header used to pass the user's credential; omit for public/no-auth servers. */
  auth?: { header: string; prefix?: string; label: string; help?: string };
  premium?: boolean;
  featured?: boolean;
}

export const CONNECTORS: Connector[] = [
  // ---- Featured -----------------------------------------------------------------------
  { id: "notion", name: "Notion", category: "productivity", featured: true, url: "https://mcp.notion.com/mcp",
    description: "Read and write pages, databases and comments in your Notion workspace.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Notion integration token", help: "notion.so/my-integrations" } },
  { id: "github", name: "GitHub", category: "dev", featured: true, url: "https://api.githubcopilot.com/mcp/",
    description: "Issues, pull requests, code search, Actions — across your repositories.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "GitHub PAT" } },
  { id: "slack", name: "Slack", category: "communication", featured: true, url: "https://mcp.slack.com/mcp",
    description: "Read channel history, search messages and post as your bot.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Slack bot token (xoxb-…)" } },
  { id: "figma", name: "Figma", category: "design", featured: true, url: "https://mcp.figma.com/mcp",
    description: "Inspect frames and components; generate React code from designs.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Figma personal access token" } },
  { id: "stripe", name: "Stripe", category: "payments", featured: true, url: "https://mcp.stripe.com",
    description: "Customers, payments, subscriptions and balance analytics.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Stripe restricted key (rk_…)" } },
  { id: "razorpay", name: "Razorpay", category: "payments", featured: true, url: "https://mcp.razorpay.com/mcp",
    description: "Payment links, orders, settlements and refund status.",
    auth: { header: "Authorization", prefix: "Basic ", label: "base64(key_id:key_secret)" } },
  { id: "vercel", name: "Vercel", category: "dev", featured: true, url: "https://mcp.vercel.com",
    description: "Trigger deployments, inspect logs and manage projects.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Vercel token" } },
  { id: "google-workspace", name: "Google Workspace", category: "productivity", featured: true, url: "https://workspace-mcp.example.com/mcp",
    description: "Gmail drafts, Calendar events, Docs and Sheets via Google Cloud APIs.",
    auth: { header: "Authorization", prefix: "Bearer ", label: "Google OAuth access token" }, premium: true },
  { id: "discord", name: "Discord", category: "communication", url: "https://discord-mcp.example.com/mcp",
    description: "Read channels and send automated messages via a bot.",
    auth: { header: "Authorization", prefix: "Bot ", label: "Discord bot token" } },

  // ---- Public / no-auth ----------------------------------------------------------------
  { id: "deepwiki", name: "DeepWiki", category: "web", url: "https://mcp.deepwiki.com/mcp",
    description: "Ask questions about any public GitHub repository's documentation." },
  { id: "context7", name: "Context7", category: "dev", url: "https://mcp.context7.com/mcp",
    description: "Up-to-date library and framework documentation for coding." },
  { id: "fetch", name: "Web Fetch", category: "web", url: "https://remote.mcpservers.org/fetch/mcp",
    description: "Fetch and read any public web page as markdown." },
  { id: "sequential-thinking", name: "Sequential Thinking", category: "data", url: "https://remote.mcpservers.org/sequentialthinking/mcp",
    description: "Structured step-by-step reasoning scratchpad." },
  { id: "edgeone-pages", name: "EdgeOne Pages", category: "dev", url: "https://mcp-on-edge.edgeone.site/mcp-server",
    description: "Deploy HTML to a public URL instantly." },

  // ---- Dev & data ---------------------------------------------------------------------
  { id: "sentry", name: "Sentry", category: "dev", url: "https://mcp.sentry.dev/mcp", description: "Issues, errors and performance data.", auth: { header: "Authorization", prefix: "Bearer ", label: "Sentry auth token" } },
  { id: "linear", name: "Linear", category: "productivity", url: "https://mcp.linear.app/mcp", description: "Issues, projects and cycles.", auth: { header: "Authorization", prefix: "Bearer ", label: "Linear API key" } },
  { id: "atlassian", name: "Jira & Confluence", category: "productivity", url: "https://mcp.atlassian.com/v1/mcp", description: "Jira issues and Confluence pages.", auth: { header: "Authorization", prefix: "Bearer ", label: "Atlassian access token" } },
  { id: "asana", name: "Asana", category: "productivity", url: "https://mcp.asana.com/mcp", description: "Tasks, projects and goals.", auth: { header: "Authorization", prefix: "Bearer ", label: "Asana PAT" } },
  { id: "cloudflare", name: "Cloudflare", category: "dev", url: "https://bindings.mcp.cloudflare.com/mcp", description: "Workers, KV, R2, D1 and DNS.", auth: { header: "Authorization", prefix: "Bearer ", label: "Cloudflare API token" } },
  { id: "supabase", name: "Supabase", category: "data", url: "https://mcp.supabase.com/mcp", description: "Query tables, run SQL, manage projects.", auth: { header: "Authorization", prefix: "Bearer ", label: "Supabase PAT" } },
  { id: "neon", name: "Neon Postgres", category: "data", url: "https://mcp.neon.tech/mcp", description: "Serverless Postgres branches and SQL.", auth: { header: "Authorization", prefix: "Bearer ", label: "Neon API key" } },
  { id: "mongodb", name: "MongoDB Atlas", category: "data", url: "https://mcp.mongodb.com/mcp", description: "Clusters, collections and aggregation.", auth: { header: "Authorization", prefix: "Bearer ", label: "Atlas API key" } },
  { id: "airtable", name: "Airtable", category: "data", url: "https://mcp.airtable.com/mcp", description: "Bases, tables and records.", auth: { header: "Authorization", prefix: "Bearer ", label: "Airtable PAT" } },
  { id: "postman", name: "Postman", category: "dev", url: "https://mcp.postman.com/mcp", description: "Collections, environments and API tests.", auth: { header: "Authorization", prefix: "Bearer ", label: "Postman API key" } },
  { id: "huggingface", name: "Hugging Face", category: "dev", url: "https://huggingface.co/mcp", description: "Search models, datasets, Spaces and papers.", auth: { header: "Authorization", prefix: "Bearer ", label: "HF token" } },
  { id: "netlify", name: "Netlify", category: "dev", url: "https://netlify-mcp.netlify.app/mcp", description: "Sites, deploys and env vars.", auth: { header: "Authorization", prefix: "Bearer ", label: "Netlify PAT" } },
  { id: "render", name: "Render", category: "dev", url: "https://mcp.render.com/mcp", description: "Services, deploys and logs.", auth: { header: "Authorization", prefix: "Bearer ", label: "Render API key" } },
  { id: "docker-hub", name: "Docker Hub", category: "dev", url: "https://mcp.docker.com/mcp", description: "Images, tags and repositories.", auth: { header: "Authorization", prefix: "Bearer ", label: "Docker PAT" } },
  { id: "grafana", name: "Grafana", category: "data", url: "https://grafana-mcp.example.com/mcp", description: "Dashboards, alerts and Loki queries.", auth: { header: "Authorization", prefix: "Bearer ", label: "Grafana service account token" } },

  // ---- Payments / commerce ----------------------------------------------------------
  { id: "paypal", name: "PayPal", category: "payments", url: "https://mcp.paypal.com/mcp", description: "Invoices, orders and disputes.", auth: { header: "Authorization", prefix: "Bearer ", label: "PayPal access token" } },
  { id: "square", name: "Square", category: "payments", url: "https://mcp.squareup.com/mcp", description: "Payments, catalog and customers.", auth: { header: "Authorization", prefix: "Bearer ", label: "Square access token" } },
  { id: "shopify", name: "Shopify", category: "payments", url: "https://shopify-mcp.example.com/mcp", description: "Products, orders and inventory.", auth: { header: "X-Shopify-Access-Token", label: "Admin API token" } },
  { id: "plaid", name: "Plaid", category: "payments", url: "https://api.dashboard.plaid.com/mcp/sse", description: "Bank accounts and transactions.", auth: { header: "Authorization", prefix: "Bearer ", label: "Plaid token" }, premium: true },

  // ---- CRM / ERP ------------------------------------------------------------------------
  { id: "hubspot", name: "HubSpot", category: "crm", url: "https://mcp.hubspot.com/mcp", description: "Contacts, deals and companies.", auth: { header: "Authorization", prefix: "Bearer ", label: "HubSpot PAT" } },
  { id: "salesforce", name: "Salesforce", category: "crm", url: "https://salesforce-mcp.example.com/mcp", description: "Leads, opportunities and SOQL.", auth: { header: "Authorization", prefix: "Bearer ", label: "Salesforce access token" }, premium: true },
  { id: "zoho-crm", name: "Zoho CRM", category: "crm", url: "https://zoho-mcp.example.com/mcp", description: "Leads, contacts and deals.", auth: { header: "Authorization", prefix: "Zoho-oauthtoken ", label: "Zoho OAuth token" } },
  { id: "pipedrive", name: "Pipedrive", category: "crm", url: "https://pipedrive-mcp.example.com/mcp", description: "Deals pipeline and activities.", auth: { header: "x-api-token", label: "Pipedrive API token" } },
  { id: "intercom", name: "Intercom", category: "crm", url: "https://mcp.intercom.com/mcp", description: "Conversations, contacts and articles.", auth: { header: "Authorization", prefix: "Bearer ", label: "Intercom access token" } },
  { id: "zendesk", name: "Zendesk", category: "crm", url: "https://zendesk-mcp.example.com/mcp", description: "Tickets and help center.", auth: { header: "Authorization", prefix: "Bearer ", label: "Zendesk API token" } },
  { id: "odoo", name: "Odoo ERP", category: "crm", url: "https://odoo-mcp.example.com/mcp", description: "Inventory, invoicing and sales orders.", auth: { header: "Authorization", prefix: "Bearer ", label: "Odoo API key" }, premium: true },
  { id: "sap", name: "SAP S/4HANA", category: "crm", url: "https://sap-mcp.example.com/mcp", description: "OData business objects.", auth: { header: "Authorization", prefix: "Bearer ", label: "SAP OAuth token" }, premium: true },

  // ---- Communication --------------------------------------------------------------------
  { id: "twilio", name: "Twilio", category: "communication", url: "https://twilio-mcp.example.com/mcp", description: "SMS, WhatsApp and voice.", auth: { header: "Authorization", prefix: "Basic ", label: "base64(SID:token)" } },
  { id: "whatsapp-business", name: "WhatsApp Business", category: "communication", url: "https://whatsapp-mcp.example.com/mcp", description: "Send template messages and read replies.", auth: { header: "Authorization", prefix: "Bearer ", label: "Meta access token" }, premium: true },
  { id: "telegram", name: "Telegram Bot", category: "communication", url: "https://telegram-mcp.example.com/mcp", description: "Send and read bot messages.", auth: { header: "X-Bot-Token", label: "Bot token" } },
  { id: "resend", name: "Resend", category: "communication", url: "https://mcp.resend.com/mcp", description: "Send transactional email.", auth: { header: "Authorization", prefix: "Bearer ", label: "Resend API key" } },
  { id: "sendgrid", name: "SendGrid", category: "communication", url: "https://sendgrid-mcp.example.com/mcp", description: "Email campaigns and stats.", auth: { header: "Authorization", prefix: "Bearer ", label: "SendGrid API key" } },
  { id: "zoom", name: "Zoom", category: "communication", url: "https://mcp.zoom.us/mcp", description: "Meetings, recordings and transcripts.", auth: { header: "Authorization", prefix: "Bearer ", label: "Zoom access token" } },
  { id: "ms-teams", name: "Microsoft Teams", category: "communication", url: "https://teams-mcp.example.com/mcp", description: "Channels and chats via Graph.", auth: { header: "Authorization", prefix: "Bearer ", label: "Graph access token" } },

  // ---- Social -----------------------------------------------------------------------------
  { id: "x-twitter", name: "X (Twitter)", category: "social", url: "https://x-mcp.example.com/mcp", description: "Post, search and read timelines.", auth: { header: "Authorization", prefix: "Bearer ", label: "X bearer token" } },
  { id: "linkedin", name: "LinkedIn", category: "social", url: "https://linkedin-mcp.example.com/mcp", description: "Share posts and read analytics.", auth: { header: "Authorization", prefix: "Bearer ", label: "LinkedIn access token" } },
  { id: "youtube", name: "YouTube", category: "social", url: "https://youtube-mcp.example.com/mcp", description: "Search videos, read transcripts and stats.", auth: { header: "X-Api-Key", label: "YouTube Data API key" } },
  { id: "reddit", name: "Reddit", category: "social", url: "https://reddit-mcp.example.com/mcp", description: "Browse subreddits and posts.", auth: { header: "Authorization", prefix: "Bearer ", label: "Reddit OAuth token" } },
  { id: "instagram", name: "Instagram", category: "social", url: "https://instagram-mcp.example.com/mcp", description: "Publish media and read insights.", auth: { header: "Authorization", prefix: "Bearer ", label: "Meta access token" } },
  { id: "bluesky", name: "Bluesky", category: "social", url: "https://bluesky-mcp.example.com/mcp", description: "Post and read the firehose.", auth: { header: "Authorization", prefix: "Bearer ", label: "App password token" } },

  // ---- Web scraping / search --------------------------------------------------------------
  { id: "firecrawl", name: "Firecrawl", category: "web", url: "https://mcp.firecrawl.dev/mcp", description: "Scrape and crawl sites into clean markdown.", auth: { header: "Authorization", prefix: "Bearer ", label: "Firecrawl API key" } },
  { id: "exa", name: "Exa Search", category: "web", url: "https://mcp.exa.ai/mcp", description: "Neural web search with full content.", auth: { header: "x-api-key", label: "Exa API key" } },
  { id: "tavily", name: "Tavily", category: "web", url: "https://mcp.tavily.com/mcp", description: "Search API built for LLM agents.", auth: { header: "Authorization", prefix: "Bearer ", label: "Tavily API key" } },
  { id: "brave-search", name: "Brave Search", category: "web", url: "https://brave-mcp.example.com/mcp", description: "Web, news and image search.", auth: { header: "X-Subscription-Token", label: "Brave API key" } },
  { id: "apify", name: "Apify", category: "web", url: "https://mcp.apify.com", description: "Run 4,000+ scrapers (Actors).", auth: { header: "Authorization", prefix: "Bearer ", label: "Apify token" } },
  { id: "browserbase", name: "Browserbase", category: "web", url: "https://browserbase-mcp.example.com/mcp", description: "Headless browser sessions in the cloud.", auth: { header: "x-bb-api-key", label: "Browserbase API key" } },
  { id: "serpapi", name: "SerpApi", category: "web", url: "https://serpapi-mcp.example.com/mcp", description: "Google/Bing SERP results.", auth: { header: "X-Api-Key", label: "SerpApi key" } },
  { id: "wikipedia", name: "Wikipedia", category: "web", url: "https://wikipedia-mcp.example.com/mcp", description: "Search and read articles." },
  { id: "arxiv", name: "arXiv", category: "web", url: "https://arxiv-mcp.example.com/mcp", description: "Search and summarise papers." },
  { id: "hackernews", name: "Hacker News", category: "web", url: "https://hn-mcp.example.com/mcp", description: "Top stories and comments." },

  // ---- Storage ----------------------------------------------------------------------------
  { id: "google-drive", name: "Google Drive", category: "storage", url: "https://gdrive-mcp.example.com/mcp", description: "Search and read files.", auth: { header: "Authorization", prefix: "Bearer ", label: "Google OAuth access token" } },
  { id: "dropbox", name: "Dropbox", category: "storage", url: "https://dropbox-mcp.example.com/mcp", description: "Files and shared links.", auth: { header: "Authorization", prefix: "Bearer ", label: "Dropbox token" } },
  { id: "onedrive", name: "OneDrive", category: "storage", url: "https://onedrive-mcp.example.com/mcp", description: "Files via Microsoft Graph.", auth: { header: "Authorization", prefix: "Bearer ", label: "Graph access token" } },
  { id: "box", name: "Box", category: "storage", url: "https://mcp.box.com/mcp", description: "Enterprise content and metadata.", auth: { header: "Authorization", prefix: "Bearer ", label: "Box developer token" } },
  { id: "aws-s3", name: "AWS S3", category: "storage", url: "https://s3-mcp.example.com/mcp", description: "Buckets and objects.", auth: { header: "Authorization", prefix: "Bearer ", label: "Pre-signed token" }, premium: true },
  { id: "cloudinary", name: "Cloudinary", category: "storage", url: "https://asset-management.mcp.cloudinary.com/mcp", description: "Upload and transform media.", auth: { header: "Authorization", prefix: "Basic ", label: "base64(key:secret)" } },

  // ---- Productivity extras -----------------------------------------------------------------
  { id: "todoist", name: "Todoist", category: "productivity", url: "https://ai.todoist.net/mcp", description: "Tasks and projects.", auth: { header: "Authorization", prefix: "Bearer ", label: "Todoist API token" } },
  { id: "trello", name: "Trello", category: "productivity", url: "https://trello-mcp.example.com/mcp", description: "Boards, lists and cards.", auth: { header: "Authorization", prefix: "Bearer ", label: "Trello token" } },
  { id: "monday", name: "monday.com", category: "productivity", url: "https://mcp.monday.com/mcp", description: "Boards and items.", auth: { header: "Authorization", prefix: "Bearer ", label: "monday API token" } },
  { id: "clickup", name: "ClickUp", category: "productivity", url: "https://mcp.clickup.com/mcp", description: "Tasks, docs and goals.", auth: { header: "Authorization", prefix: "Bearer ", label: "ClickUp API token" } },
  { id: "calendly", name: "Calendly", category: "productivity", url: "https://calendly-mcp.example.com/mcp", description: "Event types and bookings.", auth: { header: "Authorization", prefix: "Bearer ", label: "Calendly PAT" } },
  { id: "canva", name: "Canva", category: "design", url: "https://mcp.canva.com/mcp", description: "Designs, exports and brand kits.", auth: { header: "Authorization", prefix: "Bearer ", label: "Canva access token" } },
  { id: "miro", name: "Miro", category: "design", url: "https://mcp.miro.com/mcp", description: "Boards, sticky notes and diagrams.", auth: { header: "Authorization", prefix: "Bearer ", label: "Miro access token" } },
  { id: "webflow", name: "Webflow", category: "design", url: "https://mcp.webflow.com/mcp", description: "CMS items and site publishing.", auth: { header: "Authorization", prefix: "Bearer ", label: "Webflow token" } },
  { id: "wordpress", name: "WordPress", category: "design", url: "https://wordpress-mcp.example.com/mcp", description: "Posts, pages and media.", auth: { header: "Authorization", prefix: "Basic ", label: "base64(user:app-password)" } },
  { id: "zapier", name: "Zapier", category: "productivity", url: "https://mcp.zapier.com/api/mcp/mcp", description: "8,000+ apps through Zapier actions.", auth: { header: "Authorization", prefix: "Bearer ", label: "Zapier MCP token" } },
  { id: "make", name: "Make", category: "productivity", url: "https://mcp.make.com/mcp", description: "Run Make scenarios on demand.", auth: { header: "Authorization", prefix: "Token ", label: "Make API token" } },
  { id: "n8n", name: "n8n", category: "productivity", url: "https://n8n-mcp.example.com/mcp", description: "Trigger n8n workflows.", auth: { header: "Authorization", prefix: "Bearer ", label: "n8n MCP token" } },
  { id: "openweather", name: "OpenWeather", category: "data", url: "https://weather-mcp.example.com/mcp", description: "Current weather and forecasts.", auth: { header: "X-Api-Key", label: "OpenWeather key" } },
  { id: "alpha-vantage", name: "Alpha Vantage", category: "data", url: "https://mcp.alphavantage.co/mcp", description: "Stocks, forex and crypto data.", auth: { header: "X-Api-Key", label: "Alpha Vantage key" } },
  { id: "coingecko", name: "CoinGecko", category: "data", url: "https://mcp.api.coingecko.com/mcp", description: "Crypto prices and market data." },
  { id: "google-maps", name: "Google Maps", category: "data", url: "https://maps-mcp.example.com/mcp", description: "Geocoding, places and directions.", auth: { header: "X-Goog-Api-Key", label: "Maps API key" } },
  { id: "bigquery", name: "BigQuery", category: "data", url: "https://bigquery-mcp.example.com/mcp", description: "Run SQL on your datasets.", auth: { header: "Authorization", prefix: "Bearer ", label: "Google OAuth access token" }, premium: true },
  { id: "snowflake", name: "Snowflake", category: "data", url: "https://snowflake-mcp.example.com/mcp", description: "Warehouses and SQL.", auth: { header: "Authorization", prefix: "Bearer ", label: "Snowflake OAuth token" }, premium: true },
  { id: "elastic", name: "Elasticsearch", category: "data", url: "https://elastic-mcp.example.com/mcp", description: "Search indices and aggregations.", auth: { header: "Authorization", prefix: "ApiKey ", label: "Elastic API key" } },
  { id: "pinecone", name: "Pinecone", category: "data", url: "https://mcp.pinecone.io/mcp", description: "Vector search over your indexes.", auth: { header: "Api-Key", label: "Pinecone API key" } },
  { id: "aetheris-factory", name: "Enterprise GitHub Automation", category: "dev", featured: true, url: "internal://factory",
    description: "Drive the Aetheris Coding Factory from chat: build, test and report on GitHub Actions.", premium: true },
];

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "productivity", label: "Productivity" }, { id: "dev", label: "Developer" }, { id: "payments", label: "Payments" },
  { id: "communication", label: "Communication" }, { id: "design", label: "Design" }, { id: "data", label: "Data" },
  { id: "web", label: "Web & Search" }, { id: "crm", label: "CRM & ERP" }, { id: "social", label: "Social" }, { id: "storage", label: "Storage" },
];

export function connectorById(id: string) {
  return CONNECTORS.find((c) => c.id === id);
}

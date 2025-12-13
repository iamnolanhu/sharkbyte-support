#!/bin/bash

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Check for required environment variables
if [ -z "$DIGITALOCEAN_TOKEN" ]; then
  echo "Error: DIGITALOCEAN_TOKEN environment variable is not set"
  exit 1
fi

if [ -z "$DIGITALOCEAN_PROJECT_ID" ]; then
  echo "Error: DIGITALOCEAN_PROJECT_ID environment variable is not set"
  exit 1
fi

if [ -z "$DIGITALOCEAN_DB_ID" ]; then
  echo "Error: DIGITALOCEAN_DB_ID environment variable is not set"
  exit 1
fi

TOKEN="$DIGITALOCEAN_TOKEN"
PROJECT_ID="$DIGITALOCEAN_PROJECT_ID"
DB_ID="$DIGITALOCEAN_DB_ID"

echo "Creating Knowledge Base..."
KB_RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/knowledge_bases" \
  -d '{
    "name": "sharkbyte-demo-kb",
    "embedding_model_uuid": "22653204-79ed-11ef-bf8f-4e013e2ddde4",
    "project_id": "'"$PROJECT_ID"'",
    "region": "tor1",
    "database_id": "'"$DB_ID"'",
    "datasources": [
      {
        "web_crawler_data_source": {
          "base_url": "https://sharkbyte-support.vercel.app",
          "crawling_option": "DOMAIN",
          "embed_media": false,
          "exclude_tags": ["nav", "footer", "header", "aside", "script", "style", "form", "iframe", "noscript"]
        }
      }
    ]
  }')

echo "$KB_RESPONSE" | jq .
KB_ID=$(echo "$KB_RESPONSE" | jq -r '.knowledge_base.uuid')
echo "KB ID: $KB_ID"

if [ "$KB_ID" == "null" ] || [ -z "$KB_ID" ]; then
  echo "Failed to create KB"
  exit 1
fi

echo "Starting indexing job..."
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/indexing_jobs" \
  -d '{"knowledge_base_uuid": "'"$KB_ID"'"}' | jq .

echo "Waiting for indexing... (this may take a few minutes)"
echo "KB_ID=$KB_ID"

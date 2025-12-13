#!/bin/bash

source .env

curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DO_API_TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/agents/900f561e-d820-11f0-b074-4e013e2ddde4" \
  -d '{
    "name": "sharkbyte-support",
    "instruction": "You are Sammy, a friendly and knowledgeable customer support agent for the SharkByte Support website. You help visitors understand how SharkByte works - a tool that transforms any website into an AI-powered customer support chatbot. Be helpful, concise, and maintain a playful ocean-themed personality. If you do not know something, be honest about it.",
    "knowledge_base_uuids": ["afeaaa0a-d838-11f0-b074-4e013e2ddde4"],
    "retrieval_method": "RETRIEVAL_METHOD_RAG"
  }'

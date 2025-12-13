import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import type { ChatMessage } from '@/types';

export const runtime = 'edge';

interface ChatRequest {
  messages: ChatMessage[];
  endpoint: string;
  accessKey: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();

    const { messages, endpoint, accessKey } = body;

    if (!messages || !endpoint || !accessKey) {
      return new Response(
        JSON.stringify({ error: 'messages, endpoint, and accessKey are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create OpenAI-compatible client pointing to DO agent endpoint
    const client = new OpenAI({
      baseURL: `${endpoint}/api/v1`,
      apiKey: accessKey,
    });

    // Stream response from agent
    const response = await client.chat.completions.create({
      model: 'n/a',
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      stream: true,
    });

    // Convert to ReadableStream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              // Send as Server-Sent Events format for AI SDK compatibility
              const data = JSON.stringify({
                type: 'text-delta',
                textDelta: content,
              });
              controller.enqueue(encoder.encode(`0:${data}\n`));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Chat failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgent,
  getKnowledgeBaseIds,
  startIndexingJob,
  isKBReady,
  listKnowledgeBases,
} from '@/lib/digitalocean';

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    // Get agent details
    const agentResponse = await getAgent(agentId);
    const agent = agentResponse.agent;

    // Get attached KB IDs
    let kbIds = getKnowledgeBaseIds(agent);

    // If no KBs attached, try to find orphaned KBs by domain
    if (kbIds.length === 0) {
      const domainMatch = agent.name.match(/Sammy - (.+)/);
      if (domainMatch) {
        const domain = domainMatch[1];
        const domainSlug = domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const expectedKBNames = [
          `${domainSlug}-crawl`,
          `${domainSlug}-uploads`,
          `${domainSlug}-structured`,
        ];

        const { knowledge_bases } = await listKnowledgeBases();
        kbIds = knowledge_bases
          .filter(kb => expectedKBNames.includes(kb.name))
          .map(kb => kb.uuid);

        console.log(`Found ${kbIds.length} orphaned KBs for domain ${domain}`);
      }
    }

    if (kbIds.length === 0) {
      return NextResponse.json(
        { error: 'No knowledge bases found for this agent' },
        { status: 404 }
      );
    }

    // Trigger re-indexing on each KB
    const results: Array<{
      kbId: string;
      status: 'started' | 'error';
      error?: string;
      readiness?: { ready: boolean; reason?: string; hasContent?: boolean };
    }> = [];

    for (const kbId of kbIds) {
      try {
        // Check current status first
        const readiness = await isKBReady(kbId);

        // Start indexing job
        await startIndexingJob(kbId);
        results.push({
          kbId,
          status: 'started',
          readiness,
        });
        console.log(`Started re-indexing for KB ${kbId}`);
      } catch (error) {
        results.push({
          kbId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        console.error(`Failed to start re-indexing for KB ${kbId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      agentId: agent.uuid,
      agentName: agent.name,
      message: `Re-indexing started for ${results.filter(r => r.status === 'started').length} KB(s)`,
      results,
    });
  } catch (error) {
    console.error('Reindex error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

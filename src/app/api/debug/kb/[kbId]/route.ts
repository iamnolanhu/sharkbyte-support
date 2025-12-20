import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeBase, isKBReady } from '@/lib/digitalocean';

interface RouteContext {
  params: Promise<{ kbId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { kbId } = await context.params;

    if (!kbId) {
      return NextResponse.json(
        { error: 'KB ID is required' },
        { status: 400 }
      );
    }

    // Fetch KB details
    const kbResponse = await getKnowledgeBase(kbId);
    const kb = kbResponse.knowledge_base;

    // Check readiness
    const readiness = await isKBReady(kbId);

    // Extract relevant info
    const debugInfo = {
      kbId: kb.uuid,
      name: kb.name,
      region: kb.region,
      projectId: kb.project_id,
      databaseId: kb.database_id,
      createdAt: kb.created_at,
      updatedAt: kb.updated_at,
      indexing: {
        status: kb.last_indexing_job?.status || 'NEVER_INDEXED',
        startedAt: kb.last_indexing_job?.started_at,
        completedAt: kb.last_indexing_job?.completed_at,
        error: kb.last_indexing_job?.error,
      },
      readiness: {
        ready: readiness.ready,
        reason: readiness.reason,
      },
      datasources: kb.datasources?.map((ds) => ({
        type: ds.web_crawler_data_source ? 'web_crawler' : ds.file_upload_data_source ? 'file_upload' : 'unknown',
        webCrawler: ds.web_crawler_data_source,
        fileUpload: ds.file_upload_data_source,
      })),
      // Full raw response for debugging
      raw: kb,
    };

    return NextResponse.json(debugInfo);
  } catch (error) {
    console.error('Debug KB error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

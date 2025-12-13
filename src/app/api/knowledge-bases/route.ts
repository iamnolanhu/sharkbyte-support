import { NextResponse } from 'next/server';
import { listKnowledgeBases, getKBTypeFromName } from '@/lib/digitalocean';

/**
 * GET /api/knowledge-bases
 * Returns all knowledge bases (for debugging/admin purposes)
 */
export async function GET() {
  try {
    const response = await listKnowledgeBases();

    const knowledgeBases = response.knowledge_bases.map((kb) => ({
      uuid: kb.uuid,
      name: kb.name,
      type: getKBTypeFromName(kb.name),
      status:
        kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_COMPLETED'
          ? 'indexed'
          : kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_FAILED'
          ? 'error'
          : kb.last_indexing_job
          ? 'indexing'
          : 'creating',
      documentCount: kb.document_count,
      embeddingModelUuid: kb.embedding_model_uuid,
      databaseId: kb.database_id,
      region: kb.region,
      createdAt: kb.created_at,
      lastIndexingJob: kb.last_indexing_job
        ? {
            uuid: kb.last_indexing_job.uuid,
            status: kb.last_indexing_job.status,
            phase: kb.last_indexing_job.phase,
            tokens: kb.last_indexing_job.tokens,
            startedAt: kb.last_indexing_job.started_at,
            finishedAt: kb.last_indexing_job.finished_at,
          }
        : null,
    }));

    return NextResponse.json({
      success: true,
      knowledgeBases,
    });
  } catch (error) {
    console.error('Error listing knowledge bases:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

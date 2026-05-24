interface Pipeline {
	send(records: Record<string, unknown>[]): Promise<void>;
}

interface Env {
	ASSETS: {
		fetch: typeof fetch;
	};
	ARCHIVE_BUCKET?: R2Bucket;
	DB?: D1Database;
	INGEST_COORDINATOR?: DurableObjectNamespace;
	GTFS_STATIC_COORDINATOR?: DurableObjectNamespace;
	PARSE_QUEUE?: Queue;
	VP_PIPELINE?: Pipeline;
	TU_PIPELINE?: Pipeline;
	SWIFTLY_API_KEY?: string;
	ENVIRONMENT?: string;
}

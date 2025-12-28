interface Env {
	ASSETS: {
		fetch: typeof fetch;
	};
	ARCHIVE_BUCKET?: R2Bucket;
	DB?: D1Database;
	INGEST_COORDINATOR?: DurableObjectNamespace;
	SWIFTLY_API_KEY?: string;
	ENVIRONMENT?: string;
}

export const ErrorCodes = {
    TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
    COLUMN_NOT_FOUND: "COLUMN_NOT_FOUND",
    CONSTRAINT_VIOLATION: "CONSTRAINT_VIOLATION",
    INVALID_QUERY: "INVALID_QUERY",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    SYNC_ERROR: "SYNC_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class DatabaseError extends Error {
    constructor(
        message: string,
        public code: ErrorCode,
        public sql?: string,
        public params?: unknown[],
    ) {
        super(message);
        this.name = "DatabaseError";
    }
}

export class ValidationError extends Error {
    constructor(message: string, public field?: string) {
        super(message);
        this.name = "ValidationError";
    }
}

export class SyncError extends Error {
    constructor(message: string, public operationId?: string) {
        super(message);
        this.name = "SyncError";
    }
}

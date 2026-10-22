-- CreateTable
CREATE TABLE "KnowledgeRepository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "knowledgeBaseId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "quotaBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryDirectory" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "knowledgeBaseId" TEXT,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryFile" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "directoryId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageOwnerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT,
    "knowledgeBaseId" TEXT,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionMethod" TEXT,
    "indexStatus" TEXT NOT NULL DEFAULT 'uploaded',
    "indexError" TEXT,
    "indexedAt" TIMESTAMP(3),
    "indexedHash" TEXT,
    "indexedVersion" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfId" TEXT,
    "documentId" TEXT,
    "indexJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeRepository_userId_idx" ON "KnowledgeRepository"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeRepository_organizationId_idx" ON "KnowledgeRepository"("organizationId");

-- CreateIndex
CREATE INDEX "RepositoryDirectory_repositoryId_parentId_idx" ON "RepositoryDirectory"("repositoryId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryDirectory_repositoryId_path_key" ON "RepositoryDirectory"("repositoryId", "path");

-- CreateIndex
CREATE INDEX "RepositoryFile_repositoryId_directoryId_idx" ON "RepositoryFile"("repositoryId", "directoryId");

-- CreateIndex
CREATE INDEX "RepositoryFile_contentHash_idx" ON "RepositoryFile"("contentHash");

-- CreateIndex
CREATE INDEX "RepositoryFile_indexStatus_idx" ON "RepositoryFile"("indexStatus");

-- CreateIndex
CREATE INDEX "RepositoryFile_storageKey_idx" ON "RepositoryFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryFile_repositoryId_path_key" ON "RepositoryFile"("repositoryId", "path");

-- AddForeignKey
ALTER TABLE "KnowledgeRepository" ADD CONSTRAINT "KnowledgeRepository_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDirectory" ADD CONSTRAINT "RepositoryDirectory_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "KnowledgeRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDirectory" ADD CONSTRAINT "RepositoryDirectory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RepositoryDirectory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFile" ADD CONSTRAINT "RepositoryFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "KnowledgeRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFile" ADD CONSTRAINT "RepositoryFile_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "RepositoryDirectory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFile" ADD CONSTRAINT "RepositoryFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


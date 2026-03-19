-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "execTaskId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionItem_execTaskId_idx" ON "ActionItem"("execTaskId");

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_execTaskId_fkey" FOREIGN KEY ("execTaskId") REFERENCES "ExecTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

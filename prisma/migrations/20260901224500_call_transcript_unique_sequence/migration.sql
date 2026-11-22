DROP INDEX IF EXISTS "CallTranscript_callId_sequence_idx";
CREATE UNIQUE INDEX "CallTranscript_callId_sequence_key" ON "CallTranscript"("callId", "sequence");

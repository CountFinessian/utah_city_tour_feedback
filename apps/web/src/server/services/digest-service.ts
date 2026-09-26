import { listObservations } from "@/server/repositories/observations";
import { buildDigest, generateNarrative } from "@/server/reporting/digest";

export async function getLeadershipDigest() {
  const observations = await listObservations();
  const digest = buildDigest(observations);
  const narrative = await generateNarrative(digest, observations);
  return { observations, digest, narrative };
}

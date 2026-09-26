import { beforeEach, describe, expect, it } from "vitest";
import { clearAll, listObservations } from "@/server/repositories/file-observation-repository";
import {
  InputValidationError,
  createOrRefineObservation,
} from "@/server/services/observation-service";

describe("observation service", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("rejects empty transcripts at the application boundary", async () => {
    await expect(createOrRefineObservation({ transcript: " " })).rejects.toBeInstanceOf(InputValidationError);
  });

  it("creates an extracted live observation", async () => {
    const obs = await createOrRefineObservation({
      transcript: "They loved the pool but were worried about parking.",
      hostName: " Maria ",
    });

    expect(obs.source).toBe("live");
    expect(obs.hostName).toBe("Maria");
    expect(obs.extraction.objections.map((o) => o.type)).toContain("parking");
    expect(await listObservations()).toHaveLength(1);
  });

  it("preserves identity and createdAt when refining an existing observation", async () => {
    const original = await createOrRefineObservation({
      transcript: "They liked the gym.",
      hostName: "Devon",
    });

    const refined = await createOrRefineObservation({
      id: original.id,
      transcript: "They liked the gym and want to apply this week.",
      hostName: "Devon",
    });

    expect(refined.id).toBe(original.id);
    expect(refined.createdAt).toBe(original.createdAt);
    expect(refined.extraction.prospectIntent).toBe("hot");
  });

  it("persists and trims optional prospect CRM fields", async () => {
    const obs = await createOrRefineObservation({
      transcript: "Prospect loved the walking trails.",
      hostName: "Aiden",
      prospectFirstName: " John ",
      prospectLastName: " Doe ",
      prospectEmail: " john.doe@example.com ",
    });

    expect(obs.prospectFirstName).toBe("John");
    expect(obs.prospectLastName).toBe("Doe");
    expect(obs.prospectEmail).toBe("john.doe@example.com");
  });
});

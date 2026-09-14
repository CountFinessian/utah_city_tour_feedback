import { fileObservationRepository } from "./file-observation-repository";
import { postgresObservationRepository } from "./postgres-observation-repository";

const usePg = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL,
);

export const observationRepository = usePg ? postgresObservationRepository : fileObservationRepository;

export const backendName: "postgres" | "file" = usePg ? "postgres" : "file";

export const listObservations = observationRepository.listObservations.bind(observationRepository);
export const upsertObservation = observationRepository.upsertObservation.bind(observationRepository);
export const replaceAll = observationRepository.replaceAll.bind(observationRepository);
export const clearAll = observationRepository.clearAll.bind(observationRepository);
export const clearDemo = observationRepository.clearDemo.bind(observationRepository);
export const deleteObservation = observationRepository.deleteObservation.bind(observationRepository);

import type { Observation } from "@/domain/observation";

export interface ObservationRepository {
  listObservations(): Promise<Observation[]>;
  upsertObservation(obs: Observation): Promise<Observation>;
  replaceAll(rows: Observation[]): Promise<void>;
  clearAll(): Promise<void>;
  clearDemo(): Promise<void>;
  deleteObservation(id: string): Promise<boolean>;
}

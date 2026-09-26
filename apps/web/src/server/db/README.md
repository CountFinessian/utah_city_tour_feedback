# Database

`migrations/0001_operational_intelligence.sql` defines the production corpus model for the platform.

The current MVP routes still read and write the legacy `observations` table through the observation repository so existing capture and tests keep working. The next implementation phase should add a migration runner and write-through from captured observations into `interactions`, `transcript_artifacts`, `observations_v2`, and `signals`.

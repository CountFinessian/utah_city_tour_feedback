/** Local entry for the same resumable re-evaluation the production cron mode runs. */
import { runRelevanceReeval } from "../src/server/services/relevance-jobs";

runRelevanceReeval()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });

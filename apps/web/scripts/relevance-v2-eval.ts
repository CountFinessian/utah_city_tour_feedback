/** Local entry for the same reference check the production cron mode runs. */
import { runReferenceEval } from "../src/server/services/relevance-jobs";

runReferenceEval()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.incorrect > 0) process.exit(1);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });

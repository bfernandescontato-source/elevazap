import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { errorFields } from "../utils/log.js";
import { isMissingRpc } from "../queue/policy.js";
import { OfferProcessor } from "./offer-processor.js";

let activeRecovery: Promise<number> | null = null;

async function runInterruptedPilotRecovery() {
  const processor = new OfferProcessor(supabase);
  let recovered = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // Claim one row at a time. A batch claimed up front could expire while
    // waiting behind slow affiliate conversion work from earlier rows.
    const { data, error } = await supabase.rpc("claim_interrupted_pilot_offers", {
      p_worker_id: env.INSTANCE_ID,
      p_limit: 1,
      p_processing_seconds: Math.ceil(env.OFFER_PROCESSING_TIMEOUT_MS / 1000)
    });
    if (error) {
      if (isMissingRpc(error, "claim_interrupted_pilot_offers")) return recovered;
      throw error;
    }
    const row = data?.[0];
    if (!row) break;
    try {
      const result = await processor.resume(row.account_id, row.offer_id);
      if (result) recovered += 1;
    } catch (currentError) {
      console.error({
        event: "offer_recovery_failed",
        component: "offer-autopilot",
        offer_id: row.offer_id,
        account_id: row.account_id,
        ...errorFields(currentError)
      });
    }
  }
  if (recovered > 0) console.info({ event: "offer_recovery_completed", component: "offer-autopilot", recovered });
  return recovered;
}

export function recoverInterruptedPilotOffers() {
  if (activeRecovery) return activeRecovery;
  activeRecovery = runInterruptedPilotRecovery().finally(() => {
    activeRecovery = null;
  });
  return activeRecovery;
}
